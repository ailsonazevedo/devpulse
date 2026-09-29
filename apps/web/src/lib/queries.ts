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
      aiTool: true,
    },
  });
}

export interface HeatmapDay {
  date: string; // YYYY-MM-DD (UTC)
  total: number;
  byProvider: Partial<Record<Provider, number>>;
}

/**
 * Dados do heatmap somando provedores. Sem `year`, cobre os últimos 365 dias
 * (janela móvel). Com `year`, cobre o ano-calendário inteiro (UTC).
 */
export async function getHeatmap(
  userId: string,
  opts: { year?: number } = {},
): Promise<HeatmapDay[]> {
  let where: { userId: string; date: { gte: Date; lte?: Date } };
  if (opts.year) {
    where = {
      userId,
      date: {
        gte: new Date(Date.UTC(opts.year, 0, 1, 0, 0, 0, 0)),
        lte: new Date(Date.UTC(opts.year, 11, 31, 23, 59, 59, 999)),
      },
    };
  } else {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 365);
    since.setUTCHours(0, 0, 0, 0);
    where = { userId, date: { gte: since } };
  }

  const rows = await prisma.dailyContribution.findMany({
    where,
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

/** Anos (desc) com contribuições registradas, para o seletor do heatmap. */
export async function getContributionYears(userId: string): Promise<number[]> {
  const rows = await prisma.$queryRaw<{ year: number }[]>`
    SELECT DISTINCT EXTRACT(YEAR FROM "date")::int AS year
    FROM "DailyContribution"
    WHERE "userId" = ${userId}
    ORDER BY year DESC
  `;
  return rows.map((r) => r.year);
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

/**
 * Tipos em que a IA pode ser detectada (código entregue). Reviews, issues e
 * comentários ficam fora do denominador para não diluir o percentual.
 */
const AI_CODE_TYPES: ActivityType[] = ["PUSH", "COMMIT", "PR", "MR"];
const AI_WEEKS = 12;

export interface AiWeek {
  week: string; // YYYY-MM-DD (segunda-feira, UTC)
  total: number;
  ai: number;
}

/** AI Pulse: parcela das entregas de código com evidência de IA. */
export async function getAiStats(userId: string) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - AI_WEEKS * 7);
  since.setUTCHours(0, 0, 0, 0);
  const codeWhere = { userId, type: { in: AI_CODE_TYPES } };

  const [total, ai, byTool, weeks, recent] = await Promise.all([
    prisma.activity.count({ where: codeWhere }),
    prisma.activity.count({ where: { ...codeWhere, aiTool: { not: null } } }),
    prisma.activity.groupBy({
      by: ["aiTool"],
      where: { userId, aiTool: { not: null } },
      _count: { _all: true },
    }),
    prisma.$queryRaw<{ week: Date; total: number; ai: number }[]>`
      SELECT
        date_trunc('week', "occurredAt" AT TIME ZONE 'UTC') AS week,
        count(*)::int AS total,
        count("aiTool")::int AS ai
      FROM "Activity"
      WHERE "userId" = ${userId}
        AND "type"::text IN ('PUSH', 'COMMIT', 'PR', 'MR')
        AND "occurredAt" >= ${since}
      GROUP BY week
      ORDER BY week
    `,
    prisma.activity.findMany({
      where: { userId, aiTool: { not: null } },
      orderBy: { occurredAt: "desc" },
      take: 8,
      select: {
        id: true,
        provider: true,
        type: true,
        title: true,
        url: true,
        repoName: true,
        occurredAt: true,
        aiTool: true,
        aiSignal: true,
      },
    }),
  ]);

  // Preenche semanas sem atividade para o eixo ficar contínuo.
  const byWeek = new Map(
    weeks.map((w) => [w.week.toISOString().slice(0, 10), w]),
  );
  const monday = new Date();
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const series: AiWeek[] = [];
  for (let i = AI_WEEKS - 1; i >= 0; i--) {
    const d = new Date(monday);
    d.setUTCDate(d.getUTCDate() - i * 7);
    const key = d.toISOString().slice(0, 10);
    const w = byWeek.get(key);
    series.push({ week: key, total: w?.total ?? 0, ai: w?.ai ?? 0 });
  }

  return {
    total,
    ai,
    byTool: byTool
      .map((t) => ({ tool: t.aiTool!, count: t._count._all }))
      .sort((a, b) => b.count - a.count),
    weeks: series,
    recent,
  };
}
