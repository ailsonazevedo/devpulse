import {
  type AuthMethod,
  type Provider,
  encryptSecret,
  enqueueSync,
  getAdapter,
  prisma,
} from "@devpulse/core";
import { clearConnectionCache } from "@devpulse/core/work";

export interface UpsertConnectionInput {
  userId: string;
  provider: Provider;
  authMethod: AuthMethod;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  scopes?: string[];
  /** self-hosted (PAT). null/undefined = SaaS oficial. */
  baseUrl?: string | null;
}

/**
 * Valida credenciais no provedor (getIdentity), cifra tokens, faz upsert da
 * ProviderConnection e enfileira o backfill. Nunca persiste tokens em claro.
 */
export async function upsertConnection(input: UpsertConnectionInput) {
  const baseUrl = input.baseUrl ?? ""; // "" = SaaS oficial
  const adapter = getAdapter(input.provider);
  const identity = await adapter.getIdentity({
    accessToken: input.accessToken,
    refreshToken: input.refreshToken ?? null,
    baseUrl,
    tokenType: input.authMethod === "OAUTH" ? "oauth" : "pat",
  });

  const connection = await prisma.providerConnection.upsert({
    where: {
      userId_provider_externalUserId_baseUrl: {
        userId: input.userId,
        provider: input.provider,
        externalUserId: identity.externalUserId,
        baseUrl,
      },
    },
    create: {
      userId: input.userId,
      provider: input.provider,
      authMethod: input.authMethod,
      baseUrl,
      externalUserId: identity.externalUserId,
      externalLogin: identity.externalLogin,
      avatarUrl: identity.avatarUrl ?? null,
      accessTokenEnc: encryptSecret(input.accessToken),
      refreshTokenEnc: input.refreshToken ? encryptSecret(input.refreshToken) : null,
      tokenExpiresAt: input.tokenExpiresAt ?? null,
      scopes: input.scopes ?? [],
      status: "ACTIVE",
    },
    update: {
      authMethod: input.authMethod,
      externalLogin: identity.externalLogin,
      avatarUrl: identity.avatarUrl ?? null,
      accessTokenEnc: encryptSecret(input.accessToken),
      refreshTokenEnc: input.refreshToken ? encryptSecret(input.refreshToken) : null,
      tokenExpiresAt: input.tokenExpiresAt ?? null,
      scopes: input.scopes ?? [],
      status: "ACTIVE",
      statusDetail: null,
    },
  });

  await enqueueSync(connection.id, "backfill");
  // Reconectar pode mudar escopos/permissões: descarta metadados em cache.
  await clearConnectionCache(connection.id);
  return connection;
}
