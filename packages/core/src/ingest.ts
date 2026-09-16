import { Prisma, type Provider } from "@prisma/client";
import {
  getAdapter,
  AuthError,
  type Credentials,
  type DailyCount,
} from "./adapters/index.js";
import { decryptSecret } from "./crypto.js";
import { prisma } from "./db.js";

export interface SyncResult {
  inserted: number;
  pages: number;
}

/**
 * Sincroniza uma conexão: puxa atividades do provedor, faz upsert idempotente
 * (por dedupeKey) e recomputa os rollups diários. Salva cursor e status.
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
  const creds: Credentials = {
    accessToken: decryptSecret(connection.accessTokenEnc),
    refreshToken: connection.refreshTokenEnc
      ? decryptSecret(connection.refreshTokenEnc)
      : null,
    baseUrl: connection.baseUrl,
    tokenType: connection.authMethod === "OAUTH" ? "oauth" : "pat",
  };

  await prisma.providerConnection.update({
    where: { id: connectionId },
    data: { status: "SYNCING", statusDetail: null },
  });

  const cursor =
    mode === "incremental" && connection.syncCursor
      ? (connection.syncCursor as Record<string, unknown>)
      : undefined;

  let inserted = 0;
  let pages = 0;
  let earliest: Date | null = null;
  let latestCursor = cursor;

  try {
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
      where: { id: connectionId },
      data: {
        status: "ACTIVE",
        statusDetail: null,
        syncCursor: (latestCursor ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        lastSyncedAt: new Date(),
      },
    });

    return { inserted, pages };
  } catch (err) {
    const isAuth = err instanceof AuthError;
    await prisma.providerConnection.update({
      where: { id: connectionId },
      data: {
        status: isAuth ? "REVOKED" : "ERROR",
        statusDetail: err instanceof Error ? err.message : "erro desconhecido",
      },
    });
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
