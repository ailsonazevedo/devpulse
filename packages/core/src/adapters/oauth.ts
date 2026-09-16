import type { Provider } from "@prisma/client";
import { AuthError } from "./types.js";

/** Resultado normalizado de um refresh de token OAuth. */
export interface RefreshResult {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
}

/**
 * Credenciais do app OAuth (client_id/secret) lidas do ambiente do worker.
 * Ausente = provedor sem OAuth configurado (refresh indisponível).
 */
export function oauthClient(
  provider: Provider,
): { clientId: string; clientSecret: string } | null {
  const clientId = process.env[`${provider}_CLIENT_ID`];
  const clientSecret = process.env[`${provider}_CLIENT_SECRET`];
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/**
 * Troca um refresh_token por um novo access_token (grant_type=refresh_token).
 * Erros de credencial viram AuthError (o ingest trata como REVOKED).
 */
export async function refreshOAuthToken(params: {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<RefreshResult> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });

  const res = await fetch(params.tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || json.error || !json.access_token) {
    throw new AuthError(
      `Refresh OAuth falhou (HTTP ${res.status}): ${
        json.error_description ?? json.error ?? "sem access_token"
      }`,
    );
  }

  return {
    accessToken: json.access_token,
    // Muitos provedores rotacionam o refresh token; quando ausente, o chamador
    // mantém o anterior.
    refreshToken: json.refresh_token ?? null,
    expiresAt: json.expires_in
      ? new Date(Date.now() + json.expires_in * 1000)
      : null,
  };
}
