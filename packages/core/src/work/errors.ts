import { AuthError } from "../adapters/types.js";

/** Token válido, mas sem permissão para a operação (escopo insuficiente). */
export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeError";
  }
}

/** Item/board inexistente ou invisível para o usuário. */
export class WorkNotFoundError extends Error {
  constructor(message = "Não encontrado no provedor") {
    super(message);
    this.name = "WorkNotFoundError";
  }
}

/** Entrada rejeitada pelo provedor (ex.: estado inválido, label inexistente). */
export class WorkInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkInputError";
  }
}

/**
 * Converte o status HTTP de uma chamada falha no erro de domínio:
 * 401 → AuthError (token inválido; dispara refresh/REVOKED), 403 → ScopeError
 * (não revoga: só falta permissão), 404 → WorkNotFoundError,
 * 400/409/422 → WorkInputError. Rate-limit (403/429 com essa mensagem) e
 * demais statuses viram Error genérico.
 */
export function workErrorFromStatus(
  provider: string,
  status: number | undefined,
  detail?: string,
): Error {
  const msg = detail ? `${provider}: ${detail}` : `${provider}: HTTP ${status}`;
  if (status === 401) return new AuthError(`${provider}: token inválido ou expirado`);
  if (status === 429 || (status === 403 && /rate limit/i.test(detail ?? ""))) {
    return new Error(`${provider}: limite de requisições atingido, tente mais tarde`);
  }
  if (status === 403) {
    return new ScopeError(
      `${provider}: sem permissão para esta operação${detail ? ` (${detail})` : ""}`,
    );
  }
  if (status === 404) return new WorkNotFoundError(msg);
  if (status === 400 || status === 409 || status === 422) {
    return new WorkInputError(msg);
  }
  return new Error(msg);
}
