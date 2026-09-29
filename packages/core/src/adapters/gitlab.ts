import { Gitlab } from "@gitbeaker/rest";
import type { ActivityType } from "@prisma/client";
import {
  AuthError,
  type ActivityPage,
  type Credentials,
  type DailyCount,
  type Identity,
  type NormalizedActivity,
  type ProviderAdapter,
  type ReviewState,
  type SyncCursor,
} from "./types.js";
import { oauthClient, refreshOAuthToken } from "./oauth.js";
import type { AiEvidence } from "../ai-detect.js";

interface GitlabCursor {
  lastEventId?: number;
}

export interface GitlabEvent {
  id: number;
  action_name: string;
  target_type: string | null;
  target_iid?: number | null;
  target_title: string | null;
  created_at: string;
  project_id: number | null;
  push_data?: {
    commit_count?: number;
    ref?: string;
    commit_title?: string | null;
    commit_from?: string | null;
    commit_to?: string | null;
  } | null;
}

/** Dados do projeto usados para nome/URL no feed (resolvidos e cacheados). */
interface GitlabProject {
  name: string;
  webUrl: string | null;
}

const DEFAULT_HOST = "https://gitlab.com";

function hostOf(creds: Credentials): string {
  return (creds.baseUrl || DEFAULT_HOST).replace(/\/$/, "");
}

function makeClient(creds: Credentials) {
  const host = hostOf(creds);
  // OAuth precisa ir como Authorization: Bearer (oauthToken); PAT como
  // PRIVATE-TOKEN (token). Enviar OAuth como PRIVATE-TOKEN resulta em 401.
  return creds.tokenType === "oauth"
    ? new Gitlab({ host, oauthToken: creds.accessToken })
    : new Gitlab({ host, token: creds.accessToken });
}

/** Aprovação/review de MR chega como evento de ação approve sobre MergeRequest. */
export function isReviewEvent(ev: GitlabEvent): boolean {
  return ev.target_type === "MergeRequest" && /approv/i.test(ev.action_name ?? "");
}

export function reviewStateOf(ev: GitlabEvent): ReviewState | null {
  if (!isReviewEvent(ev)) return null;
  // "approved" = aprovou; "unapproved" = removeu aprovação (volta a pendente).
  return /unapprov/i.test(ev.action_name) ? "pending" : "approved";
}

export function mapType(ev: GitlabEvent): ActivityType {
  if (ev.action_name?.includes("pushed")) return "PUSH";
  if (isReviewEvent(ev)) return "REVIEW";
  switch (ev.target_type) {
    case "MergeRequest":
      // Unificado com PR (GitHub/Azure); o rótulo "Merge request" é derivado do
      // provedor na camada de exibição (prLabel).
      return "PR";
    case "Issue":
      return "ISSUE";
    case "Note":
    case "DiffNote":
    case "DiscussionNote":
      return "COMMENT";
    default:
      return "OTHER";
  }
}

function describe(ev: GitlabEvent, host: string): string {
  if (ev.push_data?.commit_count) {
    return `Push de ${ev.push_data.commit_count} commit(s) (${ev.push_data.ref ?? ""})`;
  }
  if (isReviewEvent(ev)) {
    const verb = /unapprov/i.test(ev.action_name) ? "Removeu aprovação de" : "Aprovou";
    const target = ev.target_title ? `: ${ev.target_title}` : "";
    return `${verb} MR${target}`;
  }
  const target = ev.target_title ? `: ${ev.target_title}` : "";
  return `${ev.action_name} ${ev.target_type ?? ""}${target}`.trim() || `Atividade em ${host}`;
}

/**
 * O evento de push só traz o título do commit (sem trailers). Busca as
 * mensagens completas (compare from...to, ou o commit único quando o push cria
 * a branch) e guarda em `raw._devpulse`. Best-effort: falhas não quebram o sync.
 */
