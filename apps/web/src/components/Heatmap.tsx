"use client";

import { useMemo, useState } from "react";
import type { Provider } from "@devpulse/core";
import type { HeatmapDay } from "@/lib/queries";
import { providerMeta } from "@/components/labels";

const PROVIDERS: Provider[] = ["GITHUB", "GITLAB"];

function levelColor(count: number, max: number): string {
  if (count === 0) return "var(--empty)";
  const ratio = count / Math.max(max, 1);
  if (ratio > 0.66) return "#216e39";
  if (ratio > 0.33) return "#30a14e";
  if (ratio > 0.1) return "#40c463";
  return "#9be9a8";
}

export function Heatmap({ days }: { days: HeatmapDay[] }) {
  const [active, setActive] = useState<Set<Provider>>(new Set(PROVIDERS));

  const byDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of days) {
      let total = 0;
      for (const p of PROVIDERS) {
        if (active.has(p)) total += d.byProvider[p] ?? 0;
      }
      m.set(d.date, total);
    }
    return m;
  }, [days, active]);

  // Monta 53 semanas terminando hoje (colunas = semanas, linhas = dia da semana)
  const weeks = useMemo(() => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 364);
    // recua até domingo
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());

    const cols: { date: string; count: number }[][] = [];
    const cursor = new Date(start);
    while (cursor <= today) {
      const col: { date: string; count: number }[] = [];
      for (let d = 0; d < 7; d++) {
        const key = cursor.toISOString().slice(0, 10);
        col.push({ date: key, count: byDate.get(key) ?? 0 });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      cols.push(col);
    }
    return cols;
  }, [byDate]);

  const max = useMemo(() => Math.max(1, ...byDate.values()), [byDate]);
  const total = useMemo(
    () => [...byDate.values()].reduce((a, b) => a + b, 0),
    [byDate],
  );

  const toggle = (p: Provider) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next.size === 0 ? new Set(PROVIDERS) : next;
    });

  return (
    <div className="flex flex-col gap-4" style={{ ["--empty" as string]: "#ebedf0" }}>
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-500">
          {total} contribuições no último ano
        </p>
        <div className="flex gap-2 text-xs">
          {PROVIDERS.map((p) => (
            <button
              key={p}
              onClick={() => toggle(p)}
              className={
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 " +
                (active.has(p)
                  ? "border-neutral-400"
                  : "border-neutral-200 opacity-40")
              }
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: providerMeta[p].color }}
              />
              {providerMeta[p].label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="flex gap-[3px]">
          {weeks.map((col, i) => (
            <div key={i} className="flex flex-col gap-[3px]">
              {col.map((cell) => (
                <div
                  key={cell.date}
                  title={`${cell.date}: ${cell.count} contribuições`}
                  className="h-[11px] w-[11px] rounded-[2px]"
                  style={{ background: levelColor(cell.count, max) }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
