import type { ActivityType } from "@prisma/client";
import {
  AuthError,
  type ActivityPage,
  type Credentials,
  type Identity,
  type NormalizedActivity,
  type ProviderAdapter,
  type ReviewState,
  type SyncCursor,
} from "./types.js";

const API_VERSION = "7.1";
/** connectionData nunca saiu de preview: precisa do sufixo -preview.1. */
const CONNECTION_DATA_API_VERSION = "7.1-preview.1";
/** Perfil (e-mail do usuário) só existe no SaaS (vssps). */
const VSSPS_PROFILE =
  "https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1";
/** Janela de backfill quando não há cursor: ~12 meses. */
const BACKFILL_DAYS = 365;
/** Limite defensivo de itens por tipo/sync para não estourar rate-limit. */
const MAX_PER_TYPE = 500;

interface AzureCursor {
  commitsSince?: string;
  prsSince?: string;
  reviewsSince?: string;
  workItemsSince?: string;
}

/** Voto do revisor no Azure → estado normalizado. 0 = não votou (ignorado). */
export function voteToReviewState(vote: number): ReviewState | null {
  switch (vote) {
    case 10:
    case 5:
      return "approved"; // 5 = aprovado com sugestões
    case -5:
      return "pending"; // aguardando o autor
    case -10:
      return "rejected";
    default:
      return null;
  }
}

function reviewTitle(vote: number, prTitle: string): string {
  const label =
    vote === 10
      ? "Aprovou"
      : vote === 5
        ? "Aprovou (com sugestões)"
        : vote === -5
          ? "Aguardando autor em"
          : vote === -10
            ? "Rejeitou"
            : "Revisou";
  return `${label} PR: ${prTitle}`;
}

/** baseUrl da organização (cloud) ou collection (server), sem barra final. */
function orgBase(creds: Credentials): string {
  const base = (creds.baseUrl || "").trim().replace(/\/$/, "");
  if (!base) {
    throw new AuthError(
      "Azure DevOps: informe a URL da organização (ex.: https://dev.azure.com/sua-org)",
    );
  }
  return base;
}

/** Host curto para os dedupeKeys (org no cloud, host no server). */
function orgKey(base: string): string {
  try {
    const u = new URL(base);
    // dev.azure.com/{org} -> {org}; server -> host + path
    const parts = u.pathname.split("/").filter(Boolean);
    return u.hostname === "dev.azure.com" && parts[0]
      ? parts[0]
      : `${u.hostname}${u.pathname}`.replace(/\/$/, "");
  } catch {
    return base;
  }
}

/** PAT vai como Basic base64(":" + token); OAuth (futuro) como Bearer. */
function authHeader(creds: Credentials): string {
  if (creds.tokenType === "oauth") return `Bearer ${creds.accessToken}`;
  const basic = Buffer.from(`:${creds.accessToken}`).toString("base64");
  return `Basic ${basic}`;
}

async function apiGet<T>(url: string, creds: Credentials): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: authHeader(creds), Accept: "application/json" },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new AuthError("Azure DevOps: token inválido ou sem permissão");
    }
    throw new Error(`Azure DevOps GET ${res.status}: ${url}`);
  }
  return (await res.json()) as T;
}

async function apiPost<T>(
  url: string,
  body: unknown,
  creds: Credentials,
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader(creds),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new AuthError("Azure DevOps: token inválido ou sem permissão");
    }
    throw new Error(`Azure DevOps POST ${res.status}: ${url}`);
  }
  return (await res.json()) as T;
}

interface ConnectionData {
  authenticatedUser: {
    id: string;
    providerDisplayName?: string;
    properties?: { Account?: { $value?: string } };
  };
}

interface ListResponse<T> {
  count: number;
  value: T[];
}

async function resolveEmail(
  creds: Credentials,
  fallback: string,
): Promise<string> {
  // O perfil (com e-mail) só existe no SaaS. No server, cai no displayName.
  try {
    const profile = await apiGet<{ emailAddress?: string }>(
      VSSPS_PROFILE,
      creds,
    );
    return profile.emailAddress || fallback;
  } catch {
    return fallback;
  }
}

function sinceParam(cursor: AzureCursor | undefined, key: keyof AzureCursor) {
  const iso = cursor?.[key];
  if (iso) return iso;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - BACKFILL_DAYS);
  return d.toISOString();
}

