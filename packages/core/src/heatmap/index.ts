// Módulo puro (sem Prisma/Redis em runtime): seguro para client components.
export { buildWeeks, level, LEVELS, monthLabels, MONTHS } from "./grid.js";
export type { GridCell } from "./grid.js";
export { ALL_PROVIDERS, PROVIDER_ICON_PATHS, PROVIDER_META } from "./providers.js";
export { escapeXml, renderErrorSvg, renderHeatmapSvg } from "./svg.js";
export type {
  EmbedColorBy,
  EmbedDay,
  EmbedTheme,
  RenderHeatmapOptions,
} from "./svg.js";
