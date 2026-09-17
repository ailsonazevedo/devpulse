import type { ActivityType, Provider } from "@devpulse/core";
import { auth } from "@/auth";
import {
  getConnectedProviders,
  getContributionYears,
  getHeatmap,
  getStats,
} from "@/lib/queries";
import { Heatmap } from "@/components/Heatmap";
import { DISPLAY_TYPES, groupTypeLabel, typeGroup, typeMeta } from "@/components/labels";
import { TypeIcon } from "@/components/icons";

const PROVIDERS: Provider[] = ["GITHUB", "GITLAB", "AZURE"];
const TYPES: ActivityType[] = DISPLAY_TYPES;

export default async function HeatmapPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const session = await auth();
  const userId = session!.user.id;
  const sp = await searchParams;

  const years = await getContributionYears(userId);
  const parsedYear = Number(sp.year);
  const year = years.includes(parsedYear) ? parsedYear : undefined;

  const [days, stats, connected] = await Promise.all([
    getHeatmap(userId, { year }),
    getStats(userId),
    getConnectedProviders(userId),
  ]);
  const shownProviders = PROVIDERS.filter((p) => connected.includes(p));

  // Funde tipos equivalentes entre provedores (PR+MR, PUSH+COMMIT) num só balde.
  const byGroup: Partial<Record<ActivityType, number>> = {};
  for (const [t, c] of Object.entries(stats.byType)) {
    const g = typeGroup(t as ActivityType);
    byGroup[g] = (byGroup[g] ?? 0) + (c as number);
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Heatmap</h1>
        <p className="text-sm text-neutral-500">
          Calendário anual somando todos os provedores conectados.
        </p>
      </div>

      <section className="card p-5">
        <Heatmap
          days={days}
          providers={shownProviders}
          year={year}
          years={years}
        />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-neutral-500">Por tipo</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {TYPES.map((t) => (
            <div key={t} className="card px-3 py-3">
              <div className={"flex items-center gap-1.5 " + typeMeta[t].tint}>
                <TypeIcon type={t} className="h-4 w-4" />
                <span className="text-xs font-medium text-neutral-500">
                  {groupTypeLabel[t] ?? typeMeta[t].label}
                </span>
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {byGroup[t] ?? 0}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
