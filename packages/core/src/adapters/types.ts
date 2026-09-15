import type { ActivityType, Provider } from "@prisma/client";

/** Credenciais resolvidas (já descriptografadas) passadas ao adapter. */
export interface Credentials {
  accessToken: string;
  refreshToken?: string | null;
  /** base URL da instância (self-hosted). Undefined = SaaS oficial. */
  baseUrl?: string | null;
}

/** Identidade do usuário no provedor, obtida ao conectar. */
export interface Identity {
  externalUserId: string;
  externalLogin: string;
  avatarUrl?: string | null;
  name?: string | null;
  email?: string | null;
}

/** Cursor opaco de sincronização, persistido em ProviderConnection.syncCursor. */
export type SyncCursor = Record<string, unknown>;

/** Payload cru vindo da API do provedor (antes de normalizar). */
export interface RawActivity {
  externalId: string;
  raw: unknown;
}

/** Atividade já normalizada para o modelo comum. */
export interface NormalizedActivity {
  type: ActivityType;
  externalId: string;
  /** chave estável de deduplicação por conexão. */
  dedupeKey: string;
  title: string;
  url: string;
  repoName?: string | null;
  repoUrl?: string | null;
  occurredAt: Date;
  raw: unknown;
}

/** Uma página de atividades + o próximo cursor (undefined = fim). */
export interface ActivityPage {
  items: NormalizedActivity[];
  nextCursor?: SyncCursor;
}

/** Contagem de contribuições de um dia (fonte autoritativa do heatmap). */
export interface DailyCount {
  /** dia no formato YYYY-MM-DD (UTC). */
  date: string;
  count: number;
}

export interface ProviderAdapter {
  readonly provider: Provider;

  /** Valida credenciais e retorna a identidade (usado no "connect"). */
  getIdentity(creds: Credentials): Promise<Identity>;

  /**
   * Itera atividades a partir de um cursor. Cada `yield` é uma página já
   * normalizada; o consumidor persiste e guarda o `nextCursor`.
   * Respeita rate-limit internamente (backoff quando necessário).
   */
  fetchActivities(
    creds: Credentials,
    cursor: SyncCursor | undefined,
  ): AsyncGenerator<ActivityPage, void, unknown>;

  /** Renova o access token (só OAuth). Ausente = não suporta refresh. */
  refreshToken?(creds: Credentials): Promise<{
    accessToken: string;
    refreshToken?: string | null;
    expiresAt?: Date | null;
  }>;

  /**
   * Calendário de contribuições diárias (fonte autoritativa do heatmap).
   * Quando presente, o heatmap desse provedor usa estes números — cobre o ano
   * inteiro e inclui contribuições que os *events* não trazem (ex.: privadas).
   * Ausente = o heatmap é derivado das atividades ingeridas.
   */
  fetchContributionCalendar?(
    creds: Credentials,
    range?: { from?: Date; to?: Date },
  ): Promise<DailyCount[]>;
}

/** Erro de autenticação (token inválido/revogado) — marca conexão como ERROR/REVOKED. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}
