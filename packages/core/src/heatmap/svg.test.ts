import { describe, expect, it } from "vitest";
import { buildWeeks, level, monthLabels } from "./grid.js";
import { escapeXml, renderErrorSvg, renderHeatmapSvg } from "./svg.js";
import type { EmbedDay, RenderHeatmapOptions } from "./svg.js";

const NOW = new Date("2026-09-29T12:00:00Z");

const base: RenderHeatmapOptions = {
  theme: "light",
  providers: ["GITHUB", "GITLAB", "AZURE"],
  colorBy: "level",
  header: true,
  now: NOW,
};

const days: EmbedDay[] = [
  { date: "2026-09-28", byProvider: { GITHUB: 3, GITLAB: 5 } },
  { date: "2026-09-01", byProvider: { AZURE: 2 } },
  { date: "2025-12-25", byProvider: { GITHUB: 1 } },
];

const cellCount = (svg: string) => (svg.match(/<rect [^>]*width="11"[^>]*>/g) ?? []).length;

describe("grid", () => {
  it("level: buckets relativos ao máximo", () => {
    expect(level(0, 10)).toBe(-1);
    expect(level(1, 10)).toBe(0);
    expect(level(2, 10)).toBe(1);
    expect(level(5, 10)).toBe(2);
    expect(level(10, 10)).toBe(3);
  });

  it("buildWeeks: colunas de 7 dias começando no domingo e terminando hoje", () => {
    const weeks = buildWeeks(new Map(), { now: NOW });
    expect(weeks.every((c) => c.length === 7)).toBe(true);
    expect(new Date(weeks[0]![0]!.date).getUTCDay()).toBe(0);
    expect(weeks.flat().some((c) => c.date === "2026-09-29")).toBe(true);
    expect(weeks.length).toBe(53);
  });

  it("monthLabels: nunca rotula a última coluna nem repete mês", () => {
    const weeks = buildWeeks(new Map(), { now: NOW });
    const labels = monthLabels(weeks);
    expect(labels.has(weeks.length - 1)).toBe(false);
    const months = [...labels.values()];
    expect(new Set(months).size).toBe(months.length);
  });
});

describe("renderHeatmapSvg", () => {
  it("gera SVG com uma célula por dia da grade e o total somado", () => {
    const svg = renderHeatmapSvg(days, base);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    // 53 semanas × 7 dias + 5 quadrados da legenda
    expect(cellCount(svg)).toBe(53 * 7 + 5);
    expect(svg).toContain("11 contribuições no último ano");
    expect(svg).not.toContain("<script");
  });

  it("filtro de provedores altera o total", () => {
    const svg = renderHeatmapSvg(days, { ...base, providers: ["GITLAB"] });
    expect(svg).toContain("5 contribuições no último ano");
    expect(svg).not.toContain("Azure DevOps");
  });

  it("singular com uma contribuição", () => {
    const svg = renderHeatmapSvg(days, { ...base, providers: ["GITHUB"] });
    expect(svg).toContain("4 contribuições");
    const one = renderHeatmapSvg([days[2]!], base);
    expect(one).toContain("1 contribuição no último ano");
  });

  it("cor por provedor usa a cor do provedor dominante no dia", () => {
    const svg = renderHeatmapSvg(days, { ...base, colorBy: "provider" });
    // 2026-09-28: GitLab (5) domina GitHub (3)
    expect(svg).toMatch(/fill="#fc6d26" fill-opacity="1"><title>2026-09-28/);
    expect(svg).toMatch(/fill="#0078d4" fill-opacity="[\d.]+"><title>2026-09-01/);
  });

  it("tema auto inclui a media query de modo escuro; light/dark não", () => {
    expect(renderHeatmapSvg(days, { ...base, theme: "auto" })).toContain(
      "prefers-color-scheme: dark",
    );
    expect(renderHeatmapSvg(days, base)).not.toContain("prefers-color-scheme");
    expect(renderHeatmapSvg(days, { ...base, theme: "dark" })).toContain("--bg:#0d1117");
  });

  it("sem cabeçalho omite o texto de total visível", () => {
    const svg = renderHeatmapSvg(days, { ...base, header: false });
    expect(svg).not.toContain('<text class="t"');
  });

  it("ignora dias fora da janela da grade", () => {
    const svg = renderHeatmapSvg(
      [{ date: "2024-01-01", byProvider: { GITHUB: 99 } }],
      base,
    );
    expect(svg).toContain("0 contribuições no último ano");
  });
});

describe("escape", () => {
  it("escapa caracteres especiais de XML", () => {
    expect(escapeXml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
    expect(renderErrorSvg("<b>")).toContain("&lt;b&gt;");
  });
});
