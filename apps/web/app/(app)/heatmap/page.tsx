import type { ActivityType } from "@devpulse/core";
import { auth } from "@/auth";
import { getHeatmap, getStats } from "@/lib/queries";
import { Heatmap } from "@/components/Heatmap";
import { typeLabel } from "@/components/labels";

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
  const [days, stats] = await Promise.all([
    getHeatmap(userId),
    getStats(userId),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
        <Heatmap days={days} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-neutral-500">
          Por tipo
        </h2>
        <div className="flex flex-wrap gap-3">
          {TYPES.map((t) => (
            <div
              key={t}
              className="rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800"
            >
              <div className="text-lg font-bold">{stats.byType[t] ?? 0}</div>
              <div className="text-xs text-neutral-500">{typeLabel[t]}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
