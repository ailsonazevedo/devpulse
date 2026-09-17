"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Provider } from "@devpulse/core";
import type { HeatmapDay } from "@/lib/queries";
import { providerMeta } from "@/components/labels";
import { ProviderIcon } from "@/components/icons";

const ALL_PROVIDERS: Provider[] = ["GITHUB", "GITLAB", "AZURE"];
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

export function Heatmap({
  days,
  providers,
  year,
  years,
}: {
  days: HeatmapDay[];
  /** Provedores conectados a exibir; vazio/ausente cai em todos. */
  providers?: Provider[];
  /** Ano-calendário selecionado; ausente = janela móvel dos últimos 365 dias. */
  year?: number;
  /** Anos com dados disponíveis, para o seletor. */
  years?: number[];
}) {
  const shown =
    providers && providers.length > 0 ? providers : ALL_PROVIDERS;
  const [active, setActive] = useState<Set<Provider>>(new Set(shown));

  // Total por provedor no período exibido (independe do toggle) — dirige a
  // indicação de cobertura e o estado desabilitado dos chips.
  const providerTotals = useMemo(() => {
    const t = {} as Record<Provider, number>;
    for (const p of shown) {
      let s = 0;
      for (const d of days) s += d.byProvider[p] ?? 0;
      t[p] = s;
    }
    return t;
  }, [days, shown]);

  const withData = shown.filter((p) => (providerTotals[p] ?? 0) > 0);
  const withoutData = shown.filter((p) => (providerTotals[p] ?? 0) === 0);
  const allEmpty = withData.length === 0;

  const byDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of days) {
      let total = 0;
      for (const p of shown) if (active.has(p)) total += d.byProvider[p] ?? 0;
      m.set(d.date, total);
    }
    return m;
  }, [days, active, shown]);

  const weeks = useMemo(() => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    let start: Date;
    let end: Date;
    if (year) {
      // Ano-calendário inteiro (jan–dez). Dias futuros ficam vazios, como no
      // GitHub — o ano corrente mostra os meses que ainda não chegaram vazios.
      start = new Date(Date.UTC(year, 0, 1));
      end = new Date(Date.UTC(year, 11, 31));
    } else {
      end = today;
      start = new Date(today);
      start.setUTCDate(start.getUTCDate() - 364);
    }
    // recua até o domingo anterior para alinhar as colunas
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());

    const cols: { date: string; count: number; month: number }[][] = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const col: { date: string; count: number; month: number }[] = [];
      for (let d = 0; d < 7; d++) {
        const key = cursor.toISOString().slice(0, 10);
        col.push({ date: key, count: byDate.get(key) ?? 0, month: cursor.getUTCMonth() });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      cols.push(col);
    }
    return cols;
  }, [byDate, year]);

  const max = useMemo(() => Math.max(1, ...byDate.values()), [byDate]);
  const total = useMemo(
    () => [...byDate.values()].reduce((a, b) => a + b, 0),
    [byDate],
  );

  // rótulos de mês: rotula a coluna onde um mês COMEÇA (a semana que contém o
  // dia 1º). Na primeira coluna, se nenhum mês começa ali (ex.: janela móvel),
  // usa o mês do meio da semana. Como os inícios de mês distam ~4 semanas, os
  // rótulos nunca ficam colados. Pula a última coluna para não duplicar o mês
  // de um resquício de semana no fim (ex.: "jan" no fim de um ano-calendário).
  const labelByCol = useMemo(() => {
    const m = new Map<number, number>();
    let last = -1;
    weeks.forEach((col, i) => {
      const starts = col.find((d) => d.date.slice(8, 10) === "01");
      const candidate =
        starts?.month ?? (i === 0 ? col[3]!.month : null);
      if (candidate !== null && candidate !== last) {
        if (i < weeks.length - 1) m.set(i, candidate);
        last = candidate;
      }
    });
    return m;
  }, [weeks]);

  const toggle = (p: Provider) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next.size === 0 ? new Set(shown) : next;
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

  const yearList = years ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium">
          <span className="tabular-nums">{total}</span>{" "}
          <span className="font-normal text-neutral-500">
            {total === 1 ? "contribuição" : "contribuições"}{" "}
            {year ? `em ${year}` : "no último ano"}
          </span>
        </p>
        <div className="flex gap-1.5 text-xs">
          {shown.map((p) => {
            const hasData = (providerTotals[p] ?? 0) > 0;
            const on = active.has(p);
            if (!hasData) {
              return (
                <span
                  key={p}
                  title="sem dados neste período"
                  className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full border border-dashed border-neutral-200 px-2.5 py-1 font-medium text-neutral-300 dark:border-neutral-800 dark:text-neutral-600"
                >
                  <ProviderIcon provider={p} className="h-3.5 w-3.5" />
                  {providerMeta[p].label}
                </span>
              );
            }
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

      {/* cobertura por provedor no período */}
      {!allEmpty && (
        <p className="text-xs text-neutral-400">
          Mostrando:{" "}
          <span className="text-neutral-500">
            {withData.map((p) => providerMeta[p].label).join(" · ")}
          </span>
          {withoutData.length > 0 && (
            <>
              {" — sem dados neste período: "}
              {withoutData.map((p) => providerMeta[p].label).join(", ")}
            </>
          )}
        </p>
      )}

      <div className="flex gap-4">
        {/* Células de tamanho fixo (compacto, estilo GitHub); em telas estreitas
            rola na horizontal — nunca esconde meses nem cola os rótulos. */}
        <div className="min-w-0 flex-1 overflow-x-auto pb-1">
          <div className="inline-flex flex-col gap-1">
            {/* rótulos de mês (pitch de 14px por coluna) */}
            <div className="relative ml-7 h-4 text-[10px] text-neutral-400">
              {[...labelByCol.entries()].map(([i, m]) => (
                <span
                  key={i}
                  className="absolute top-0 whitespace-nowrap"
                  style={{ left: `${i * 14}px` }}
                >
                  {MONTHS[m]}
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

        {/* seletor de ano (estilo GitHub) */}
        {yearList.length > 0 && (
          <div className="flex shrink-0 flex-col gap-1 text-xs">
            <YearButton href="/heatmap" active={!year}>
              Último ano
            </YearButton>
            {yearList.map((y) => (
              <YearButton
                key={y}
                href={`/heatmap?year=${y}`}
                active={year === y}
              >
                {y}
              </YearButton>
            ))}
          </div>
        )}
      </div>

      {allEmpty && (
        <p className="text-xs text-neutral-400">
          Nenhuma contribuição registrada{year ? ` em ${year}` : ""} — o
          histórico pode não ter sido sincronizado para todos os provedores.
        </p>
      )}

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

function YearButton({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        "rounded-md px-3 py-1 text-right font-medium transition-colors " +
        (active
          ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
          : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800")
      }
    >
      {children}
    </Link>
  );
}
