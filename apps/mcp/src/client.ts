/**
 * Cliente HTTP mínimo da API do DevPulse, autenticado com token pessoal
 * (`Authorization: Bearer dp_…`, gerado em /connections).
 */

export class DevPulseError extends Error {
  constructor(
    message: string,
    readonly kind: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Dica acionável por categoria de erro (mesmas categorias da UI). */
export function errorHint(err: DevPulseError): string {
  switch (err.kind) {
    case "unauthenticated":
      return "Token do DevPulse inválido ou revogado. Gere outro em /connections e atualize DEVPULSE_TOKEN.";
    case "scope":
      return "Sem permissão no provedor. Reconecte a conta (OAuth) em /connections ou use um PAT com escopo de escrita.";
    case "auth":
      return "Credencial do provedor inválida ou expirada. Reconecte a conta em /connections.";
    default:
      return err.message;
  }
}

export interface ClientConfig {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
}

export class DevPulseClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: ClientConfig) {
    this.baseUrl = cfg.baseUrl.replace(/\/$/, "");
    this.token = cfg.token;
    this.fetchImpl = cfg.fetch ?? fetch;
  }

  async request<T>(
    path: string,
    init: {
      method?: string;
      query?: Record<string, string | number | undefined | null>;
      body?: unknown;
    } = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(init.query ?? {})) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
    };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: init.method ?? "GET",
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
    } catch (err) {
      throw new DevPulseError(
        `Não foi possível conectar ao DevPulse em ${this.baseUrl} (${err instanceof Error ? err.message : err}). O app web está rodando?`,
        "network",
        0,
      );
    }
    const json = (await res.json().catch(() => ({}))) as { error?: string; kind?: string };
    if (!res.ok) {
      const kind = res.status === 401 && !json.kind ? "unauthenticated" : (json.kind ?? "provider");
      throw new DevPulseError(json.error ?? `Erro ${res.status}`, kind, res.status);
    }
    return json as T;
  }
}

export function clientFromEnv(env: NodeJS.ProcessEnv = process.env): DevPulseClient {
  const token = env.DEVPULSE_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "DEVPULSE_TOKEN não definido. Gere um token em <DevPulse>/connections (seção Claude Code).",
    );
  }
  return new DevPulseClient({
    baseUrl: env.DEVPULSE_URL?.trim() || "http://localhost:3000",
    token,
  });
}
