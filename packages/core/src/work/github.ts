import { Octokit } from "octokit";
import type { Credentials } from "../adapters/types.js";
import {
  ScopeError,
  WorkInputError,
  WorkNotFoundError,
  workErrorFromStatus,
} from "./errors.js";
import { joinRef, parseNumCursor, splitRef } from "./util.js";
import type {
  Board,
  BoardCard,
  BoardColumn,
  BoardSummary,
  ItemPage,
  WorkAdapter,
  WorkComment,
  WorkContainer,
  WorkItem,
  WorkItemDetail,
  WorkUser,
} from "./types.js";

const PER_PAGE = 30;
/** A Search API só devolve os primeiros 1000 resultados. */
const SEARCH_CAP = 1000;
/** Itens de um Project v2 buscados por board (páginas de 100). */
const MAX_BOARD_ITEMS = 500;
/** Coluna dos cards sem valor no campo Status. */
const NO_STATUS = "__none";

function makeClient(creds: Credentials): Octokit {
  return new Octokit({
    auth: creds.accessToken,
    ...(creds.baseUrl ? { baseUrl: creds.baseUrl.replace(/\/$/, "") } : {}),
  });
}

/** Erros REST (status) e GraphQL (errors[].type) → erros de domínio. */
function asWorkError(err: unknown): unknown {
  if (typeof err !== "object" || err === null) return err;
  const e = err as {
    status?: number;
    message?: string;
    errors?: { type?: string; message?: string }[];
  };
  if (Array.isArray(e.errors) && e.errors.length > 0) {
    const first = e.errors[0]!;
    if (first.type === "INSUFFICIENT_SCOPES" || first.type === "FORBIDDEN") {
      return new ScopeError(
        "GitHub: sem permissão (o token precisa do escopo project para boards)",
      );
    }
    if (first.type === "NOT_FOUND") return new WorkNotFoundError(first.message);
    return new Error(`GitHub: ${first.message ?? "erro GraphQL"}`);
  }
  if (typeof e.status === "number") {
    return workErrorFromStatus("GitHub", e.status, e.message);
  }
  return err;
}

async function gh<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw asWorkError(err);
  }
}

interface GhUser {
  login: string;
  avatar_url?: string | null;
  name?: string | null;
}

export interface GhIssue {
  number: number;
  title: string;
  state: string;
  html_url: string;
  repository_url: string;
  labels: (string | { name?: string | null })[];
  assignees?: GhUser[] | null;
  user: GhUser | null;
  created_at: string;
  updated_at: string;
  body?: string | null;
  pull_request?: unknown;
}

function user(u: GhUser | null | undefined): WorkUser | null {
  return u ? { login: u.login, avatarUrl: u.avatar_url ?? null } : null;
}

/** `https://api.github.com/repos/owner/repo` → `owner/repo`. */
function repoOf(repositoryUrl: string): string {
  const parts = repositoryUrl.split("/");
  return parts.slice(-2).join("/");
}

function ownerRepo(container: string): { owner: string; repo: string } {
  const [owner, repo] = container.split("/");
  if (!owner || !repo) throw new WorkInputError(`Repositório inválido: ${container}`);
  return { owner, repo };
}

export function mapGithubIssue(i: GhIssue): WorkItem {
  const repo = repoOf(i.repository_url);
  return {
    ref: joinRef(repo, i.number),
    provider: "GITHUB",
    number: `#${i.number}`,
    title: i.title,
    state: i.state === "closed" ? "closed" : "open",
    rawState: i.state,
    kind: i.pull_request ? "pull request" : "issue",
    url: i.html_url,
    container: {
      id: repo,
      name: repo,
      url: i.html_url.replace(/\/(issues|pull)\/\d+$/, ""),
    },
    labels: i.labels
      .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
      .filter(Boolean),
    assignees: (i.assignees ?? []).map((a) => user(a)!),
    author: user(i.user),
    createdAt: i.created_at,
    updatedAt: i.updated_at,
  };
}

function detail(i: GhIssue): WorkItemDetail {
  return {
    ...mapGithubIssue(i),
    body: i.body ?? "",
    availableStates: ["open", "closed"],
  };
}

/* ─── Projects v2 (boards) ─────────────────────────────────────────── */

interface GqlProject {
  id: string;
  title: string;
  url: string;
  closed: boolean;
}

interface GqlItemContent {
  __typename: "Issue" | "PullRequest" | "DraftIssue";
  number?: number;
  title: string;
  url?: string;
  repository?: { nameWithOwner: string };
  labels?: { nodes: { name: string }[] };
  assignees?: { nodes: { login: string; avatarUrl?: string }[] };
}

interface GqlBoard {
  node: {
    title: string;
    url: string;
    field: { id: string; options: { id: string; name: string }[] } | null;
    items: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: {
        id: string;
        isArchived?: boolean;
        status: { optionId: string | null } | null;
        content: GqlItemContent | null;
      }[];
    };
  } | null;
}