async function enrichPushForAi(
  api: ReturnType<typeof makeClient>,
  ev: GitlabEvent,
  denied: Set<number>,
): Promise<Record<string, unknown> | null> {
  const pd = ev.push_data;
  if (!ev.project_id || !pd?.commit_to || denied.has(ev.project_id)) return null;
  type C = { message?: string; author_name?: string; author_email?: string };
  const pick = (c: C) => ({
    message: c.message,
    author_name: c.author_name,
    author_email: c.author_email,
  });
  try {
    if (!pd.commit_from || /^0+$/.test(pd.commit_from)) {
      const c = (await api.Commits.show(ev.project_id, pd.commit_to)) as unknown as C;
      return { commits: [pick(c)] };
    }
    const cmp = (await api.Repositories.compare(
      ev.project_id,
      pd.commit_from,
      pd.commit_to,
    )) as unknown as { commits?: C[] };
    return { commits: (cmp.commits ?? []).slice(-AI_ENRICH_MAX_COMMITS).map(pick) };
  } catch (err) {
    // Sem acesso ao código do projeto (ex.: token sem read_repository ou papel
    // Guest): não insiste nos demais pushes dele neste sync.
    const status = (err as { cause?: { response?: { status?: number } } }).cause
      ?.response?.status;
    if (status === 401 || status === 403) denied.add(ev.project_id);
    return null; // SHA inexistente, rate-limit etc.: segue sem.
  }
}

/** Deep-link para a entidade (MR/issue) quando há iid; senão a página do projeto. */
function eventUrl(ev: GitlabEvent, project: GitlabProject | null): string | null {
  const web = project?.webUrl ?? null;
  if (!web) return null;
  if (ev.target_iid) {
    if (ev.target_type === "MergeRequest") return `${web}/-/merge_requests/${ev.target_iid}`;
    if (ev.target_type === "Issue") return `${web}/-/issues/${ev.target_iid}`;
  }
  return web;
}

/**
 * Evidências de IA de um evento do GitLab. A Events API só expõe o título do
 * commit (sem trailers), então na prática a detecção vem da branch do push.
 */
export function gitlabAiEvidence(raw: unknown): AiEvidence {
  const ev = (raw ?? {}) as Partial<GitlabEvent> & {
    _devpulse?: { commits?: { message?: string; author_name?: string; author_email?: string }[] };
  };
  const commits = ev._devpulse?.commits ?? [];
  return {
    texts: [ev.push_data?.commit_title, ev.target_title, ...commits.map((c) => c.message)],
    authors: commits.flatMap((c) => [c.author_name, c.author_email]),
    branches: [ev.push_data?.ref],
  };
}

/** Teto de chamadas extras por sync e de commits guardados por push. */
const AI_ENRICH_MAX_CALLS = 200;
const AI_ENRICH_MAX_COMMITS = 50;

