import type { ActivityType, Provider } from "@devpulse/core";

export const providerMeta: Record<
  Provider,
  { label: string; color: string }
> = {
  GITHUB: { label: "GitHub", color: "#8957e5" },
  GITLAB: { label: "GitLab", color: "#fc6d26" },
  AZURE: { label: "Azure DevOps", color: "#0078d4" },
};

/** Classe Tailwind de cor (texto) por tipo, para o badge de ícone no feed. */
export const typeMeta: Record<ActivityType, { label: string; tint: string }> = {
  COMMIT: { label: "Commit", tint: "text-emerald-600 dark:text-emerald-400" },
  PUSH: { label: "Push", tint: "text-emerald-600 dark:text-emerald-400" },
  PR: { label: "Pull request", tint: "text-violet-600 dark:text-violet-400" },
  MR: { label: "Merge request", tint: "text-orange-600 dark:text-orange-400" },
  ISSUE: { label: "Issue", tint: "text-sky-600 dark:text-sky-400" },
  REVIEW: { label: "Review", tint: "text-teal-600 dark:text-teal-400" },
  COMMENT: { label: "Comentário", tint: "text-amber-600 dark:text-amber-400" },
  RELEASE: { label: "Release", tint: "text-pink-600 dark:text-pink-400" },
  OTHER: { label: "Atividade", tint: "text-neutral-500 dark:text-neutral-400" },
};

export const typeLabel: Record<ActivityType, string> = Object.fromEntries(
  Object.entries(typeMeta).map(([k, v]) => [k, v.label]),
) as Record<ActivityType, string>;

/** Rótulo de PR/MR conforme o provedor (GitLab usa "Merge request"). */
export function prLabel(provider: Provider): string {
  return provider === "GITLAB" ? "Merge request" : "Pull request";
}

/**
 * Agrupa tipos equivalentes entre provedores para as métricas "Por tipo":
 * PR|MR → PR (pull/merge request) e PUSH|COMMIT → PUSH (contribuição de código).
 * Mantém a comparabilidade mesmo com adapters emitindo tipos distintos.
 */
export function typeGroup(type: ActivityType): ActivityType {
  if (type === "MR") return "PR";
  if (type === "COMMIT") return "PUSH";
  return type;
}

/** Tipos exibidos nas métricas/filtros, já na forma agrupada e ordenada. */
export const DISPLAY_TYPES: ActivityType[] = [
  "PUSH",
  "PR",
  "ISSUE",
  "REVIEW",
  "COMMENT",
  "RELEASE",
];

/** Tipos concretos que um tipo exibido representa (para filtrar o feed). */
export function groupMembers(type: ActivityType): ActivityType[] {
  if (type === "PR") return ["PR", "MR"];
  if (type === "PUSH") return ["PUSH", "COMMIT"];
  return [type];
}

/** Rótulo do card de tipo agrupado (grão misto de PUSH/COMMIT explicitado). */
export const groupTypeLabel: Partial<Record<ActivityType, string>> = {
  PUSH: "Commits/Pushes",
  PR: "Pull/Merge request",
};

export function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min atrás`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d atrás`;
  return date.toLocaleDateString("pt-BR");
}
