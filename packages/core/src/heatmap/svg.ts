import type { Provider } from "@prisma/client";
import { buildWeeks, LEVELS, level, monthLabels, MONTHS } from "./grid.js";
import { PROVIDER_ICON_PATHS, PROVIDER_META } from "./providers.js";

/**
 * Renderizador do heatmap como SVG autocontido (string), para o embed público
 * (ex.: README do perfil do GitHub). Sem scripts nem recursos externos — o
 * proxy de imagens do GitHub (camo) só aceita SVG estático.
 */

export type EmbedTheme = "light" | "dark" | "auto";
export type EmbedColorBy = "level" | "provider";

export interface EmbedDay {
  date: string; // YYYY-MM-DD (UTC)
  byProvider: Partial<Record<Provider, number>>;
}

export interface RenderHeatmapOptions {
  theme: EmbedTheme;
  /** Provedores somados na imagem, na ordem de exibição. */
  providers: Provider[];
  colorBy: EmbedColorBy;
  /** Cabeçalho com total do período e ícones dos provedores. */
  header: boolean;
  /** Referência de "hoje" (testes); padrão = agora. */
  now?: Date;
}

const CELL = 11;
const PITCH = 14; // célula + 3px de gap
const PAD = 16;
const LEFT = 28; // coluna dos dias da semana
const HEADER_H = 30;
const MONTH_H = 16;
const FOOTER_H = 26;
const FONT = `-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif`;
const WEEKDAYS: Record<number, string> = { 1: "Seg", 3: "Qua", 5: "Sex" };
/** Opacidade por nível no modo "cor por provedor". */
const PROVIDER_OPACITY = [0.4, 0.6, 0.8, 1];

const PALETTE = {
  light: {
    bg: "#ffffff",
    border: "#d0d7de",
    text: "#1f2328",
    muted: "#656d76",
    empty: "#ebedf0",
    levels: LEVELS,
  },
  dark: {
    bg: "#0d1117",
    border: "#30363d",
    text: "#e6edf3",
    muted: "#8b949e",
    empty: "#161b22",
    levels: ["#0e4429", "#006d32", "#26a641", "#39d353"],
  },
};

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function vars(p: (typeof PALETTE)["light"]): string {
  return (
    `--bg:${p.bg};--border:${p.border};--text:${p.text};--muted:${p.muted};--empty:${p.empty};` +
    p.levels.map((c, i) => `--l${i}:${c};`).join("")
  );
}

function style(theme: EmbedTheme): string {
  const base = theme === "dark" ? PALETTE.dark : PALETTE.light;
  let css = `svg{${vars(base)}}`;
  if (theme === "auto") {
    css += `@media (prefers-color-scheme: dark){svg{${vars(PALETTE.dark)}}}`;
  }
  css +=
    `.bg{fill:var(--bg);stroke:var(--border)}` +
    `.t{fill:var(--text);font:600 13px ${FONT}}` +
    `.m{fill:var(--muted);font:400 10px ${FONT}}` +
    `.e{fill:var(--empty)}` +
    [0, 1, 2, 3].map((i) => `.l${i}{fill:var(--l${i})}`).join("");
  return css;
}

function icon(p: Provider, x: number, y: number, size: number): string {
  const { viewBox, d } = PROVIDER_ICON_PATHS[p];
  const s = size / viewBox;
  return `<path transform="translate(${x} ${y}) scale(${s})" fill="${PROVIDER_META[p].color}" d="${d}"/>`;
}

/** Largura aproximada de texto (sem medir fontes) para alinhar à direita. */
function textWidth(s: string, px: number): number {
  return s.length * px * 0.58;
}

function plural(n: number): string {
  return n === 1 ? "contribuição" : "contribuições";
}

