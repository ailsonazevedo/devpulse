import { aiToolLabel } from "@/components/labels";

/** Selo "IA · <ferramenta>" para atividades detectadas pelo AI Pulse. */
export function AiBadge({ tool }: { tool: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-violet-200 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:border-violet-800 dark:text-violet-300">
      IA · {aiToolLabel[tool] ?? tool}
    </span>
  );
}