const BOARD_QUERY = /* GraphQL */ `
  query ($id: ID!, $after: String) {
    node(id: $id) {
      ... on ProjectV2 {
        title
        url
        field(name: "Status") {
          ... on ProjectV2SingleSelectField { id options { id name } }
        }
        items(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            isArchived
            status: fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue { optionId }
            }
            content {
              __typename
              ... on Issue {
                number title url
                repository { nameWithOwner }
                labels(first: 10) { nodes { name } }
                assignees(first: 5) { nodes { login avatarUrl } }
              }
              ... on PullRequest {
                number title url
                repository { nameWithOwner }
                labels(first: 10) { nodes { name } }
                assignees(first: 5) { nodes { login avatarUrl } }
              }
              ... on DraftIssue { title }
            }
          }
        }
      }
    }
  }
`;

export function mapGithubCard(
  id: string,
  content: GqlItemContent | null,
): BoardCard {
  const repo = content?.repository?.nameWithOwner;
  const hasRef = repo && content?.number !== undefined;
  return {
    id,
    ref: hasRef ? joinRef(repo, content!.number!) : null,
    number: content?.number !== undefined ? `#${content.number}` : null,
    title: content?.title ?? "(sem acesso ao item)",
    url: content?.url ?? null,
    kind:
      content?.__typename === "PullRequest"
        ? "pull request"
        : content?.__typename === "DraftIssue"
          ? "rascunho"
          : "issue",
    labels: content?.labels?.nodes.map((l) => l.name) ?? [],
    assignees:
      content?.assignees?.nodes.map((a) => ({
        login: a.login,
        avatarUrl: a.avatarUrl ?? null,
      })) ?? [],
  };
}

async function statusFieldId(api: Octokit, projectId: string): Promise<string> {
  const res = await gh(() =>
    api.graphql<{ node: { field: { id: string } | null } | null }>(
      `query ($id: ID!) {
        node(id: $id) {
          ... on ProjectV2 {
            field(name: "Status") { ... on ProjectV2SingleSelectField { id } }
          }
        }
      }`,
      { id: projectId },
    ),
  );
  if (!res.node) throw new WorkNotFoundError("Board não encontrado");
  if (!res.node.field) {
    throw new WorkInputError('Este project não tem o campo "Status"');
  }
  return res.node.field.id;
}

