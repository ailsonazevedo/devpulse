import type { ProviderConnection } from "@prisma/client";
import {
  getAdapter,
  AuthError,
  type Credentials,
  type ProviderAdapter,
} from "./adapters/index.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { prisma } from "./db.js";

/** Margem para refresh proativo: renova se faltar ≤ 60s para expirar. */
const EXPIRY_SKEW_MS = 60_000;

/** Monta as credenciais (descriptografadas) a partir da conexão. */
export function buildCreds(connection: ProviderConnection): Credentials {
  return {
    accessToken: decryptSecret(connection.accessTokenEnc),
    refreshToken: connection.refreshTokenEnc
      ? decryptSecret(connection.refreshTokenEnc)
      : null,
    baseUrl: connection.baseUrl,
    tokenType: connection.authMethod === "OAUTH" ? "oauth" : "pat",
  };
}

/** Conexão OAuth, com refresh token e adapter que suporta refresh. */
export function canRefresh(
  connection: ProviderConnection,
  adapter: ProviderAdapter,
): boolean {
  return (
    connection.authMethod === "OAUTH" &&
    Boolean(adapter.refreshToken) &&
    Boolean(connection.refreshTokenEnc)
  );
}

export function isExpiring(expiresAt: Date | null): boolean {
  return (
    expiresAt !== null && expiresAt.getTime() <= Date.now() + EXPIRY_SKEW_MS
  );
}

/**
 * Renova o access token via refresh_token e persiste os novos segredos cifrados
 * (mantendo o refresh token anterior quando o provedor não o rotaciona).
 * Lança AuthError se o refresh falhar (refresh token revogado/expirado).
 */
export async function refreshConnection(
  connection: ProviderConnection,
  adapter: ProviderAdapter,
): Promise<Credentials> {
  const current = buildCreds(connection);
  const refreshed = await adapter.refreshToken!(current);
  await prisma.providerConnection.update({
    where: { id: connection.id },
    data: {
      accessTokenEnc: encryptSecret(refreshed.accessToken),
      refreshTokenEnc: refreshed.refreshToken
        ? encryptSecret(refreshed.refreshToken)
        : connection.refreshTokenEnc,
      tokenExpiresAt: refreshed.expiresAt ?? null,
    },
  });
  return {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? current.refreshToken,
    baseUrl: connection.baseUrl,
    tokenType: "oauth",
  };
}

/** Conexão não existe ou não pertence ao usuário. */
export class ConnectionNotFoundError extends Error {
  constructor() {
    super("Conexão não encontrada");
    this.name = "ConnectionNotFoundError";
  }
}

/**
 * Executa `fn` com credenciais válidas de uma conexão do próprio usuário
 * (chamadas ao vivo na API do provedor, fora do sync). Renova o token OAuth
 * proativamente e, se `fn` lançar AuthError, renova e repete 1x. Se o refresh
 * também falhar (ou não for possível), marca a conexão como REVOKED.
 */
export async function withConnection<T>(
  connectionId: string,
  userId: string,
  fn: (creds: Credentials, connection: ProviderConnection) => Promise<T>,
): Promise<T> {
  const connection = await prisma.providerConnection.findFirst({
    where: { id: connectionId, userId },
  });
  if (!connection) throw new ConnectionNotFoundError();

  const adapter = getAdapter(connection.provider);
  const refreshable = canRefresh(connection, adapter);

  let creds = buildCreds(connection);
  let didRefresh = false;
  try {
    if (refreshable && isExpiring(connection.tokenExpiresAt)) {
      creds = await refreshConnection(connection, adapter);
      didRefresh = true;
    }
    try {
      return await fn(creds, connection);
    } catch (err) {
      if (!(err instanceof AuthError) || didRefresh || !refreshable) throw err;
      creds = await refreshConnection(connection, adapter);
      return await fn(creds, connection);
    }
  } catch (err) {
    if (err instanceof AuthError) {
      await prisma.providerConnection.update({
        where: { id: connection.id },
        data: { status: "REVOKED", statusDetail: err.message },
      });
    }
    throw err;
  }
}
