import { Octokit } from "octokit";
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

interface GithubCursor {
  /** maior event.id já ingerido (string numérica). */
  lastEventId?: string;
}

function makeClient(creds: Credentials): Octokit {
  return new Octokit({
    auth: creds.accessToken,
    ...(creds.baseUrl ? { baseUrl: creds.baseUrl.replace(/\/$/, "") } : {}),
  });
}

/** Host web (não a API): SaaS = github.com; GHE = origin do baseUrl (…/api/v3). */
function webBase(creds: Credentials): string {
  if (!creds.baseUrl) return "https://github.com";
  try {
    return new URL(creds.baseUrl).origin;
  } catch {
    return "https://github.com";
  }
}

export function reviewStateOf(state: unknown): ReviewState | null {
  switch (String(state ?? "").toLowerCase()) {
    case "approved":
      return "approved";
    case "changes_requested":
      return "changes_requested";
    case "commented":
    case "dismissed":
      return "commented";
    default:
      return null;
  }
}

/** Deep-link para a entidade real do evento (PR/issue/review/release/comment). */
function eventUrl(
  type: string | null,
  payload: Record<string, unknown>,
  repoWeb: string,
): string {
  const html = (o: unknown): string | null =>
    o && typeof o === "object" && typeof (o as { html_url?: unknown }).html_url === "string"
      ? (o as { html_url: string }).html_url
      : null;
  switch (type) {
    case "PullRequestEvent":
      return html(payload.pull_request) ?? repoWeb;
    case "IssuesEvent":
      return html(payload.issue) ?? repoWeb;
    case "PullRequestReviewEvent":
      return html(payload.review) ?? html(payload.pull_request) ?? repoWeb;
    case "PullRequestReviewCommentEvent":
    case "IssueCommentEvent":
    case "CommitCommentEvent":
      return html(payload.comment) ?? repoWeb;
    case "ReleaseEvent":
      return html(payload.release) ?? repoWeb;
    default:
      return repoWeb;
  }
}

function mapType(eventType: string | null): ActivityType {
  switch (eventType) {
    case "PushEvent":
      return "PUSH";
    case "PullRequestEvent":
      return "PR";
    case "IssuesEvent":
      return "ISSUE";
    case "PullRequestReviewEvent":
      return "REVIEW";
    case "IssueCommentEvent":
    case "PullRequestReviewCommentEvent":
    case "CommitCommentEvent":
      return "COMMENT";
    case "ReleaseEvent":
      return "RELEASE";
    default:
      return "OTHER";
  }
}

function describe(event: {
  type: string | null;
  repo: { name: string };
  payload: Record<string, unknown>;
}): string {
  const repo = event.repo.name;
  switch (event.type) {
    case "PushEvent": {
      const commits = Array.isArray(event.payload.commits)
        ? event.payload.commits.length
        : 0;
      return `Push de ${commits} commit(s) em ${repo}`;
    }
    case "PullRequestEvent":
      return `Pull request (${String(event.payload.action ?? "")}) em ${repo}`;
    case "IssuesEvent":
      return `Issue (${String(event.payload.action ?? "")}) em ${repo}`;
    case "PullRequestReviewEvent": {
      const state = reviewStateOf(
        (event.payload.review as { state?: unknown } | undefined)?.state,
      );
      const verb =
        state === "approved"
          ? "Aprovou"
          : state === "changes_requested"
            ? "Pediu alterações em"
            : "Revisou";
      return `${verb} PR em ${repo}`;
    }
    case "ReleaseEvent":
      return `Release em ${repo}`;
    default:
      return `${event.type ?? "Atividade"} em ${repo}`;
  }
}