export const githubWork: WorkAdapter = {
  provider: "GITHUB",

  async listItems(creds, filter): Promise<ItemPage> {
    const api = makeClient(creds);
    const page = parseNumCursor(filter.cursor, 1) || 1;
    const qualifiers = [
      "is:issue",
      "archived:false",
      filter.involvement === "created" ? "author:@me" : "assignee:@me",
    ];
    if (filter.state === "open" || filter.state === "closed") {
      qualifiers.push(`is:${filter.state}`);
    }
    if (filter.q?.trim()) qualifiers.push(filter.q.trim());

    const res = await gh(() =>
      api.request("GET /search/issues", {
        q: qualifiers.join(" "),
        sort: "updated",
        order: "desc",
        per_page: PER_PAGE,
        page,
      }),
    );
    const items = (res.data.items as unknown as GhIssue[]).map(mapGithubIssue);
    const seen = page * PER_PAGE;
    const more =
      items.length === PER_PAGE &&
      seen < Math.min(res.data.total_count, SEARCH_CAP);
    return {
      items,
      nextCursor: more ? String(page + 1) : null,
      total: res.data.total_count,
    };
  },

  async getItem(creds, ref) {
    const { container, id } = splitRef(ref);
    const api = makeClient(creds);
    const res = await gh(() =>
      api.rest.issues.get({ ...ownerRepo(container), issue_number: Number(id) }),
    );
    return detail(res.data as unknown as GhIssue);
  },

  async createItem(creds, input) {
    const api = makeClient(creds);
    const res = await gh(() =>
      api.rest.issues.create({
        ...ownerRepo(input.containerId),
        title: input.title,
        body: input.body,
        labels: input.labels,
      }),
    );
    return mapGithubIssue(res.data as unknown as GhIssue);
  },

  async updateItem(creds, ref, input) {
    const { container, id } = splitRef(ref);
    if (input.state && input.state !== "open" && input.state !== "closed") {
      throw new WorkInputError(`Estado inválido: ${input.state}`);
    }
    const api = makeClient(creds);
    const res = await gh(() =>
      api.rest.issues.update({
        ...ownerRepo(container),
        issue_number: Number(id),
        title: input.title,
        body: input.body,
        state: input.state as "open" | "closed" | undefined,
        labels: input.labels,
        assignees: input.assignees,
      }),
    );
    return detail(res.data as unknown as GhIssue);
  },

  async listComments(creds, ref): Promise<WorkComment[]> {
    const { container, id } = splitRef(ref);
    const api = makeClient(creds);
    const res = await gh(() =>
      api.rest.issues.listComments({
        ...ownerRepo(container),
        issue_number: Number(id),
        per_page: 100,
      }),
    );
    return res.data.map((c) => ({
      id: String(c.id),
      author: user(c.user as GhUser | null),
      body: c.body ?? "",
      createdAt: c.created_at,
    }));
  },

  async addComment(creds, ref, body): Promise<WorkComment> {
    const { container, id } = splitRef(ref);
    const api = makeClient(creds);
    const res = await gh(() =>
      api.rest.issues.createComment({
        ...ownerRepo(container),
        issue_number: Number(id),
        body,
      }),
    );
    return {
      id: String(res.data.id),
      author: user(res.data.user as GhUser | null),
      body: res.data.body ?? "",
      createdAt: res.data.created_at,
    };
  },

  async listContainers(creds): Promise<WorkContainer[]> {
    const api = makeClient(creds);
    const res = await gh(() =>
      api.rest.repos.listForAuthenticatedUser({ sort: "pushed", per_page: 100 }),
    );
    return res.data
      .filter((r) => r.has_issues && !r.archived)
      .map((r) => ({ id: r.full_name, name: r.full_name, url: r.html_url }));
  },

  async listBoards(creds): Promise<BoardSummary[]> {
    const api = makeClient(creds);
    const fields = "nodes { id title url closed }";
    const mine = await gh(() =>
      api.graphql<{ viewer: { login: string; projectsV2: { nodes: GqlProject[] } } }>(
        `query { viewer { login projectsV2(first: 50) { ${fields} } } }`,
      ),
    );
    const found: { scope: string; p: GqlProject }[] = mine.viewer.projectsV2.nodes.map(
      (p) => ({ scope: mine.viewer.login, p }),
    );

    // Projects de organizações exigem read:org; sem ele, segue só com os do
    // usuário (o GraphQL devolve dados parciais junto com o erro).
    type OrgRes = {
      viewer?: {
        organizations?: {
          nodes: ({ login: string; projectsV2?: { nodes: (GqlProject | null)[] } } | null)[];
        };
      };
    };
    let orgs: OrgRes | undefined;
    try {
      orgs = await api.graphql<OrgRes>(
        `query { viewer { organizations(first: 20) { nodes { login projectsV2(first: 30) { ${fields} } } } } }`,
      );
    } catch (err) {
      orgs = (err as { data?: OrgRes }).data;
    }
    for (const org of orgs?.viewer?.organizations?.nodes ?? []) {
      for (const p of org?.projectsV2?.nodes ?? []) {
        if (org && p) found.push({ scope: org.login, p });
      }
    }
    return found
      .filter(({ p }) => !p.closed)
      .map(({ scope, p }) => ({ id: p.id, name: p.title, scope, url: p.url }));
  },

  async getBoard(creds, boardId): Promise<Board> {
    const api = makeClient(creds);
    let after: string | null = null;
    let first: NonNullable<GqlBoard["node"]> | null = null;
    const nodes: NonNullable<GqlBoard["node"]>["items"]["nodes"] = [];
    do {
      const res: GqlBoard = await gh(() =>
        api.graphql<GqlBoard>(BOARD_QUERY, { id: boardId, after }),
      );
      if (!res.node) throw new WorkNotFoundError("Board não encontrado");
      first ??= res.node;
      nodes.push(...res.node.items.nodes);
      after = res.node.items.pageInfo.hasNextPage
        ? res.node.items.pageInfo.endCursor
        : null;
    } while (after && nodes.length < MAX_BOARD_ITEMS);

    const options = first!.field?.options ?? [];
    const columns: BoardColumn[] = [
      { id: NO_STATUS, name: "Sem status", cards: [] },
      ...options.map((o) => ({ id: o.id, name: o.name, cards: [] as BoardCard[] })),
    ];
    const byId = new Map(columns.map((c) => [c.id, c]));
    for (const n of nodes) {
      if (n.isArchived) continue;
      const col = byId.get(n.status?.optionId ?? NO_STATUS) ?? byId.get(NO_STATUS)!;
      col.cards.push(mapGithubCard(n.id, n.content));
    }
    // "Sem status" só aparece se tiver cards (ou se o project não tem Status).
    const shown = columns.filter(
      (c) => c.id !== NO_STATUS || c.cards.length > 0 || options.length === 0,
    );
    return { id: boardId, name: first!.title, url: first!.url, columns: shown };
  },

  async moveCard(creds, boardId, cardId, toColumnId) {
    const api = makeClient(creds);
    const fieldId = await statusFieldId(api, boardId);
    if (toColumnId === NO_STATUS) {
      await gh(() =>
        api.graphql(
          `mutation ($p: ID!, $i: ID!, $f: ID!) {
            clearProjectV2ItemFieldValue(input: { projectId: $p, itemId: $i, fieldId: $f }) { clientMutationId }
          }`,
          { p: boardId, i: cardId, f: fieldId },
        ),
      );
      return;
    }
    await gh(() =>
      api.graphql(
        `mutation ($p: ID!, $i: ID!, $f: ID!, $o: String!) {
          updateProjectV2ItemFieldValue(
            input: { projectId: $p, itemId: $i, fieldId: $f, value: { singleSelectOptionId: $o } }
          ) { clientMutationId }
        }`,
        { p: boardId, i: cardId, f: fieldId, o: toColumnId },
      ),
    );
  },
};
