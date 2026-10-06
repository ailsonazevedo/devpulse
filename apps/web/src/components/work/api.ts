import type { Provider } from "@devpulse/core";

/** Conexão exibida nas telas de tarefas (sem segredos). */
export interface WorkConnection {
  id: string;
  provider: Provider;
  login: string;
  baseUrl: string | null;
  authMethod: "OAUTH" | "PAT";
  /** escopos OAuth que faltam para editar/boards ([] = ok ou PAT). */
  missingScopes: string[];
}

export class WorkApiError extends Error {
  constructor(
    message: string,
    readonly kind: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** fetch JSON das rotas /api/work; erros viram WorkApiError com `kind`. */
export async function workFetch<T>(
  url: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new WorkApiError(json.error ?? `Erro ${res.status}`, json.kind ?? "provider", res.status);
  }
  return json as T;
}

/** Mensagem amigável por categoria de erro. */
export function friendlyError(err: unknown): string {
  if (err instanceof WorkApiError) {
    if (err.kind === "scope") {
      return "Sem permissão no provedor. Reconecte a conta (OAuth) ou gere um PAT com escopo de escrita.";
    }
    if (err.kind === "auth") return "Token inválido ou expirado. Reconecte a conta em Conexões.";
    return err.message;
  }
  return err instanceof Error ? err.message : "Erro inesperado";
}

export function itemUrl(connectionId: string, ref: string, suffix = ""): string {
  return `/api/work/${connectionId}/item${suffix}?ref=${encodeURIComponent(ref)}`;
}