export function renderHeatmapSvg(days: EmbedDay[], opts: RenderHeatmapOptions): string {
  const providers = opts.providers;

  // total e provedor dominante por dia, só entre os provedores selecionados
  const byDate = new Map<string, number>();
  const dominant = new Map<string, Provider>();
  for (const d of days) {
    let total = 0;
    let top: Provider | undefined;
    let topCount = 0;
    for (const p of providers) {
      const c = d.byProvider[p] ?? 0;
      total += c;
      if (c > topCount) {
        top = p;
        topCount = c;
      }
    }
    if (total > 0) byDate.set(d.date, total);
    if (top) dominant.set(d.date, top);
  }

  const weeks = buildWeeks(byDate, { now: opts.now });
  const labels = monthLabels(weeks);
  // máximo e total só do que cabe na grade (a consulta pode trazer dias a mais)
  let max = 1;
  let total = 0;
  for (const c of weeks.flat()) {
    if (c.count > max) max = c.count;
    total += c.count;
  }

  const gridW = weeks.length * PITCH - (PITCH - CELL);
  const gridH = 7 * PITCH - (PITCH - CELL);
  const width = PAD * 2 + LEFT + gridW;
  const headerH = opts.header ? HEADER_H : 0;
  const top = PAD + headerH;
  const gridY = top + MONTH_H;
  const height = gridY + gridH + FOOTER_H + PAD - 6;
  const gx = PAD + LEFT;

  const out: string[] = [];
  const title = `${total.toLocaleString("pt-BR")} ${plural(total)} no último ano`;
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="t">`,
    `<title id="t">DevPulse — ${escapeXml(title)}</title>`,
    `<style>${style(opts.theme)}</style>`,
    `<rect class="bg" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="6"/>`,
  );

  // cabeçalho: total à esquerda, ícones+rótulos dos provedores à direita
  if (opts.header) {
    out.push(`<text class="t" x="${PAD}" y="${PAD + 12}">${escapeXml(title)}</text>`);
    let x = width - PAD;
    for (const p of [...providers].reverse()) {
      const label = PROVIDER_META[p].label;
      out.push(
        `<text class="m" x="${x}" y="${PAD + 11}" text-anchor="end">${escapeXml(label)}</text>`,
      );
      x -= textWidth(label, 10) + 16;
      out.push(icon(p, x, PAD + 1, 12));
      x -= 12;
    }
  }

  // meses
  for (const [i, m] of labels) {
    out.push(`<text class="m" x="${gx + i * PITCH}" y="${top + 10}">${MONTHS[m]}</text>`);
  }
  // dias da semana
  for (const [row, name] of Object.entries(WEEKDAYS)) {
    out.push(
      `<text class="m" x="${PAD}" y="${gridY + Number(row) * PITCH + 9}">${name}</text>`,
    );
  }

  // células
  weeks.forEach((col, i) => {
    col.forEach((c, row) => {
      const x = gx + i * PITCH;
      const y = gridY + row * PITCH;
      const lv = level(c.count, max);
      const tip = `<title>${c.date}: ${c.count} ${plural(c.count)}</title>`;
      const geom = `x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2"`;
      if (lv === -1) {
        out.push(`<rect class="e" ${geom}>${tip}</rect>`);
      } else if (opts.colorBy === "provider") {
        const p = dominant.get(c.date)!;
        out.push(
          `<rect ${geom} fill="${PROVIDER_META[p].color}" fill-opacity="${PROVIDER_OPACITY[lv]}">${tip}</rect>`,
        );
      } else {
        out.push(`<rect class="l${lv}" ${geom}>${tip}</rect>`);
      }
    });
  });

  // rodapé: marca à esquerda, legenda à direita
  const fy = gridY + gridH + 10;
  out.push(`<text class="m" x="${gx}" y="${fy + 9}">DevPulse</text>`);
  let x = width - PAD;
  if (opts.colorBy === "provider") {
    for (const p of [...providers].reverse()) {
      const label = PROVIDER_META[p].label;
      out.push(`<text class="m" x="${x}" y="${fy + 9}" text-anchor="end">${escapeXml(label)}</text>`);
      x -= textWidth(label, 10) + 4 + CELL;
      out.push(
        `<rect x="${x}" y="${fy}" width="${CELL}" height="${CELL}" rx="2" fill="${PROVIDER_META[p].color}"/>`,
      );
      x -= 12;
    }
  } else {
    out.push(`<text class="m" x="${x}" y="${fy + 9}" text-anchor="end">Mais</text>`);
    x -= textWidth("Mais", 10) + 4 + CELL;
    for (let i = 3; i >= -1; i--) {
      out.push(
        `<rect class="${i === -1 ? "e" : `l${i}`}" x="${x}" y="${fy}" width="${CELL}" height="${CELL}" rx="2"/>`,
      );
      x -= PITCH;
    }
    out.push(`<text class="m" x="${x + PITCH - 4}" y="${fy + 9}" text-anchor="end">Menos</text>`);
  }

  out.push(`</svg>`);
  return out.join("");
}

/** SVG pequeno de erro (token inválido/desativado), no mesmo estilo visual. */
export function renderErrorSvg(message: string, theme: EmbedTheme = "auto"): string {
  const width = 360;
  const height = 48;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="t">` +
    `<title id="t">DevPulse — ${escapeXml(message)}</title>` +
    `<style>${style(theme)}</style>` +
    `<rect class="bg" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="6"/>` +
    `<text class="m" x="${PAD}" y="${height / 2 + 4}" style="font-size:12px">DevPulse · ${escapeXml(message)}</text>` +
    `</svg>`
  );
}
