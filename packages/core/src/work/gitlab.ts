import type { Credentials } from "../adapters/types.js";
import { WorkInputError, workErrorFromStatus } from "./errors.js";
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
  WorkLabel,
  WorkUser,
} from "./types.js";

const DEFAULT_HOST = "https://gitlab.com";
const PER_PAGE = 30;
/** Projetos varridos ao listar boards (cada um custa 1 request). */
const MAX_BOARD_PROJECTS = 20;
const OPEN_COLUMN = "open";
const CLOSED_COLUMN = "closed";

interface GlUser {
  id?: number;
  username: string;
  name?: string | null;
  avatar_url?: string | null;
}

export interface GlIssue {
  iid: number;
  project_id: number;
  title: string;
  description?: string | null;
  state: string;
  web_url: string;
  labels: string[];
  assignees?: GlUser[] | null;
  author: GlUser | null;
  created_at: string;
  updated_at: string;
  issue_type?: string | null;
  references?: { full?: string } | null;
}

interface GlProject {
  id: number;
  path_with_namespace: string;
  web_url: string;
}

interface GlBoard {
  id: number;
  name: string;
  project?: { web_url?: string; path_with_namespace?: string } | null;
  lists: { id: number; position: number; label: { name: string } | null }[];
}

function apiBase(creds: Credentials): string {
  return `${(creds.baseUrl || DEFAULT_HOST).replace(/\/$/, "")}/api/v4`;
}

/** OAuth vai como Bearer; PAT como PRIVATE-TOKEN (igual ao adapter de ingestão). */
function authHeaders(creds: Credentials): Record<string, string> {
  return creds.tokenType === "oauth"
    ? { Authorization: `Bearer ${creds.accessToken}` }
    : { "PRIVATE-TOKEN": creds.accessToken };
}

