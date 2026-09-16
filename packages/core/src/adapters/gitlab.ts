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
  push_data?: { commit_count?: number; ref?: string } | null;
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

export const gitlabAdapter: ProviderAdapter = {
  provider: "GITLAB",

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
            raw: ev,
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
