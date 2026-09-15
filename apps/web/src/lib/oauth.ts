import type { Provider } from "@devpulse/core";
import { env } from "@/env";

export interface OAuthProviderConfig {
  provider: Provider;
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  /** base URL da API oficial (usada para creds OAuth = SaaS). */
  apiBaseUrl?: string;
}

export const OAUTH: Record<Provider, OAuthProviderConfig> = {
  GITHUB: {
    provider: "GITHUB",
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scope: "read:user repo",
  },
  GITLAB: {
    provider: "GITLAB",
    clientId: env.GITLAB_CLIENT_ID,
    clientSecret: env.GITLAB_CLIENT_SECRET,
    authorizeUrl: "https://gitlab.com/oauth/authorize",
    tokenUrl: "https://gitlab.com/oauth/token",
    scope: "read_user read_api",
  },
};

export function isOAuthConfigured(provider: Provider): boolean {
  const c = OAUTH[provider];
  return Boolean(c.clientId && c.clientSecret);
}

export function redirectUri(provider: Provider): string {
  return `${env.AUTH_URL.replace(/\/$/, "")}/api/oauth/${provider.toLowerCase()}/callback`;
}

export function buildAuthorizeUrl(provider: Provider, state: string): string {
  const c = OAUTH[provider];
  const params = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: redirectUri(provider),
    scope: c.scope,
    state,
    response_type: "code",
  });
  return `${c.authorizeUrl}?${params.toString()}`;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scopes: string[];
}

/** Troca o authorization code por tokens. */
export async function exchangeCode(
  provider: Provider,
  code: string,
): Promise<TokenResponse> {
  const c = OAUTH[provider];
  const body = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(provider),
  });

  const res = await fetch(c.tokenUrl, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Falha ao trocar code (${provider}): ${res.status}`);
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (json.error || !json.access_token) {
    throw new Error(
      `OAuth ${provider}: ${json.error_description ?? json.error ?? "sem access_token"}`,
    );
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null,
    scopes: (json.scope ?? c.scope).split(/[ ,]+/).filter(Boolean),
  };
}
