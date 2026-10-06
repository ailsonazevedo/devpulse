import { WorkInputError } from "./errors.js";

/** Separa `container#id` pelo último "#" (o id é sempre numérico). */
export function splitRef(ref: string): { container: string; id: string } {
  const i = ref.lastIndexOf("#");
  const container = i > 0 ? ref.slice(0, i) : "";
  const id = i > 0 ? ref.slice(i + 1) : "";
  if (!container || !/^\d+$/.test(id)) {
    throw new WorkInputError(`Referência inválida: ${ref}`);
  }
  return { container, id };
}

export function joinRef(container: string | number, id: string | number): string {
  return `${container}#${id}`;
}

/** Cursor numérico (página/offset) serializado como string. */
export function parseNumCursor(cursor: string | null | undefined, fallback: number): number {
  const n = Number(cursor);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/**
 * HTML (descrições/comentários do Azure) → texto legível. Não é um parser
 * completo: só preserva quebras de bloco e remove as tags — suficiente para
 * exibir e editar como texto puro.
 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Texto puro → HTML seguro (escapa e converte quebras em <br>). */
export function textToHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>");
}
