import { Prisma } from "@prisma/client";
import { getAdapter, AuthError, type Credentials } from "./adapters/index.js";
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

    if (earliest) {
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
  provider: "GITHUB" | "GITLAB",
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
