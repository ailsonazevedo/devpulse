import { Prisma, type Provider, type ProviderConnection } from "@prisma/client";
import {
  getAdapter,
  AuthError,
  type Credentials,
  type DailyCount,
  type ProviderAdapter,
} from "./adapters/index.js";
import { detectAi, type AiAttribution } from "./ai-detect.js";
import {
  buildCreds,
  canRefresh,
  isExpiring,
  refreshConnection,
} from "./connection-creds.js";
import { prisma } from "./db.js";

export interface SyncResult {
  inserted: number;
  pages: number;
}

const BACKFILL_YEARS = Math.max(
  1,
  Number(process.env.HEATMAP_BACKFILL_YEARS ?? 10),
);

/** Lote do re-scan de IA sobre atividades já ingeridas. */
const AI_REDETECT_BATCH = 1000;

/** Atribuição de IA de um payload cru, via evidências do adapter. */
function aiOf(adapter: ProviderAdapter, raw: unknown): AiAttribution | null {
  return adapter.aiEvidence ? detectAi(adapter.aiEvidence(raw)) : null;
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
  mode: "backfill" | "incremental",
): Promise<SyncResult> {
  let inserted = 0;
  let pages = 0;
  let earliest: Date | null = null;
  let latestCursor = cursor;

  for await (const page of adapter.fetchActivities(creds, cursor)) {
    pages += 1;
    if (page.items.length > 0) {
      const created = await prisma.activity.createMany({
        data: page.items.map((it) => {
          const ai = aiOf(adapter, it.raw);
          return {
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
            aiTool: ai?.tool ?? null,
            aiSignal: ai?.signal ?? null,
          };
        }),
        skipDuplicates: true,
      });
      inserted += created.count;

      // No backfill, linhas já existentes (ignoradas pelo createMany) recebem o
      // raw atual — que pode trazer o enriquecimento de IA — e a atribuição.
      if (mode === "backfill") {
        const withAi = page.items.flatMap((it) => {
          const ai = aiOf(adapter, it.raw);
          return ai ? [{ it, ai }] : [];
        });
        if (withAi.length > 0) {
          await prisma.$transaction(
            withAi.map(({ it, ai }) =>
              prisma.activity.updateMany({
                where: { connectionId: connection.id, dedupeKey: it.dedupeKey },
                data: {
                  raw: it.raw as Prisma.InputJsonValue,
                  aiTool: ai.tool,
                  aiSignal: ai.signal,
                },
              }),
            ),
          );
        }
      }

      for (const it of page.items) {
        if (!earliest || it.occurredAt < earliest) earliest = it.occurredAt;
      }
    }
    if (page.nextCursor) latestCursor = page.nextCursor;
  }

  await writeHeatmap(connection, adapter, creds, earliest, mode);
  // createMany ignora duplicatas: no backfill (conectar/resync), re-detecta a
  // IA do histórico já ingerido — cobre linhas anteriores ao AI Pulse.
  if (mode === "backfill") await redetectAi(connection.id, adapter);

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
  if (
    canRefresh(connection, adapter) &&
    isExpiring(connection.tokenExpiresAt)
  ) {
    try {
      creds = await refreshConnection(connection, adapter);
      didRefresh = true;
    } catch (err) {
      await persistErrorStatus(connectionId, err);
      throw err;
    }
  }

  try {
    return await ingestOnce(connection, adapter, creds, cursor, mode);
  } catch (err) {
    // Refresh reativo: access token expirou durante o sync — renova e repete 1x.
    if (
      err instanceof AuthError &&
      !didRefresh &&
      canRefresh(connection, adapter)
    ) {
      try {
        creds = await refreshConnection(connection, adapter);
      } catch (refreshErr) {
        await persistErrorStatus(connectionId, refreshErr);
        throw refreshErr;
      }
      try {
        return await ingestOnce(connection, adapter, creds, cursor, mode);
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
 * Escreve os rollups do heatmap. Se o provedor expõe um calendário autoritativo
 * COM dados (ex.: GitHub GraphQL; GitLab.com público), usa-o — ano cheio, inclui
 * privadas. No backfill de provedores com calendário histórico (GitHub), busca
 * ano a ano (`BACKFILL_YEARS`), pois a API limita cada consulta a 1 ano.
 *
 * Se o calendário vier vazio — comum em GitLab self-hosted, onde o calendar.json
 * web não expõe contribuições privadas — cai no rollup derivado das atividades
 * já ingeridas (que via PAT incluem projetos privados). Provedores sem calendário
 * usam sempre o rollup por atividade (limitado à janela de backfill do adapter).
 */
async function writeHeatmap(
  connection: ProviderConnection,
  adapter: ProviderAdapter,
  creds: Credentials,
  earliest: Date | null,
  mode: "backfill" | "incremental",
): Promise<void> {
  if (adapter.fetchContributionCalendar) {
    if (mode === "backfill" && adapter.supportsHistoricalCalendar) {
      // Vai do ano atual para trás buscando o máximo de histórico com dados.
      // Para após anos vazios consecutivos (fim do histórico), com teto em
      // BACKFILL_YEARS para não estourar chamadas em contas muito antigas.
      const now = new Date();
      const cy = now.getUTCFullYear();
      let wrote = false;
      let emptyStreak = 0;
      for (let y = cy; y > cy - BACKFILL_YEARS; y--) {
        const range = {
          from: new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0)),
          to:
            y === cy ? now : new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999)),
        };
        const calendar = await adapter.fetchContributionCalendar(creds, range);
        if (calendar.some((d) => d.count > 0)) {
          await writeCalendarRollups(
            connection.userId,
            connection.provider,
            calendar,
          );
          wrote = true;
          emptyStreak = 0;
        } else if (++emptyStreak >= 2) {
          break; // dois anos seguidos sem dados: acabou o histórico
        }
      }
      if (wrote) return;
    } else {
      const calendar = await adapter.fetchContributionCalendar(creds);
      if (calendar.some((d) => d.count > 0)) {
        await writeCalendarRollups(
          connection.userId,
          connection.provider,
          calendar,
        );
        return;
      }
    }
  }
  if (earliest) {
    await recomputeRollups(connection.userId, connection.provider, earliest);
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

/**
 * Recalcula aiTool/aiSignal das atividades de uma conexão a partir do `raw`
 * persistido (sem chamar o provedor). Percorre em lotes e só grava o que mudou.
 */
export async function redetectAi(
  connectionId: string,
  adapter: ProviderAdapter,
): Promise<number> {
  if (!adapter.aiEvidence) return 0;
  let updated = 0;
  let after: string | undefined;
  for (;;) {
    const rows = await prisma.activity.findMany({
      where: { connectionId },
      orderBy: { id: "asc" },
      take: AI_REDETECT_BATCH,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      select: { id: true, raw: true, aiTool: true, aiSignal: true },
    });
    if (rows.length === 0) break;
    after = rows[rows.length - 1]!.id;

    const changes = rows.flatMap((r) => {
      const ai = aiOf(adapter, r.raw);
      const tool = ai?.tool ?? null;
      const signal = ai?.signal ?? null;
      return tool === r.aiTool && signal === r.aiSignal
        ? []
        : [
            prisma.activity.update({
              where: { id: r.id },
              data: { aiTool: tool, aiSignal: signal },
            }),
          ];
    });
    if (changes.length > 0) {
      await prisma.$transaction(changes);
      updated += changes.length;
    }
    if (rows.length < AI_REDETECT_BATCH) break;
  }
  return updated;
}
