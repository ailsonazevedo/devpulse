import { Prisma, type Provider, type ProviderConnection } from "@prisma/client";
import {
  getAdapter,
  AuthError,
  type Credentials,
  type DailyCount,
  type ProviderAdapter,
} from "./adapters/index.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { prisma } from "./db.js";

export interface SyncResult {
  inserted: number;
  pages: number;
}

/** Margem para refresh proativo: renova se faltar ≤ 60s para expirar. */
const EXPIRY_SKEW_MS = 60_000;

/** Monta as credenciais (descriptografadas) a partir da conexão. */
function buildCreds(connection: ProviderConnection): Credentials {
  return {
    accessToken: decryptSecret(connection.accessTokenEnc),
    refreshToken: connection.refreshTokenEnc
      ? decryptSecret(connection.refreshTokenEnc)
      : null,
    baseUrl: connection.baseUrl,
    tokenType: connection.authMethod === "OAUTH" ? "oauth" : "pat",
  };
}

/** Conexão OAuth, com refresh token e adapter que suporta refresh. */
function canRefresh(
  connection: ProviderConnection,
  adapter: ProviderAdapter,
): boolean {
  return (
    connection.authMethod === "OAUTH" &&
    Boolean(adapter.refreshToken) &&
    Boolean(connection.refreshTokenEnc)
  );
}

function isExpiring(expiresAt: Date | null): boolean {
  return expiresAt !== null && expiresAt.getTime() <= Date.now() + EXPIRY_SKEW_MS;
}

/**
 * Renova o access token via refresh_token e persiste os novos segredos cifrados
 * (mantendo o refresh token anterior quando o provedor não o rotaciona).
 * Lança AuthError se o refresh falhar (refresh token revogado/expirado).
 */
async function refreshConnection(
  connection: ProviderConnection,
  adapter: ProviderAdapter,
): Promise<Credentials> {
  const current = buildCreds(connection);
  const refreshed = await adapter.refreshToken!(current);
  await prisma.providerConnection.update({
    where: { id: connection.id },
    data: {
      accessTokenEnc: encryptSecret(refreshed.accessToken),
      refreshTokenEnc: refreshed.refreshToken
        ? encryptSecret(refreshed.refreshToken)
        : connection.refreshTokenEnc,
      tokenExpiresAt: refreshed.expiresAt ?? null,
    },
  });
  return {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? current.refreshToken,
    baseUrl: connection.baseUrl,
    tokenType: "oauth",
  };
}

async function persistErrorStatus(
  connectionId: string,
  err: unknown,
): Promise<void> {
  const isAuth = err instanceof AuthError;
  await prisma.providerConnection.update({
    where: { id: connectionId },
    data: {
      status: isAuth ? "REVOKED" : "ERROR",
      statusDetail: err instanceof Error ? err.message : "erro desconhecido",
    },
  });
}

