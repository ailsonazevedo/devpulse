import type { ActivityType } from "@devpulse/core";
import { auth } from "@/auth";
import { getHeatmap, getStats } from "@/lib/queries";
import { Heatmap } from "@/components/Heatmap";
import { typeMeta } from "@/components/labels";
import { TypeIcon } from "@/components/icons";

const TYPES: ActivityType[] = [
  "PUSH",
  "PR",
  "MR",
  "ISSUE",
  "REVIEW",
  "COMMENT",
  "RELEASE",
];

export default async function HeatmapPage() {
  const session = await auth();
  const userId = session!.user.id;
  const [days, stats] = await Promise.all([getHeatmap(userId), getStats(userId)]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Heatmap</h1>
        <p className="text-sm text-neutral-500">
          Calendário anual somando todos os provedores conectados.
        </p>
      </div>

      <section className="card p-5">
        <Heatmap days={days} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-neutral-500">Por tipo</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {TYPES.map((t) => (
            <div key={t} className="card px-3 py-3">
              <div className={"flex items-center gap-1.5 " + typeMeta[t].tint}>
                <TypeIcon type={t} className="h-4 w-4" />
                <span className="text-xs font-medium text-neutral-500">
                  {typeMeta[t].label}
                </span>
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {stats.byType[t] ?? 0}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
