import { type ActivityType, type Provider, prisma } from "@devpulse/core";

export interface FeedFilter {
  provider?: Provider;
  /** Tipos concretos a incluir (já expandidos do grupo exibido, ex.: PR→[PR,MR]). */
  types?: ActivityType[];
}

/** Feed do usuário, ordenado por data desc. Sempre filtrado por userId. */
export async function getFeed(userId: string, filter: FeedFilter, limit = 100) {
  return prisma.activity.findMany({
    where: {
      userId,
      ...(filter.provider ? { provider: filter.provider } : {}),
      ...(filter.types && filter.types.length
        ? { type: { in: filter.types } }
        : {}),
    },
    orderBy: { occurredAt: "desc" },
    take: limit,
    select: {
      id: true,
      provider: true,
      type: true,
      title: true,
      url: true,
      repoName: true,
      occurredAt: true,
    },
  });
}

export interface HeatmapDay {
  date: string; // YYYY-MM-DD (UTC)
  total: number;
  byProvider: Partial<Record<Provider, number>>;
}

/** Dados do heatmap dos últimos `days` dias, somando provedores. */
export async function getHeatmap(
  userId: string,
  days = 365,
): Promise<HeatmapDay[]> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  since.setUTCHours(0, 0, 0, 0);

  const rows = await prisma.dailyContribution.findMany({
    where: { userId, date: { gte: since } },
    select: { date: true, provider: true, count: true },
  });

  const map = new Map<string, HeatmapDay>();
  for (const r of rows) {
    const key = r.date.toISOString().slice(0, 10);
    const day = map.get(key) ?? { date: key, total: 0, byProvider: {} };
    day.total += r.count;
    day.byProvider[r.provider] = (day.byProvider[r.provider] ?? 0) + r.count;
    map.set(key, day);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Totais por tipo e por provedor. */
export async function getStats(userId: string) {
  const [byType, byProvider, total] = await Promise.all([
    prisma.activity.groupBy({
      by: ["type"],
      where: { userId },
      _count: { _all: true },
    }),
    prisma.activity.groupBy({
      by: ["provider"],
      where: { userId },
      _count: { _all: true },
    }),
    prisma.activity.count({ where: { userId } }),
  ]);
  return {
    total,
    byType: Object.fromEntries(byType.map((t) => [t.type, t._count._all])),
    byProvider: Object.fromEntries(
      byProvider.map((p) => [p.provider, p._count._all]),
    ),
  };
}

/** Provedores que o usuário realmente conectou (distinct). Dirige os dashboards. */
export async function getConnectedProviders(userId: string): Promise<Provider[]> {
  const rows = await prisma.providerConnection.findMany({
    where: { userId },
    distinct: ["provider"],
    select: { provider: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => r.provider);
}

export async function getConnections(userId: string) {
  return prisma.providerConnection.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      provider: true,
      authMethod: true,
      baseUrl: true,
      externalLogin: true,
      avatarUrl: true,
      status: true,
      statusDetail: true,
      lastSyncedAt: true,
      scopes: true,
    },
  });
}
