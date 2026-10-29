import type { WorkItem } from "@devpulse/core/work";

/** Slug ASCII curto para nome de branch ("Corrigir login no Safari" → "corrigir-login-no-safari"). */
export function slugify(text: string, max = 40): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, max)
    .replace(/^-+|-+$/g, "");
}

/** Branch sugerida; o prefixo `claude/` também é um sinal do AI Pulse. */
export function claudeBranch(item: Pick<WorkItem, "number" | "title">): string {
  const n = item.number.replace(/[^0-9A-Za-z]/g, "");
  const slug = slugify(item.title);
  return `claude/${[n, slug].filter(Boolean).join("-") || "task"}`;
}

/** Aspas simples de shell: seguro para qualquer título (inclusive `$`, crases e aspas). */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Comando para colar no terminal do repositório: abre o Claude Code já com a
 * tarefa, usando as ferramentas do MCP `devpulse`.
 */
export function buildClaudeCommand(
  connectionId: string,
  item: Pick<WorkItem, "ref" | "number" | "title">,
): string {
  const prompt = [
    `Vamos trabalhar na tarefa ${item.ref} do DevPulse (connectionId ${connectionId}).`,
    `1. Use a ferramenta get_task do MCP devpulse para ler a tarefa e os comentários.`,
    `2. Crie a branch ${claudeBranch(item)} a partir da branch principal atualizada.`,
    `3. Se a tarefa estiver num board, mova o card para a coluna de andamento (In Progress/Doing) com move_card.`,
    `4. Comente na tarefa com comment_task: "Iniciado no Claude Code (branch ${claudeBranch(item)})".`,
    `5. Analise o código e proponha um plano de implementação antes de editar.`,
  ].join("\n");
  return `claude ${shellQuote(prompt)}`;
}
