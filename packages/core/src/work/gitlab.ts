import type { Credentials } from "../adapters/types.js";
import { WorkInputError, workErrorFromStatus } from "./errors.js";
import { joinRef, parseNumCursor, splitRef } from "./util.js";
import { TTL, cached, invalidate } from "./cache.js";
import type {
  Board,
  BoardCard,
  BoardColumn,
  BoardSummary,
  ItemPage,
  WorkAdapter,
  WorkComment,
  CreateBranchInput,
  CreateFields,
  CreateFieldsQuery,
  WorkContainer,
  WorkField,
  WorkFieldValue,
  WorkItem,
  WorkItemDetail,
  WorkLabel,
  WorkLink,
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
  milestone?: { id: number; title: string } | null;
  due_date?: string | null;
  /** só existe no plano pago (Premium+); ausente = sem suporte a peso. */
  weight?: number | null;
  time_stats?: { time_estimate?: number; human_time_estimate?: string | null } | null;
}

interface GlLabel {
  name: string;
  color?: string;
  description?: string | null;
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

/* ─── Campos ────────────────────────────────────────────────────────── */

const ISSUE_TYPES = [
  { id: "issue", name: "Issue" },
  { id: "incident", name: "Incident" },
  { id: "task", name: "Task" },
];

/**
 * Labels com escopo (`priority::high`) viram campos de seleção única — é como
 * times GitLab costumam modelar prioridade/severidade/tamanho. Id `scoped:<escopo>`.
 */
export function scopedLabelFields(available: GlLabel[], current: string[]): WorkField[] {
  const scopes = new Map<string, GlLabel[]>();
  for (const l of available) {
    const i = l.name.lastIndexOf("::");
    if (i <= 0) continue;
    const scope = l.name.slice(0, i);
    scopes.set(scope, [...(scopes.get(scope) ?? []), l]);
  }
  return [...scopes].map(([scope, labels]) => ({
    id: `scoped:${scope}`,
    name: scope.charAt(0).toUpperCase() + scope.slice(1),
    type: "single_select" as const,
    group: "Labels com escopo",
    options: labels.map((l) => ({
      id: l.name,
      name: l.name.slice(scope.length + 2),
      color: l.color ?? null,
      description: l.description ?? null,
    })),
    value: current.find((c) => c.startsWith(`${scope}::`)) ?? null,
  }));
}

/** Troca, em `labels`, a label de cada escopo pelo valor do campo `scoped:*`. */
export function applyScopedLabels(
  labels: string[],
  fields: Record<string, WorkFieldValue>,
): string[] {
  let out = [...labels];
  for (const [id, value] of Object.entries(fields)) {
    if (!id.startsWith("scoped:")) continue;
    const scope = id.slice("scoped:".length);
    out = out.filter((l) => !l.startsWith(`${scope}::`));
    if (value !== null && value !== "") out.push(String(value));
  }
  return out;
}

const hasScoped = (fields: Record<string, WorkFieldValue> | undefined) =>
  Object.keys(fields ?? {}).some((k) => k.startsWith("scoped:"));

async function projectMeta(creds: Credentials, projectId: string) {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [milestones, labels] = await Promise.all([
    cached(creds, ["milestones", projectId], TTL.medium, async () => {
      const { data } = await call<{ id: number; title: string; due_date?: string | null }[]>(
        creds,
        "GET",
        `${base}/milestones`,
        { state: "active", include_ancestors: "true", per_page: 100 },
      );
      return data.map((m) => ({ id: m.id, title: m.title, due_date: m.due_date ?? null }));
    }).catch(() => []),
    projectLabels(creds, projectId).catch(() => [] as GlLabel[]),
  ]);
  return { milestones, labels };
}

function issueFields(
  meta: Awaited<ReturnType<typeof projectMeta>>,
  i: Partial<GlIssue>,
  { weight }: { weight: boolean },
): WorkField[] {
  const milestoneOptions = meta.milestones.map((m) => ({
    id: String(m.id),
    name: m.title,
    description: m.due_date ?? null,
  }));
  if (i.milestone && !milestoneOptions.some((m) => m.id === String(i.milestone!.id))) {
    milestoneOptions.push({ id: String(i.milestone.id), name: i.milestone.title, description: null });
  }
  const fields: WorkField[] = [
    {
      id: "type",
      name: "Tipo",
      type: "single_select",
      options: ISSUE_TYPES,
      value: i.issue_type ?? "issue",
    },
    {
      id: "milestone",
      name: "Milestone",
      type: "single_select",
      options: milestoneOptions,
      value: i.milestone ? String(i.milestone.id) : null,
    },
  ];
  if (weight) {
    fields.push({ id: "weight", name: "Peso", type: "number", value: i.weight ?? null });
  }
  fields.push(
    {
      id: "time_estimate",
      name: "Estimativa",
      type: "text",
      hint: "ex.: 3h 30m, 2d",
      value: i.time_stats?.human_time_estimate ?? null,
    },
    { id: "due_date", name: "Entrega", type: "date", value: i.due_date ?? null },
    ...scopedLabelFields(meta.labels, i.labels ?? []),
  );
  return fields;
}

/** Parâmetros da API de issues para os campos nativos (scoped/estimativa à parte). */
function fieldParams(fields: Record<string, WorkFieldValue> | undefined) {
  const f = fields ?? {};
  const out: Record<string, string | number | undefined> = {};
  if ("type" in f) out.issue_type = f.type ? String(f.type) : "issue";
  // 0 remove o milestone
  if ("milestone" in f) out.milestone_id = f.milestone ? Number(f.milestone) : 0;
  if ("weight" in f) out.weight = f.weight === null || f.weight === "" ? "" : Number(f.weight);
  if ("due_date" in f) out.due_date = f.due_date ? String(f.due_date) : "";
  return out;
}

async function setTimeEstimate(creds: Credentials, path: string, value: WorkFieldValue) {
  if (value === null || String(value).trim() === "") {
    await call(creds, "POST", `${path}/reset_time_estimate`);
  } else {
    await call(creds, "POST", `${path}/time_estimate`, {
      duration: String(value).replace(/\s+/g, ""),
    });
  }
}

async function detail(creds: Credentials, i: GlIssue): Promise<WorkItemDetail> {
  const base = `/projects/${i.project_id}`;
  const [meta, mrs, branches] = await Promise.all([
    projectMeta(creds, String(i.project_id)),
    call<{ iid: number; title: string; web_url: string; state: string }[]>(
      creds,
      "GET",
      `${base}/issues/${i.iid}/related_merge_requests`,
    )
      .then((r) => r.data)
      .catch(() => []),
    // GitLab relaciona as branches que começam com "<iid>-".
    call<{ name: string; web_url?: string }[]>(creds, "GET", `${base}/repository/branches`, {
      search: `^${i.iid}-`,
    })
      .then((r) => r.data)
      .catch(() => []),
  ]);
  const item = mapGitlabIssue(i);
  const links: WorkLink[] = [
    ...branches.map((b) => ({
      kind: "branch" as const,
      name: b.name,
      url: b.web_url ?? `${item.container.url}/-/tree/${b.name}`,
    })),
    ...mrs.map((m) => ({
      kind: "pull_request" as const,
      name: `!${m.iid} ${m.title}`,
      url: m.web_url,
      state: m.state,
    })),
  ];
  return {
    ...item,
    body: i.description ?? "",
    availableStates: ["opened", "closed"],
    fields: issueFields(meta, i, { weight: "weight" in i }),
    links,
    branchRepositories: null,
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
      const id = await cached(creds, ["user-id", u], TTL.long, async () => {
        const { data } = await call<GlUser[]>(creds, "GET", "/users", { username: u });
        return data[0]?.id ?? null;
      });
      if (!id) throw new WorkInputError(`Usuário GitLab não encontrado: ${u}`);
      return id;
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
  return cached(creds, ["projects"], TTL.short, async () => {
    const { data } = await call<GlProject[]>(creds, "GET", "/projects", {
      membership: "true",
      archived: "false",
      with_issues_enabled: "true",
      order_by: "last_activity_at",
      per_page: 100,
    });
    // só o necessário (a resposta completa do GitLab é grande)
    return data.map((p) => ({ id: p.id, path_with_namespace: p.path_with_namespace, web_url: p.web_url }));
  });
}

/** Projeto (nome, URL e branch principal). */
function projectInfo(creds: Credentials, projectId: string) {
  return cached(creds, ["project", projectId], TTL.long, async () => {
    const { data } = await call<GlProject & { default_branch?: string | null }>(
      creds,
      "GET",
      `/projects/${encodeURIComponent(projectId)}`,
    );
    return {
      id: data.id,
      path_with_namespace: data.path_with_namespace,
      web_url: data.web_url,
      default_branch: data.default_branch ?? null,
    };
  });
}

/** Labels do projeto (inclui as herdadas dos grupos), com cor e descrição. */
function projectLabels(creds: Credentials, projectId: string): Promise<GlLabel[]> {
  return cached(creds, ["labels", projectId], TTL.short, async () => {
    const { data } = await call<GlLabel[]>(
      creds,
      "GET",
      `/projects/${encodeURIComponent(projectId)}/labels`,
      { per_page: 100 },
    );
    return data.map((l) => ({ name: l.name, color: l.color, description: l.description ?? null }));
  });
}

/** Configuração do board (listas). Os cards são sempre ao vivo. */
function boardConfig(creds: Credentials, projectId: string, id: string): Promise<GlBoard> {
  return cached(creds, ["board", projectId, id], TTL.short, async () => {
    const { data } = await call<GlBoard>(
      creds,
      "GET",
      `/projects/${encodeURIComponent(projectId)}/boards/${id}`,
    );
    return {
      id: data.id,
      name: data.name,
      project: data.project
        ? { web_url: data.project.web_url, path_with_namespace: data.project.path_with_namespace }
        : null,
      lists: data.lists.map((l) => ({
        id: l.id,
        position: l.position,
        label: l.label ? { name: l.label.name } : null,
      })),
    };
  });
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
    return detail(creds, data);
  },

  async createItem(creds, input) {
    const fields = input.fields ?? {};
    let labels = applyScopedLabels(input.labels ?? [], fields);
    let close = false;
    if (input.boardId) {
      const { projectId, id } = splitBoardId(input.boardId);
      if (projectId !== input.containerId) {
        throw new WorkInputError("O board pertence a outro projeto");
      }
      if (input.columnId === CLOSED_COLUMN) close = true;
      else if (input.columnId && input.columnId !== OPEN_COLUMN) {
        const board = await boardConfig(creds, projectId, id);
        const list = labelLists(board).find((l) => String(l.id) === input.columnId);
        if (!list) throw new WorkInputError(`Coluna inválida: ${input.columnId}`);
        labels = [...labels.filter((l) => l !== list.label.name), list.label.name];
      }
    }
    const assigneeIds = input.assignees?.length ? await userIds(creds, input.assignees) : undefined;
    const path = `/projects/${encodeURIComponent(input.containerId)}/issues`;
    const { data } = await call<GlIssue>(creds, "POST", path, {
      title: input.title,
      description: input.body,
      labels: labels.length ? labels.join(",") : undefined,
      assignee_ids: assigneeIds,
      ...fieldParams(fields),
    });
    // labels inexistentes são criadas pelo GitLab
    if (input.labels?.length) await invalidate(creds, ["labels", input.containerId]);
    if (fields.time_estimate) {
      await setTimeEstimate(creds, `${path}/${data.iid}`, fields.time_estimate);
    }
    if (close) {
      const { data: closed } = await call<GlIssue>(creds, "PUT", `${path}/${data.iid}`, {
        state_event: "close",
      });
      return mapGitlabIssue(closed);
    }
    return mapGitlabIssue(data);
  },

  async updateItem(creds, ref, input) {
    const { container, id } = splitRef(ref);
    const path = `/projects/${encodeURIComponent(container)}/issues/${id}`;
    const fields = input.fields ?? {};
    const assigneeIds = input.assignees ? await userIds(creds, input.assignees) : undefined;
    let labels = input.labels;
    if (hasScoped(fields)) {
      const base = labels ?? (await call<GlIssue>(creds, "GET", path)).data.labels;
      labels = applyScopedLabels(base, fields);
    }
    if ("time_estimate" in fields) await setTimeEstimate(creds, path, fields.time_estimate ?? null);
    const { data } = await call<GlIssue>(creds, "PUT", path, {
      title: input.title,
      description: input.body,
      state_event: stateEvent(input.state),
      labels: labels?.join(","),
      // Lista vazia = remove todos os responsáveis (assignee_ids=0).
      assignee_ids: assigneeIds && (assigneeIds.length ? assigneeIds : 0),
      ...fieldParams(fields),
    });
    if (input.labels?.length) await invalidate(creds, ["labels", container]);
    return detail(creds, data);
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
    const data = await projectLabels(creds, containerId);
    return data.map((l) => ({
      name: l.name,
      color: l.color ?? null,
      description: l.description ?? null,
    }));
  },

  async listAssignees(creds, containerId): Promise<WorkUser[]> {
    return cached(creds, ["assignees", containerId], TTL.medium, () => loadAssignees(creds, containerId));
  },

  async getCreateFields(creds, query): Promise<CreateFields> {
    return createFields(creds, query);
  },

  async createBranch(creds, ref, input): Promise<WorkLink> {
    return createBranch(creds, ref, input);
  },

  async listBoards(creds): Promise<BoardSummary[]> {
    return cached(creds, ["boards"], TTL.short, () => loadBoards(creds));
  },

  async getBoard(creds, boardId): Promise<Board> {
    return loadBoard(creds, boardId);
  },

  async moveCard(creds, boardId, cardId, toColumnId) {
    return moveCard(creds, boardId, cardId, toColumnId);
  },
};

async function loadAssignees(creds: Credentials, containerId: string): Promise<WorkUser[]> {
  const out: WorkUser[] = [];
  for (let page = 1; page <= 3; page++) {
    const { data } = await call<(GlUser & { state?: string })[]>(
      creds,
      "GET",
      `/projects/${encodeURIComponent(containerId)}/users`,
      { per_page: 100, page },
    );
    out.push(...data.filter((u) => u.state !== "blocked").map((u) => user(u)!));
    if (data.length < 100) break;
  }
  return out;
}

async function createFields(creds: Credentials, query: CreateFieldsQuery): Promise<CreateFields> {
  let container: WorkContainer | null = null;
  let projectId = query.containerId;
  if (query.boardId) {
    projectId = splitBoardId(query.boardId).projectId;
    const p = await projectInfo(creds, projectId);
    container = { id: String(p.id), name: p.path_with_namespace, url: p.web_url };
  }
  if (!projectId) return { fields: [], container };
  const [meta, sample] = await Promise.all([
    projectMeta(creds, projectId),
    // Peso só existe no plano pago: detecta pela presença do campo numa issue.
    cached(creds, ["weight", projectId], TTL.long, async () => {
      const { data } = await call<GlIssue[]>(
        creds,
        "GET",
        `/projects/${encodeURIComponent(projectId)}/issues`,
        { per_page: 1 },
      );
      return !!data[0] && "weight" in data[0];
    }).catch(() => false),
  ]);
  return {
    fields: issueFields(meta, {}, { weight: sample }),
    container,
  };
}

async function createBranch(
  creds: Credentials,
  ref: string,
  input: CreateBranchInput,
): Promise<WorkLink> {
  const { container } = splitRef(ref);
  const base = `/projects/${encodeURIComponent(container)}`;
  const project = await projectInfo(creds, container);
  if (!project.default_branch) throw new WorkInputError("Projeto sem branch principal");
  const { data } = await call<{ name: string; web_url?: string }>(
    creds,
    "POST",
    `${base}/repository/branches`,
    { branch: input.name, ref: project.default_branch },
  );
  return {
    kind: "branch",
    name: data.name,
    url: data.web_url ?? `${project.web_url}/-/tree/${data.name}`,
  };
}

async function loadBoards(creds: Credentials): Promise<BoardSummary[]> {
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
}

async function loadBoard(creds: Credentials, boardId: string): Promise<Board> {
  const { projectId, id } = splitBoardId(boardId);
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [board, open, { data: closed }] = await Promise.all([
    boardConfig(creds, projectId, id),
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
}

async function moveCard(
  creds: Credentials,
  boardId: string,
  cardId: string,
  toColumnId: string,
): Promise<void> {
  const { projectId, id } = splitBoardId(boardId);
  const { container, id: iid } = splitRef(cardId);
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [board, { data: issue }] = await Promise.all([
    boardConfig(creds, projectId, id),
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
}

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
