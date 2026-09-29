/**
 * Lógica pura da grade do heatmap (colunas semanais estilo GitHub), compartilhada
 * entre o componente React da web e o renderizador SVG do embed. Sem Prisma,
 * sem React — seguro para importar em client components.
 */

export const MONTHS = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

/** Escala verde (claro) do GitHub, do nível 0 ao 3. */
export const LEVELS = ["#9be9a8", "#40c463", "#30a14e", "#216e39"];

/** Nível 0–3 da célula relativo ao máximo do período; -1 = sem contribuições. */
export function level(count: number, max: number): number {
  if (count === 0) return -1;
  const r = count / Math.max(max, 1);
  if (r > 0.66) return 3;
  if (r > 0.33) return 2;
  if (r > 0.1) return 1;
  return 0;
}

export interface GridCell {
  date: string; // YYYY-MM-DD (UTC)
  count: number;
  month: number; // 0–11
}

/**
 * Colunas de 7 dias (domingo→sábado). Com `year`, cobre o ano-calendário
 * inteiro (dias futuros ficam vazios, como no GitHub); sem, os últimos 365
 * dias até `now`. O início recua até o domingo anterior para alinhar.
 */
export function buildWeeks(
  byDate: Map<string, number>,
  opts: { year?: number; now?: Date } = {},
): GridCell[][] {
  const today = new Date(opts.now ?? Date.now());
  today.setUTCHours(0, 0, 0, 0);

  let start: Date;
  let end: Date;
  if (opts.year) {
    start = new Date(Date.UTC(opts.year, 0, 1));
    end = new Date(Date.UTC(opts.year, 11, 31));
  } else {
    end = today;
    start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 364);
  }
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());

  const cols: GridCell[][] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const col: GridCell[] = [];
    for (let d = 0; d < 7; d++) {
      const key = cursor.toISOString().slice(0, 10);
      col.push({ date: key, count: byDate.get(key) ?? 0, month: cursor.getUTCMonth() });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    cols.push(col);
  }
  return cols;
}

/**
 * Rótulos de mês por índice de coluna: rotula a coluna onde um mês COMEÇA (a
 * semana que contém o dia 1º). Na primeira coluna, se nenhum mês começa ali
 * (ex.: janela móvel), usa o mês do meio da semana. Como os inícios de mês
 * distam ~4 semanas, os rótulos nunca ficam colados. Pula a última coluna para
 * não duplicar o mês de um resquício de semana no fim.
 */
export function monthLabels(weeks: GridCell[][]): Map<number, number> {
  const m = new Map<number, number>();
  let last = -1;
  weeks.forEach((col, i) => {
    const starts = col.find((d) => d.date.slice(8, 10) === "01");
    const candidate = starts?.month ?? (i === 0 ? col[3]!.month : null);
    if (candidate !== null && candidate !== last) {
      if (i < weeks.length - 1) m.set(i, candidate);
      last = candidate;
    }
  });
  return m;
}