export const githubAdapter: ProviderAdapter = {
  provider: "GITHUB",

  async getIdentity(creds: Credentials): Promise<Identity> {
    const octokit = makeClient(creds);
    try {
      const { data } = await octokit.rest.users.getAuthenticated();
      return {
        externalUserId: String(data.id),
        externalLogin: data.login,
        avatarUrl: data.avatar_url,
        name: data.name,
        email: data.email,
      };
    } catch (err) {
      throw asAuthError(err);
    }
  },

  async *fetchActivities(
    creds: Credentials,
    cursor: SyncCursor | undefined,
  ): AsyncGenerator<ActivityPage, void, unknown> {
    const octokit = makeClient(creds);
    const state = (cursor ?? {}) as GithubCursor;
    const lastId = state.lastEventId ? BigInt(state.lastEventId) : null;
    let maxSeen = lastId;

    const web = webBase(creds);
    try {
      // precisamos do login p/ o endpoint de eventos
      const { data: me } = await octokit.rest.users.getAuthenticated();
      const iterator = octokit.paginate.iterator(
        octokit.rest.activity.listEventsForAuthenticatedUser,
        { username: me.login, per_page: 100 },
      );

      for await (const { data: events } of iterator) {
        const items: NormalizedActivity[] = [];
        let reachedKnown = false;

        for (const event of events) {
          const id = BigInt(event.id);
          if (lastId !== null && id <= lastId) {
            reachedKnown = true;
            break;
          }
          if (maxSeen === null || id > maxSeen) maxSeen = id;

          const repoName = event.repo.name;
          const repoWeb = `${web}/${repoName}`;
          const type = mapType(event.type);
          const payload = event.payload as Record<string, unknown>;
          const reviewState =
            type === "REVIEW"
              ? reviewStateOf(
                  (payload.review as { state?: unknown } | undefined)?.state,
                )
              : null;
          const commitCount =
            type === "PUSH"
              ? Number(
                  (payload.size as number | undefined) ??
                    (Array.isArray(payload.commits) ? payload.commits.length : 0),
                )
              : null;
          items.push({
            type,
            externalId: event.id,
            dedupeKey: `gh:${event.id}`,
            title: describe({
              type: event.type,
              repo: event.repo,
              payload,
            }),
            url: eventUrl(event.type, payload, repoWeb),
            repoName,
            repoUrl: repoWeb,
            occurredAt: new Date(event.created_at ?? Date.now()),
            reviewState,
            commitCount,
            raw: event,
          });
        }

        if (items.length > 0) {
          yield {
            items,
            nextCursor: maxSeen !== null ? { lastEventId: maxSeen.toString() } : undefined,
          };
        }
        if (reachedKnown) break;
      }
    } catch (err) {
      throw asAuthError(err);
    }
  },

  async fetchContributionCalendar(
    creds: Credentials,
    range?: { from?: Date; to?: Date },
  ): Promise<DailyCount[]> {
    const octokit = makeClient(creds);
    const query = `
      query($from: DateTime, $to: DateTime) {
        viewer {
          contributionsCollection(from: $from, to: $to) {
            contributionCalendar {
              weeks {
                contributionDays { date contributionCount }
              }
            }
          }
        }
      }`;
    try {
      const data = await octokit.graphql<{
        viewer: {
          contributionsCollection: {
            contributionCalendar: {
              weeks: { contributionDays: { date: string; contributionCount: number }[] }[];
            };
          };
        };
      }>(query, {
        from: range?.from?.toISOString() ?? null,
        to: range?.to?.toISOString() ?? null,
      });

      const days: DailyCount[] = [];
      for (const week of data.viewer.contributionsCollection.contributionCalendar.weeks) {
        for (const d of week.contributionDays) {
          days.push({ date: d.date, count: d.contributionCount });
        }
      }
      return days;
    } catch (err) {
      throw asAuthError(err);
    }
  },
};

function asAuthError(err: unknown): unknown {
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? (err as { status?: number }).status
      : undefined;
  if (status === 401 || status === 403) {
    return new AuthError("GitHub: token inválido ou sem permissão");
  }
  return err;
}
