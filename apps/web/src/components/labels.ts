import type { ActivityType, Provider } from "@devpulse/core";

export const providerMeta: Record<
  Provider,
  { label: string; color: string; icon: string }
> = {
  GITHUB: { label: "GitHub", color: "#6e5494", icon: "" },
  GITLAB: { label: "GitLab", color: "#fc6d26", icon: "" },
};

export const typeLabel: Record<ActivityType, string> = {
  COMMIT: "Commit",
  PUSH: "Push",
  PR: "Pull request",
  MR: "Merge request",
  ISSUE: "Issue",
  REVIEW: "Review",
  COMMENT: "Comentário",
  RELEASE: "Release",
  OTHER: "Atividade",
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
