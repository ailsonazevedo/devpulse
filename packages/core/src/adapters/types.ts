import type { ActivityType, Provider } from "@prisma/client";
import type { AiEvidence } from "../ai-detect.js";

/** Credenciais resolvidas (já descriptografadas) passadas ao adapter. */
export interface Credentials {
  accessToken: string;
  refreshToken?: string | null;
  /** base URL da instância (self-hosted). Undefined = SaaS oficial. */
  baseUrl?: string | null;
  /**
   * Como o token deve ser enviado. Relevante para o GitLab (gitbeaker), onde
   * PAT vai como header PRIVATE-TOKEN e OAuth como Authorization: Bearer.
   * Default: "pat".
   */
  tokenType?: "oauth" | "pat";
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

/**
 * Estado normalizado de um review, comparável entre provedores.
 * GitHub: review.state; GitLab: ação approve/reviewed; Azure: vote (10/5/-5/-10).
 */
export type ReviewState =
  | "approved"
  | "changes_requested"
  | "commented"
  | "rejected"
  | "pending";

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
  /** Estado do review (só quando type === "REVIEW"). Carrega a semântica que o
   *  provedor expõe de formas diferentes, hoje perdida no `raw`. */
  reviewState?: ReviewState | null;
  /** Nº de commits de um push (quando o provedor informa). Só em type PUSH. */
  commitCount?: number | null;
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

  /**
   * O calendário (`fetchContributionCalendar`) honra o `range` e pode ser
   * consultado ano a ano, permitindo backfill histórico multi-ano (ex.: GitHub,
   * cuja API limita cada consulta a 1 ano). Ausente/false = calendário cobre
   * apenas ~1 ano fixo e ignora o range.
   */
  readonly supportsHistoricalCalendar?: boolean;

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

  /**
   * Extrai do payload cru (`NormalizedActivity.raw`) as evidências de uso de IA
   * (mensagens, autores, branches) para o AI Pulse. Opera só sobre o `raw`
   * persistido, permitindo re-detectar o histórico sem chamar a API.
   */
  aiEvidence?(raw: unknown): AiEvidence;

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
