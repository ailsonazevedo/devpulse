import type { AuthMethod, Provider } from "@prisma/client";

/**
 * Escopos OAuth necessários para gerenciar tarefas (escrita + boards). Devem
 * estar contidos em `apps/web/src/lib/oauth.ts` (OAUTH[p].scope).
 */
export const WORK_SCOPES: Record<Provider, string[]> = {
  // read:org: listar os Projects (boards) das organizações do usuário.
  GITHUB: ["repo", "project", "read:org"],
  GITLAB: ["api"],
  AZURE: ["vso.work_write"],
};

/**
 * Escopos que faltam numa conexão OAuth para gerenciar tarefas. PAT não informa
 * escopos: devolve [] e a falta de permissão aparece como ScopeError (403).
 */
export function missingWorkScopes(
  provider: Provider,
  authMethod: AuthMethod,
  scopes: string[],
): string[] {
  if (authMethod !== "OAUTH") return [];
  return WORK_SCOPES[provider].filter((s) => !scopes.includes(s));
}