async function call<T>(
  creds: Credentials,
  method: string,
  path: string,
  params?: Record<string, string | number | number[] | undefined>,
): Promise<{ data: T; headers: Headers }> {
  const url = new URL(`${apiBase(creds)}${path}`);
  const isRead = method === "GET";
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined) continue;
    const target = isRead ? url.searchParams : body;
    // Arrays viram parâmetros repetidos `k[]=a&k[]=b` (ex.: assignee_ids).
    if (Array.isArray(v)) for (const x of v) target.append(`${k}[]`, String(x));
    else target.set(k, String(v));
  }
  const res = await fetch(url, {
    method,
    headers: {
      ...authHeaders(creds),
      Accept: "application/json",
      ...(isRead ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
    },
    ...(isRead ? {} : { body }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as {
      message?: unknown;
      error?: string;
      error_description?: string;
    };
    const detail =
      j.error_description ??
      j.error ??
      (typeof j.message === "string" ? j.message : JSON.stringify(j.message ?? ""));
    throw workErrorFromStatus("GitLab", res.status, detail);
  }
  return { data: (await res.json()) as T, headers: res.headers };
}

function user(u: GlUser | null | undefined): WorkUser | null {
  return u ? { login: u.username, name: u.name ?? null, avatarUrl: u.avatar_url ?? null } : null;
}

/** `group/proj#12` → `group/proj`; sem references, cai na URL. */
function projectPath(i: GlIssue): string {
  const full = i.references?.full;
  if (full) return full.replace(/#\d+$/, "");
  return i.web_url.replace(/^https?:\/\/[^/]+\//, "").replace(/\/-\/(issues|work_items)\/\d+$/, "");
}

export function mapGitlabIssue(i: GlIssue): WorkItem {
  return {
    ref: joinRef(i.project_id, i.iid),
    provider: "GITLAB",
    number: `#${i.iid}`,
    title: i.title,
    state: i.state === "closed" ? "closed" : "open",
    rawState: i.state,
    kind: i.issue_type ?? "issue",
    url: i.web_url,
    container: {
      id: String(i.project_id),
      name: projectPath(i),
      url: i.web_url.replace(/\/-\/(issues|work_items)\/\d+$/, ""),
    },
    labels: i.labels ?? [],
    assignees: (i.assignees ?? []).map((a) => user(a)!),
    author: user(i.author),
    createdAt: i.created_at,
    updatedAt: i.updated_at,
  };
}

function detail(i: GlIssue): WorkItemDetail {
  return {
    ...mapGitlabIssue(i),
    body: i.description ?? "",
    availableStates: ["opened", "closed"],
  };
}

function cardOf(i: GlIssue): BoardCard {
  const it = mapGitlabIssue(i);
  return {
    id: it.ref,
    ref: it.ref,
    number: it.number,
    title: it.title,
    url: it.url,
    kind: it.kind,
    labels: it.labels,
    assignees: it.assignees,
  };
}

/** `projectId:boardId` (o board é por projeto). */
function splitBoardId(boardId: string): { projectId: string; id: string } {
  const [projectId, id] = boardId.split(":");
  if (!projectId || !id) throw new WorkInputError(`Board inválido: ${boardId}`);
  return { projectId, id };
}

/** Listas de label do board, na ordem de exibição (ignora assignee/milestone). */
function labelLists(board: GlBoard) {
  return board.lists
    .filter((l): l is GlBoard["lists"][number] & { label: { name: string } } => !!l.label)
    .sort((a, b) => a.position - b.position);
}

/**
 * Distribui issues nas colunas como o GitLab faz: fechadas em "Closed"; abertas
 * na primeira lista cuja label possuem; sem nenhuma, em "Open".
 */
export function distributeGitlabBoard(
  board: GlBoard,
  open: GlIssue[],
  closed: GlIssue[],
): BoardColumn[] {
  const lists = labelLists(board);
  const columns: BoardColumn[] = [
    { id: OPEN_COLUMN, name: "Open", cards: [] },
    ...lists.map((l) => ({ id: String(l.id), name: l.label.name, cards: [] as BoardCard[] })),
    { id: CLOSED_COLUMN, name: "Closed", cards: closed.map(cardOf) },
  ];
  for (const issue of open) {
    const idx = lists.findIndex((l) => issue.labels.includes(l.label.name));
    columns[idx + 1]!.cards.push(cardOf(issue));
  }
  return columns;
}

/** Converte usernames em ids (a API de issues só aceita assignee_ids). */
async function userIds(creds: Credentials, usernames: string[]): Promise<number[]> {
  const ids = await Promise.all(
    usernames.map(async (u) => {
      const { data } = await call<GlUser[]>(creds, "GET", "/users", { username: u });
      if (!data[0]?.id) throw new WorkInputError(`Usuário GitLab não encontrado: ${u}`);
      return data[0].id;
    }),
  );
  return ids;
}

function stateEvent(state: string | undefined): "close" | "reopen" | undefined {
  if (state === undefined) return undefined;
  if (state === "closed") return "close";
  if (state === "opened" || state === "open") return "reopen";
  throw new WorkInputError(`Estado inválido: ${state}`);
}

async function listProjects(creds: Credentials): Promise<GlProject[]> {
  const { data } = await call<GlProject[]>(creds, "GET", "/projects", {
    membership: "true",
    archived: "false",
    with_issues_enabled: "true",
    order_by: "last_activity_at",
    per_page: 100,
  });
  return data;
}

export const gitlabWork: WorkAdapter = {
  provider: "GITLAB",

  async listItems(creds, filter): Promise<ItemPage> {
    const page = parseNumCursor(filter.cursor, 1) || 1;
    const { data, headers } = await call<GlIssue[]>(creds, "GET", "/issues", {
      scope: filter.involvement === "created" ? "created_by_me" : "assigned_to_me",
      state:
        filter.state === "open" ? "opened" : filter.state === "closed" ? "closed" : undefined,
      search: filter.q?.trim() || undefined,
      order_by: "updated_at",
      sort: "desc",
      per_page: PER_PAGE,
      page,
    });
    // x-next-page vem vazio na última página (e é omitido acima de 10k itens).
    const next = headers.get("x-next-page");
    const more = next !== null ? next !== "" : data.length === PER_PAGE;
    // x-total também é omitido acima de 10k itens.
    const total = headers.get("x-total");
    return {
      items: data.map(mapGitlabIssue),
      nextCursor: more ? String(page + 1) : null,
      total: total ? Number(total) : null,
    };
  },

  async getItem(creds, ref) {
    const { container, id } = splitRef(ref);
    const { data } = await call<GlIssue>(
      creds,
      "GET",
      `/projects/${encodeURIComponent(container)}/issues/${id}`,
    );
    return detail(data);
  },

  async createItem(creds, input) {
    const { data } = await call<GlIssue>(
      creds,
      "POST",
      `/projects/${encodeURIComponent(input.containerId)}/issues`,
      {
        title: input.title,
        description: input.body,
        labels: input.labels?.join(","),
      },
    );
    return mapGitlabIssue(data);
  },

  async updateItem(creds, ref, input) {
    const { container, id } = splitRef(ref);
    const assigneeIds = input.assignees ? await userIds(creds, input.assignees) : undefined;
    const { data } = await call<GlIssue>(
      creds,
      "PUT",
      `/projects/${encodeURIComponent(container)}/issues/${id}`,
      {
        title: input.title,
        description: input.body,
        state_event: stateEvent(input.state),
        labels: input.labels?.join(","),
        // Lista vazia = remove todos os responsáveis (assignee_ids=0).
        assignee_ids: assigneeIds && (assigneeIds.length ? assigneeIds : 0),
      },
    );
    return detail(data);
  },

  async listComments(creds, ref): Promise<WorkComment[]> {
    const { container, id } = splitRef(ref);
    const { data } = await call<
      { id: number; body: string; system: boolean; author: GlUser; created_at: string }[]
    >(creds, "GET", `/projects/${encodeURIComponent(container)}/issues/${id}/notes`, {
      sort: "asc",
      order_by: "created_at",
      per_page: 100,
    });
    return data
      .filter((n) => !n.system)
      .map((n) => ({
        id: String(n.id),
        author: user(n.author),
        body: n.body,
        createdAt: n.created_at,
      }));
  },

  async addComment(creds, ref, body): Promise<WorkComment> {
    const { container, id } = splitRef(ref);
    const { data } = await call<{ id: number; body: string; author: GlUser; created_at: string }>(
      creds,
      "POST",
      `/projects/${encodeURIComponent(container)}/issues/${id}/notes`,
      { body },
    );
    return { id: String(data.id), author: user(data.author), body: data.body, createdAt: data.created_at };
  },

  async listContainers(creds): Promise<WorkContainer[]> {
    const projects = await listProjects(creds);
    return projects.map((p) => ({ id: String(p.id), name: p.path_with_namespace, url: p.web_url }));
  },

  async listLabels(creds, containerId): Promise<WorkLabel[]> {
    // Inclui as labels herdadas dos grupos (include_ancestor_groups, default true).
    const { data } = await call<{ name: string; color?: string; description?: string | null }[]>(
      creds,
      "GET",
      `/projects/${encodeURIComponent(containerId)}/labels`,
      { per_page: 100 },
    );
    return data.map((l) => ({
      name: l.name,
      color: l.color ?? null,
      description: l.description ?? null,
    }));
  },

  async listBoards(creds): Promise<BoardSummary[]> {
    const projects = (await listProjects(creds)).slice(0, MAX_BOARD_PROJECTS);
    const perProject = await Promise.all(
      projects.map(async (p) => {
        try {
          const { data } = await call<GlBoard[]>(creds, "GET", `/projects/${p.id}/boards`);
          return data.map((b) => ({
            id: `${p.id}:${b.id}`,
            name: b.name || "Board",
            scope: p.path_with_namespace,
            url: `${p.web_url}/-/boards/${b.id}`,
          }));
        } catch {
          return []; // sem acesso aos boards desse projeto: ignora
        }
      }),
    );
    return perProject.flat();
  },

  async getBoard(creds, boardId): Promise<Board> {
    const { projectId, id } = splitBoardId(boardId);
    const base = `/projects/${encodeURIComponent(projectId)}`;
    const [{ data: board }, open, { data: closed }] = await Promise.all([
      call<GlBoard>(creds, "GET", `${base}/boards/${id}`),
      fetchOpenIssues(creds, base),
      call<GlIssue[]>(creds, "GET", `${base}/issues`, {
        state: "closed",
        order_by: "updated_at",
        per_page: 20,
      }),
    ]);
    const webUrl = board.project?.web_url;
    return {
      id: boardId,
      name: `${board.project?.path_with_namespace ?? ""} · ${board.name || "Board"}`,
      url: webUrl ? `${webUrl}/-/boards/${id}` : null,
      columns: distributeGitlabBoard(board, open, closed),
    };
  },

  async moveCard(creds, boardId, cardId, toColumnId) {
    const { projectId, id } = splitBoardId(boardId);
    const { container, id: iid } = splitRef(cardId);
    const base = `/projects/${encodeURIComponent(projectId)}`;
    const [{ data: board }, { data: issue }] = await Promise.all([
      call<GlBoard>(creds, "GET", `${base}/boards/${id}`),
      call<GlIssue>(creds, "GET", `/projects/${encodeURIComponent(container)}/issues/${iid}`),
    ]);
    const lists = labelLists(board);
    const listLabels = new Set(lists.map((l) => l.label.name));
    const target = lists.find((l) => String(l.id) === toColumnId);
    if (!target && toColumnId !== OPEN_COLUMN && toColumnId !== CLOSED_COLUMN) {
      throw new WorkInputError(`Coluna inválida: ${toColumnId}`);
    }

    // Fechar mantém as labels (como no GitLab); demais colunas trocam a label de lista.
    const labels =
      toColumnId === CLOSED_COLUMN
        ? issue.labels
        : [...issue.labels.filter((l) => !listLabels.has(l)), ...(target ? [target.label.name] : [])];
    const event =
      toColumnId === CLOSED_COLUMN
        ? issue.state === "closed" ? undefined : "close"
        : issue.state === "closed" ? "reopen" : undefined;

    await call<GlIssue>(creds, "PUT", `/projects/${encodeURIComponent(container)}/issues/${iid}`, {
      labels: labels.join(","),
      state_event: event,
    });
  },
};

/** Issues abertas do projeto (até 3 páginas de 100). */
async function fetchOpenIssues(creds: Credentials, base: string): Promise<GlIssue[]> {
  const all: GlIssue[] = [];
  for (let page = 1; page <= 3; page++) {
    const { data } = await call<GlIssue[]>(creds, "GET", `${base}/issues`, {
      state: "opened",
      order_by: "relative_position",
      sort: "asc",
      per_page: 100,
      page,
    });
    all.push(...data);
    if (data.length < 100) break;
  }
  return all;
}
