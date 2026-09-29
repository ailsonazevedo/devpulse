import type { Provider } from "@prisma/client";

/** Ordem canônica de exibição dos provedores. */
export const ALL_PROVIDERS: Provider[] = ["GITHUB", "GITLAB", "AZURE"];

/** Rótulo e cor de marca por provedor (fonte única para web e embed SVG). */
export const PROVIDER_META: Record<Provider, { label: string; color: string }> = {
  GITHUB: { label: "GitHub", color: "#8957e5" },
  GITLAB: { label: "GitLab", color: "#fc6d26" },
  AZURE: { label: "Azure DevOps", color: "#0078d4" },
};

/** Paths SVG das marcas (mesmos de apps/web/src/components/icons.tsx). */
export const PROVIDER_ICON_PATHS: Record<Provider, { viewBox: number; d: string }> = {
  GITHUB: {
    viewBox: 16,
    d: "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z",
  },
  GITLAB: {
    viewBox: 24,
    d: "M23.955 13.587l-1.342-4.135-2.664-8.189a.455.455 0 0 0-.867 0L16.418 9.45H7.582L4.919 1.263a.455.455 0 0 0-.867 0L1.386 9.45.044 13.587a.924.924 0 0 0 .331 1.023L12 23.054l11.625-8.443a.924.924 0 0 0 .33-1.024Z",
  },
  AZURE: {
    viewBox: 24,
    d: "M2.4 16.03l6.9-1.2 5.72 6.78a.4.4 0 0 0 .43.13l6.15-2.03V4.5L15.6.3a.4.4 0 0 0-.5.06l-9.9 11.02-2.8-2.15V16Zm12.98-9.2v9.96l-5.13-4.28 5.13-5.68Z",
  },
};