export const gitlabAdapter: ProviderAdapter = {
  provider: "GITLAB",
  aiEvidence: gitlabAiEvidence,

  async getIdentity(creds: Credentials): Promise<Identity> {
    const api = makeClient(creds);
    try {
      const user = (await api.Users.showCurrentUser()) as unknown as {
        id: number;
        username: string;
        name?: string;
        email?: string;
        avatar_url?: string;
      };
      return {
        externalUserId: String(user.id),
        externalLogin: user.username,
        avatarUrl: user.avatar_url ?? null,
        name: user.name ?? null,
        email: user.email ?? null,
      };
    } catch (err) {
      throw asAuthError(err);
    }
  },

  async *fetchActivities(
    creds: Credentials,
    cursor: SyncCursor | undefined,
  ): AsyncGenerator<ActivityPage, void, unknown> {
    const api = makeClient(creds);
    const host = hostOf(creds);
    const state = (cursor ?? {}) as GitlabCursor;
    const lastId = state.lastEventId ?? null;
    let maxSeen = lastId ?? 0;
    let page = 1;
    let enrichCalls = 0;
    const enrichDenied = new Set<number>();

    // Cache de projetos por sync: evita N chamadas repetidas ao mesmo project_id.
    const projectCache = new Map<number, GitlabProject | null>();
    const resolveProject = async (id: number | null): Promise<GitlabProject | null> => {
      if (id === null) return null;
      if (projectCache.has(id)) return projectCache.get(id) ?? null;
      let proj: GitlabProject | null = null;
      try {
        const p = (await api.Projects.show(id)) as unknown as {
          path_with_namespace?: string;
          name_with_namespace?: string;
          web_url?: string;
        };
        proj = {
          name: p.path_with_namespace || p.name_with_namespace || `project#${id}`,
          webUrl: p.web_url ?? null,
        };
      } catch {
        proj = null; // sem acesso/erro: cai no fallback
      }
      projectCache.set(id, proj);
      return proj;
    };

    try {
      for (;;) {
        const res = (await api.Events.all({
          perPage: 100,
          page,
          showExpanded: true,
        })) as unknown as {
          data: GitlabEvent[];
          paginationInfo: { next?: number | null };
        };

        const events = res.data ?? [];
        if (events.length === 0) break;

        const items: NormalizedActivity[] = [];
        let reachedKnown = false;

        for (const ev of events) {
          if (lastId !== null && ev.id <= lastId) {
            reachedKnown = true;
            break;
          }
          if (ev.id > maxSeen) maxSeen = ev.id;

          const project = await resolveProject(ev.project_id);
          const type = mapType(ev);
          let raw: unknown = ev;
          if (
            type === "PUSH" &&
            enrichCalls < AI_ENRICH_MAX_CALLS &&
            !(ev.project_id && enrichDenied.has(ev.project_id))
          ) {
            enrichCalls += 1;
            const extra = await enrichPushForAi(api, ev, enrichDenied);
            if (extra) raw = { ...ev, _devpulse: extra };
          }
          items.push({
            type,
            externalId: String(ev.id),
            dedupeKey: `gl:${host}:${ev.id}`,
            title: describe(ev, host),
            url: eventUrl(ev, project) ?? host,
            repoName:
              project?.name ?? (ev.project_id ? `project#${ev.project_id}` : null),
            repoUrl: project?.webUrl ?? null,
            occurredAt: new Date(ev.created_at),
            reviewState: reviewStateOf(ev),
            commitCount:
              type === "PUSH" ? (ev.push_data?.commit_count ?? null) : null,
            raw,
          });
        }

        if (items.length > 0) {
          yield { items, nextCursor: { lastEventId: maxSeen } };
        }
        if (reachedKnown) break;

        const next = res.paginationInfo?.next;
        if (!next) break;
        page = next;
      }
    } catch (err) {
      throw asAuthError(err);
    }
  },

  async refreshToken(creds: Credentials) {
    const client = oauthClient("GITLAB");
    if (!client || !creds.refreshToken) {
      throw new AuthError(
        "GitLab: refresh indisponível (sem client OAuth ou refresh token)",
      );
    }
    return refreshOAuthToken({
      tokenUrl: `${hostOf(creds)}/oauth/token`,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      refreshToken: creds.refreshToken,
    });
  },

  async fetchContributionCalendar(creds: Credentials): Promise<DailyCount[]> {
    const host = hostOf(creds);
    const api = makeClient(creds);
    let username: string;
    try {
      const user = (await api.Users.showCurrentUser()) as unknown as {
        username: string;
      };
      username = user.username;
    } catch (err) {
      throw asAuthError(err);
    }

    // Endpoint web do calendário de atividades: { "YYYY-MM-DD": count } (~1 ano).
    // Bearer autentica tanto PAT quanto OAuth; contribuições públicas sempre
    // retornam, privadas conforme a configuração de perfil do usuário.
    const url = `${host}/users/${encodeURIComponent(username)}/calendar.json`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new AuthError("GitLab: token inválido ou sem permissão");
      }
      throw new Error(`GitLab calendar.json: HTTP ${res.status}`);
    }
    const map = (await res.json()) as Record<string, number>;
    return Object.entries(map).map(([date, count]) => ({
      date,
      count: Number(count),
    }));
  },
};

function asAuthError(err: unknown): unknown {
  const status =
    typeof err === "object" && err !== null && "cause" in err
      ? (err as { cause?: { response?: { status?: number } } }).cause?.response
          ?.status
      : undefined;
  if (status === 401 || status === 403) {
    return new AuthError("GitLab: token inválido ou sem permissão");
  }
  return err;
}