/** Uma passada de ingestão: puxa atividades, rollups e marca ACTIVE no sucesso. */
async function ingestOnce(
  connection: ProviderConnection,
  adapter: ProviderAdapter,
  creds: Credentials,
  cursor: Record<string, unknown> | undefined,
): Promise<SyncResult> {
  let inserted = 0;
  let pages = 0;
  let earliest: Date | null = null;
  let latestCursor = cursor;

  for await (const page of adapter.fetchActivities(creds, cursor)) {
    pages += 1;
    if (page.items.length > 0) {
      const created = await prisma.activity.createMany({
        data: page.items.map((it) => ({
          userId: connection.userId,
          connectionId: connection.id,
          provider: connection.provider,
          type: it.type,
          externalId: it.externalId,
          dedupeKey: it.dedupeKey,
          title: it.title,
          url: it.url,
          repoName: it.repoName ?? null,
          repoUrl: it.repoUrl ?? null,
          occurredAt: it.occurredAt,
          raw: it.raw as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      });
      inserted += created.count;

      for (const it of page.items) {
        if (!earliest || it.occurredAt < earliest) earliest = it.occurredAt;
      }
    }
    if (page.nextCursor) latestCursor = page.nextCursor;
  }

  // Heatmap: se o provedor expõe um calendário autoritativo COM dados
  // (ex.: GitHub GraphQL; GitLab.com público), usa-o (ano cheio, inclui
  // privadas). Se o calendário vier vazio — comum em GitLab self-hosted, onde
  // o calendar.json web não expõe contribuições privadas — cai no rollup
  // derivado das atividades já ingeridas (que via PAT incluem projetos
  // privados). Provedores sem calendário usam sempre o rollup por atividade.
  const calendar = adapter.fetchContributionCalendar
    ? await adapter.fetchContributionCalendar(creds)
    : null;
  if (calendar && calendar.some((d) => d.count > 0)) {
    await writeCalendarRollups(connection.userId, connection.provider, calendar);
  } else if (earliest) {
    await recomputeRollups(connection.userId, connection.provider, earliest);
  }

  await prisma.providerConnection.update({
    where: { id: connection.id },
    data: {
      status: "ACTIVE",
      statusDetail: null,
      syncCursor: (latestCursor ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      lastSyncedAt: new Date(),
    },
  });

  return { inserted, pages };
}

/**
 * Sincroniza uma conexão: puxa atividades do provedor, faz upsert idempotente
 * (por dedupeKey) e recomputa os rollups diários. Salva cursor e status.
 *
 * OAuth: renova o access token proativamente (perto de expirar) e reativamente
 * (se um AuthError surgir no meio do sync), persistindo os novos tokens e
 * repetindo a passada uma vez. Só marca REVOKED quando o refresh também falha.
 */
export async function syncConnection(
  connectionId: string,
  mode: "backfill" | "incremental",
): Promise<SyncResult> {
  const connection = await prisma.providerConnection.findUnique({
    where: { id: connectionId },
  });
  if (!connection) throw new Error(`Conexão não encontrada: ${connectionId}`);
  if (connection.status === "REVOKED") return { inserted: 0, pages: 0 };

  const adapter = getAdapter(connection.provider);

  await prisma.providerConnection.update({
    where: { id: connectionId },
    data: { status: "SYNCING", statusDetail: null },
  });

  const cursor =
    mode === "incremental" && connection.syncCursor
      ? (connection.syncCursor as Record<string, unknown>)
      : undefined;

  let creds = buildCreds(connection);
  let didRefresh = false;

  // Refresh proativo: token OAuth prestes a expirar.
  if (canRefresh(connection, adapter) && isExpiring(connection.tokenExpiresAt)) {
    try {
      creds = await refreshConnection(connection, adapter);
      didRefresh = true;
    } catch (err) {
      await persistErrorStatus(connectionId, err);
      throw err;
    }
  }

  try {
    return await ingestOnce(connection, adapter, creds, cursor);
  } catch (err) {
    // Refresh reativo: access token expirou durante o sync — renova e repete 1x.
    if (err instanceof AuthError && !didRefresh && canRefresh(connection, adapter)) {
      try {
        creds = await refreshConnection(connection, adapter);
      } catch (refreshErr) {
        await persistErrorStatus(connectionId, refreshErr);
        throw refreshErr;
      }
      try {
        return await ingestOnce(connection, adapter, creds, cursor);
      } catch (retryErr) {
        await persistErrorStatus(connectionId, retryErr);
        throw retryErr;
      }
    }
    await persistErrorStatus(connectionId, err);
    throw err;
  }
}

/**
 * Recomputa DailyContribution (por dia UTC) para o intervalo tocado.
 * Idempotente: agrega a tabela Activity e faz upsert por dia.
 */
async function recomputeRollups(
  userId: string,
  provider: Provider,
  since: Date,
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "DailyContribution" ("userId", "date", "provider", "count")
    SELECT
      "userId",
      date_trunc('day', "occurredAt" AT TIME ZONE 'UTC') AS d,
      "provider",
      count(*)::int
    FROM "Activity"
    WHERE "userId" = ${userId}
      AND "provider" = ${provider}::"Provider"
      AND "occurredAt" >= ${since}
    GROUP BY "userId", d, "provider"
    ON CONFLICT ("userId", "date", "provider")
    DO UPDATE SET "count" = EXCLUDED."count";
  `;
}

/**
 * Grava o calendário autoritativo no DailyContribution do provedor. Substitui
 * o intervalo coberto (delete + insert) para refletir exatamente o calendário.
 */
async function writeCalendarRollups(
  userId: string,
  provider: Provider,
  days: DailyCount[],
): Promise<void> {
  if (days.length === 0) return;
  const toDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
  const dates = days.map((d) => toDate(d.date).getTime());
  const min = new Date(Math.min(...dates));
  const max = new Date(Math.max(...dates));

  await prisma.$transaction([
    prisma.dailyContribution.deleteMany({
      where: { userId, provider, date: { gte: min, lte: max } },
    }),
    prisma.dailyContribution.createMany({
      data: days
        .filter((d) => d.count > 0)
        .map((d) => ({
          userId,
          provider,
          date: toDate(d.date),
          count: d.count,
        })),
    }),
  ]);
}
