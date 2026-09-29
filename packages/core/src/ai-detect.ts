/**
 * Detecção de atividades assistidas por IA (AI Pulse).
 *
 * Função pura sobre "evidências" extraídas do payload cru de cada provedor
 * (ver `ProviderAdapter.aiEvidence`): mensagens/descrições, logins de autores e
 * nomes de branch. Como opera sobre o `raw` persistido, dá para re-detectar o
 * histórico sem voltar a chamar a API do provedor.
 */

export type AiTool =
  | "claude"
  | "copilot"
  | "cursor"
  | "codex"
  | "devin"
  | "gemini"
  | "other";

/** De onde veio a evidência (da mais forte para a mais fraca). */
export type AiSignal = "trailer" | "marker" | "bot_author" | "branch";

export interface AiAttribution {
  tool: AiTool;
  signal: AiSignal;
}

/** Evidências cruas (qualquer campo pode faltar, conforme o provedor). */
export interface AiEvidence {
  /** Mensagens de commit, títulos/descrições de PR. */
  texts?: (string | null | undefined)[];
  /** Logins/nomes/e-mails de autores (commit author, PR creator). */
  authors?: (string | null | undefined)[];
  /** Branches (com ou sem `refs/heads/`). */
  branches?: (string | null | undefined)[];
}

/** Ordem importa: "github copilot" não deve cair em outro balde. */
const TOOL_PATTERNS: [AiTool, RegExp][] = [
  ["claude", /\b(claude|anthropic)\b/i],
  ["copilot", /\bcopilot\b/i],
  ["cursor", /\bcursor(agent|-agent)?\b/i],
  ["codex", /\b(codex|openai|chatgpt)\b/i],
  ["devin", /\bdevin\b/i],
  ["gemini", /\b(gemini|jules)\b/i],
];

export function classifyTool(text: string): AiTool | null {
  for (const [tool, re] of TOOL_PATTERNS) if (re.test(text)) return tool;
  return null;
}

/**
 * Trailers de atribuição. `Co-authored-by` só conta se o coautor for uma
 * ferramenta de IA (pair programming humano é comum); `Generated-by`,
 * `Assisted-by` e afins são explicitamente de IA → `other` se não reconhecida.
 */
const TRAILER_RE =
  /^\s*(co-authored-by|generated-by|assisted-by|ai-assisted-by|ai-generated-by)\s*:\s*(.+)$/gim;

/** Rodapés que as próprias ferramentas colocam em commits/PRs. */
const MARKER_RE =
  /(generated with \[?(claude code|codex|cursor|copilot)|🤖 generated with|co-authored with (claude|copilot|cursor))/i;

/** Contas de agentes que abrem PRs/commits. */
const BOT_AUTHOR_RE =
  /^(copilot|copilot-swe-agent|claude|devin-ai-integration|cursor|chatgpt-codex-connector|google-labs-jules|codex)(\[bot\])?$|noreply@anthropic\.com|copilot@github\.com|cursoragent@cursor\.com/i;

/** Prefixos de branch criados por agentes (ex.: claude/fix-x, copilot/foo). */
const BRANCH_RE = /^(?:refs\/heads\/)?(claude|copilot|codex|cursor|devin|jules)[/_-]/i;

function nonEmpty(xs: (string | null | undefined)[] | undefined): string[] {
  return (xs ?? []).filter((x): x is string => typeof x === "string" && x.length > 0);
}

export function detectAi(ev: AiEvidence): AiAttribution | null {
  const texts = nonEmpty(ev.texts);

  for (const text of texts) {
    for (const m of text.matchAll(TRAILER_RE)) {
      const kind = m[1]!.toLowerCase();
      const tool = classifyTool(m[2]!);
      if (tool) return { tool, signal: "trailer" };
      if (kind !== "co-authored-by") return { tool: "other", signal: "trailer" };
    }
  }

  for (const text of texts) {
    const m = MARKER_RE.exec(text);
    if (m) {
      // Classifica pela linha inteira: "🤖 Generated with [Claude Code]" casa
      // no emoji, mas a ferramenta vem depois.
      const line = text.slice(m.index).split("\n")[0]!;
      return { tool: classifyTool(line) ?? "other", signal: "marker" };
    }
  }

  for (const author of nonEmpty(ev.authors)) {
    if (BOT_AUTHOR_RE.test(author.trim())) {
      return { tool: classifyTool(author) ?? "other", signal: "bot_author" };
    }
  }

  for (const branch of nonEmpty(ev.branches)) {
    const m = branch.match(BRANCH_RE);
    if (m) return { tool: classifyTool(m[1]!) ?? "other", signal: "branch" };
  }

  return null;
}