export const azureAdapter: ProviderAdapter = {
  provider: "AZURE",

  async getIdentity(creds: Credentials): Promise<Identity> {
    const base = orgBase(creds);
    const data = await apiGet<ConnectionData>(
      `${base}/_apis/connectionData?api-version=${CONNECTION_DATA_API_VERSION}`,
      creds,
    );
    const u = data.authenticatedUser;
    const login =
      u.properties?.Account?.$value || u.providerDisplayName || u.id;
    const email = await resolveEmail(creds, login);
    return {
      externalUserId: u.id,
      externalLogin: login,
      avatarUrl: null,
      name: u.providerDisplayName ?? null,
      email,
    };
  },

  async *fetchActivities(
    creds: Credentials,
    cursor: SyncCursor | undefined,
  ): AsyncGenerator<ActivityPage, void, unknown> {
    const base = orgBase(creds);
    const org = orgKey(base);
    const state = (cursor ?? {}) as AzureCursor;

    // Identidade: id (criador de PRs / WIQL @me implícito) e e-mail (autor de commits).
    const conn = await apiGet<ConnectionData>(
      `${base}/_apis/connectionData?api-version=${CONNECTION_DATA_API_VERSION}`,
      creds,
    );
    const userId = conn.authenticatedUser.id;
    const email = await resolveEmail(
      creds,
      conn.authenticatedUser.providerDisplayName ?? "",
    );

    const commitsSince = sinceParam(state, "commitsSince");
    const prsSince = sinceParam(state, "prsSince");
    const reviewsSince = sinceParam(state, "reviewsSince");
    const workItemsSince = sinceParam(state, "workItemsSince");
    let maxCommit = commitsSince;
    let maxPr = prsSince;
    let maxReview = reviewsSince;
    let maxWi = workItemsSince;

    const projects = await apiGet<ListResponse<{ id: string; name: string }>>(
      `${base}/_apis/projects?api-version=${API_VERSION}`,
      creds,
    );

    for (const project of projects.value) {
      const proj = encodeURIComponent(project.name);

      // ─── Commits + Pull Requests (por repositório) ──────────────────
      const repos = await apiGet<
        ListResponse<{ id: string; name: string; webUrl?: string }>
      >(`${base}/${proj}/_apis/git/repositories?api-version=${API_VERSION}`, creds);

      for (const repo of repos.value) {
        // Commits do usuário
        const commitsUrl =
          `${base}/${proj}/_apis/git/repositories/${repo.id}/commits` +
          `?searchCriteria.author=${encodeURIComponent(email)}` +
          `&searchCriteria.fromDate=${encodeURIComponent(commitsSince)}` +
          `&searchCriteria.$top=${MAX_PER_TYPE}&api-version=${API_VERSION}`;
        const commits = await apiGet<
          ListResponse<{
            commitId: string;
            comment?: string;
            author?: { date?: string };
            remoteUrl?: string;
          }>
        >(commitsUrl, creds);

        const commitItems: NormalizedActivity[] = commits.value.map((c) => {
          const when = c.author?.date ?? new Date().toISOString();
          if (when > maxCommit) maxCommit = when;
          return {
            type: "COMMIT" as ActivityType,
            externalId: c.commitId,
            dedupeKey: `az:${org}:commit:${c.commitId}`,
            title: c.comment?.split("\n")[0] || `Commit em ${repo.name}`,
            url: c.remoteUrl ?? repo.webUrl ?? base,
            repoName: `${project.name}/${repo.name}`,
            repoUrl: repo.webUrl ?? null,
            occurredAt: new Date(when),
            raw: c,
          };
        });
        if (commitItems.length > 0) {
          yield {
            items: commitItems,
            nextCursor: { ...state, commitsSince: maxCommit },
          };
        }

        // Pull requests criados pelo usuário
        const prUrl =
          `${base}/${proj}/_apis/git/repositories/${repo.id}/pullrequests` +
          `?searchCriteria.creatorId=${encodeURIComponent(userId)}` +
          `&searchCriteria.status=all&$top=${MAX_PER_TYPE}&api-version=${API_VERSION}`;
        const prs = await apiGet<
          ListResponse<{
            pullRequestId: number;
            title?: string;
            creationDate?: string;
            url?: string;
          }>
        >(prUrl, creds);

        const prItems: NormalizedActivity[] = [];
        for (const pr of prs.value) {
          const when = pr.creationDate ?? new Date().toISOString();
          if (when <= prsSince) continue; // já ingerido em sync anterior
          if (when > maxPr) maxPr = when;
          prItems.push({
            type: "PR",
            externalId: String(pr.pullRequestId),
            dedupeKey: `az:${org}:pr:${repo.id}:${pr.pullRequestId}`,
            title: pr.title || `PR !${pr.pullRequestId}`,
            url: `${base}/${proj}/_git/${encodeURIComponent(repo.name)}/pullrequest/${pr.pullRequestId}`,
            repoName: `${project.name}/${repo.name}`,
            repoUrl: repo.webUrl ?? null,
            occurredAt: new Date(when),
            raw: pr,
          });
        }
        if (prItems.length > 0) {
          yield { items: prItems, nextCursor: { ...state, prsSince: maxPr } };
        }

        // ─── Reviews: PRs em que o usuário é revisor e votou ──────────
        const reviewUrl =
          `${base}/${proj}/_apis/git/repositories/${repo.id}/pullrequests` +
          `?searchCriteria.reviewerId=${encodeURIComponent(userId)}` +
          `&searchCriteria.status=all&$top=${MAX_PER_TYPE}&api-version=${API_VERSION}`;
        const reviewed = await apiGet<
          ListResponse<{
            pullRequestId: number;
            title?: string;
            creationDate?: string;
            closedDate?: string;
            reviewers?: { id: string; vote?: number }[];
          }>
        >(reviewUrl, creds);

        const reviewItems: NormalizedActivity[] = [];
        for (const pr of reviewed.value) {
          const mine = pr.reviewers?.find((r) => r.id === userId);
          const vote = mine?.vote ?? 0;
          const reviewState = voteToReviewState(vote);
          if (!reviewState) continue; // não votou (0) → não é review
          // O endpoint não expõe a data do voto; usamos closedDate/creationDate
          // como aproximação estável para ordenação/cursor.
          const when = pr.closedDate ?? pr.creationDate ?? new Date().toISOString();
          if (when <= reviewsSince) continue;
          if (when > maxReview) maxReview = when;
          reviewItems.push({
            type: "REVIEW",
            externalId: `${pr.pullRequestId}:${userId}`,
            dedupeKey: `az:${org}:review:${repo.id}:${pr.pullRequestId}`,
            title: reviewTitle(vote, pr.title || `!${pr.pullRequestId}`),
            url: `${base}/${proj}/_git/${encodeURIComponent(repo.name)}/pullrequest/${pr.pullRequestId}`,
            repoName: `${project.name}/${repo.name}`,
            repoUrl: repo.webUrl ?? null,
            occurredAt: new Date(when),
            reviewState,
            raw: pr,
          });
        }
        if (reviewItems.length > 0) {
          yield {
            items: reviewItems,
            nextCursor: { ...state, reviewsSince: maxReview },
          };
        }
      }

      // ─── Work Items (via WIQL, por projeto) ─────────────────────────
      const wiql = {
        query:
          "SELECT [System.Id] FROM WorkItems " +
          "WHERE ([System.CreatedBy] = @me OR [System.ChangedBy] = @me) " +
          `AND [System.ChangedDate] >= '${workItemsSince.slice(0, 10)}' ` +
          "ORDER BY [System.ChangedDate] DESC",
      };
      const wiqlRes = await apiPost<{ workItems?: { id: number }[] }>(
        `${base}/${proj}/_apis/wit/wiql?api-version=${API_VERSION}`,
        wiql,
        creds,
      );
      const ids = (wiqlRes.workItems ?? []).slice(0, MAX_PER_TYPE).map((w) => w.id);
      if (ids.length > 0) {
        const detail = await apiGet<
          ListResponse<{
            id: number;
            fields?: Record<string, unknown>;
            _links?: { html?: { href?: string } };
          }>
        >(
          `${base}/${proj}/_apis/wit/workitems?ids=${ids.join(",")}` +
            `&fields=System.Title,System.ChangedDate,System.WorkItemType&api-version=${API_VERSION}`,
          creds,
        );

        const wiItems: NormalizedActivity[] = [];
        for (const wi of detail.value) {
          const fields = wi.fields ?? {};
          const when =
            (fields["System.ChangedDate"] as string) ??
            new Date().toISOString();
          if (when <= workItemsSince) continue;
          if (when > maxWi) maxWi = when;
          const wiType = (fields["System.WorkItemType"] as string) ?? "Work Item";
          const title = (fields["System.Title"] as string) ?? `#${wi.id}`;
          wiItems.push({
            type: "ISSUE",
            externalId: String(wi.id),
            dedupeKey: `az:${org}:wi:${wi.id}`,
            title: `${wiType}: ${title}`,
            url:
              wi._links?.html?.href ??
              `${base}/${proj}/_workitems/edit/${wi.id}`,
            repoName: project.name,
            repoUrl: null,
            occurredAt: new Date(when),
            raw: wi,
          });
        }
        if (wiItems.length > 0) {
          yield {
            items: wiItems,
            nextCursor: { ...state, workItemsSince: maxWi },
          };
        }
      }
    }

    // Cursor final consolidado (garante avanço mesmo sem itens no último yield).
    yield {
      items: [],
      nextCursor: {
        commitsSince: maxCommit,
        prsSince: maxPr,
        reviewsSince: maxReview,
        workItemsSince: maxWi,
      },
    };
  },
};
