"use client";

import { useMemo, useState } from "react";
import type { Provider } from "@devpulse/core";
import type { HeatmapDay } from "@/lib/queries";
import { providerMeta } from "@/components/labels";
import { ProviderIcon } from "@/components/icons";

const PROVIDERS: Provider[] = ["GITHUB", "GITLAB"];
const MONTHS = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];
const LEVELS = ["#9be9a8", "#40c463", "#30a14e", "#216e39"];

function level(count: number, max: number): number {
  if (count === 0) return -1;
  const r = count / Math.max(max, 1);
  if (r > 0.66) return 3;
  if (r > 0.33) return 2;
  if (r > 0.1) return 1;
  return 0;
}

export function Heatmap({ days }: { days: HeatmapDay[] }) {
  const [active, setActive] = useState<Set<Provider>>(new Set(PROVIDERS));

  const byDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of days) {
      let total = 0;
      for (const p of PROVIDERS) if (active.has(p)) total += d.byProvider[p] ?? 0;
      m.set(d.date, total);
    }
    return m;
  }, [days, active]);

  const weeks = useMemo(() => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 364);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());

    const cols: { date: string; count: number; month: number }[][] = [];
    const cursor = new Date(start);
    while (cursor <= today) {
      const col: { date: string; count: number; month: number }[] = [];
      for (let d = 0; d < 7; d++) {
        const key = cursor.toISOString().slice(0, 10);
        col.push({ date: key, count: byDate.get(key) ?? 0, month: cursor.getUTCMonth() });
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

  // rótulos de mês: marca a coluna onde o mês muda
  const monthLabels = useMemo(() => {
    const labels: { index: number; month: number }[] = [];
    let last = -1;
    weeks.forEach((col, i) => {
      const m = col[0]!.month;
      if (m !== last) {
        labels.push({ index: i, month: m });
        last = m;
      }
    });
    return labels;
  }, [weeks]);

  const toggle = (p: Provider) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next.size === 0 ? new Set(PROVIDERS) : next;
    });

  const cell = (count: number, key: string, dim = false) => {
    const lv = level(count, max);
    const base = "h-[11px] w-[11px] rounded-[2px]";
    if (lv === -1) {
      return (
        <div
          key={key}
          title={`${key}: 0 contribuições`}
          className={`${base} bg-neutral-200 dark:bg-neutral-800 ${dim ? "opacity-40" : ""}`}
        />
      );
    }
    return (
      <div
        key={key}
        title={`${key}: ${count} contribuições`}
        className={base}
        style={{ background: LEVELS[lv] }}
      />
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium">
          <span className="tabular-nums">{total}</span>{" "}
          <span className="font-normal text-neutral-500">
            contribuições no último ano
          </span>
        </p>
        <div className="flex gap-1.5 text-xs">
          {PROVIDERS.map((p) => {
            const on = active.has(p);
            return (
              <button
                key={p}
                onClick={() => toggle(p)}
                className={
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium transition " +
                  (on
                    ? "border-neutral-300 text-neutral-800 dark:border-neutral-600 dark:text-neutral-100"
                    : "border-neutral-200 text-neutral-400 opacity-60 dark:border-neutral-800")
                }
                style={on ? { color: providerMeta[p].color } : undefined}
              >
                <ProviderIcon provider={p} className="h-3.5 w-3.5" />
                {providerMeta[p].label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="inline-flex flex-col gap-1">
          {/* rótulos de mês */}
          <div className="relative ml-7 h-4 text-[10px] text-neutral-400">
            {monthLabels.map((l) => (
              <span
                key={`${l.index}-${l.month}`}
                className="absolute top-0"
                style={{ left: `${l.index * 14}px` }}
              >
                {MONTHS[l.month]}
              </span>
            ))}
          </div>

          <div className="flex gap-[3px]">
            {/* dias da semana */}
            <div className="mr-1 flex w-6 flex-col gap-[3px] text-[9px] leading-[11px] text-neutral-400">
              {["", "Seg", "", "Qua", "", "Sex", ""].map((d, i) => (
                <span key={i} className="h-[11px]">
                  {d}
                </span>
              ))}
            </div>
            {weeks.map((col, i) => (
              <div key={i} className="flex flex-col gap-[3px]">
                {col.map((c) => cell(c.count, c.date))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* legenda */}
      <div className="flex items-center gap-1.5 text-[10px] text-neutral-400">
        <span>Menos</span>
        <div className="h-[11px] w-[11px] rounded-[2px] bg-neutral-200 dark:bg-neutral-800" />
        {LEVELS.map((c) => (
          <div
            key={c}
            className="h-[11px] w-[11px] rounded-[2px]"
            style={{ background: c }}
          />
        ))}
        <span>Mais</span>
      </div>
    </div>
  );
}
