import { AuthError, type Credentials } from "../adapters/types.js";
import { WorkInputError, WorkNotFoundError, workErrorFromStatus } from "./errors.js";
import { htmlToText, joinRef, parseNumCursor, splitRef, textToHtml } from "./util.js";
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
  WorkState,
} from "./types.js";

const API = "api-version=7.1";
const COMMENTS_API = "api-version=7.1-preview.4";
const TAGS_API = "api-version=7.1-preview.1";
const PER_PAGE = 30;
/** Teto de ids do WIQL na listagem (paginada por offset sobre eles). */
const WIQL_TOP = 1000;
/** Teto de cards carregados por board. */
const BOARD_TOP = 300;
/** Lote máximo do workitemsbatch. */
const BATCH = 200;
/** Projetos varridos ao listar boards (cada um custa 2 requests). */
const MAX_BOARD_PROJECTS = 20;

/**
 * Estados "finalizados" dos processos padrão (Agile, Scrum, Basic, CMMI). O
 * WIQL não filtra por categoria de estado, então a listagem usa esta lista;
 * o detalhe usa as categorias reais do tipo (`stateCategories`).
 */
export const AZURE_CLOSED_STATES = ["Closed", "Done", "Removed", "Resolved", "Completed"];

const FIELDS = [
  "System.Id",
  "System.Title",
  "System.State",
  "System.WorkItemType",
  "System.TeamProject",
  "System.Tags",
  "System.AssignedTo",
  "System.CreatedBy",
  "System.CreatedDate",
  "System.ChangedDate",
];

interface Identity {
  displayName?: string;
  uniqueName?: string;
  imageUrl?: string;
}

export interface AzWorkItem {
  id: number;
  fields: Record<string, unknown>;
}

function orgBase(creds: Credentials): string {
  const base = (creds.baseUrl || "").trim().replace(/\/$/, "");
  if (!base) throw new AuthError("Azure DevOps: conexão sem URL da organização");
  return base;
}

function authHeader(creds: Credentials): string {
  if (creds.tokenType === "oauth") return `Bearer ${creds.accessToken}`;
  return `Basic ${Buffer.from(`:${creds.accessToken}`).toString("base64")}`;
}

async function call<T>(
  creds: Credentials,
  method: string,
  url: string,
  body?: unknown,
  contentType = "application/json",
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader(creds),
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": contentType } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  // PAT inválido às vezes responde 203 com a página HTML de login.
  if (res.status === 203) throw workErrorFromStatus("Azure DevOps", 401);
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { message?: string };
    throw workErrorFromStatus("Azure DevOps", res.status, j.message);
  }
  return (await res.json()) as T;
}

/** Escapa um literal de string do WIQL (aspas simples dobradas). */
function wiqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function identity(v: unknown): WorkUser | null {
  if (!v || typeof v !== "object") return null;
  const i = v as Identity;
  if (!i.uniqueName && !i.displayName) return null;
  return {
    login: i.uniqueName ?? i.displayName ?? "",
    name: i.displayName ?? null,
    avatarUrl: i.imageUrl ?? null,
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function itemUrl(base: string, project: string, id: number | string): string {
  return `${base}/${encodeURIComponent(project)}/_workitems/edit/${id}`;
}

function stateOf(raw: string): WorkState {
  return AZURE_CLOSED_STATES.includes(raw) ? "closed" : "open";
}

export function mapAzureItem(base: string, w: AzWorkItem): WorkItem {
  const f = w.fields;
  const project = str(f["System.TeamProject"]);
  const assigned = identity(f["System.AssignedTo"]);
  const rawState = str(f["System.State"]);
  return {
    ref: joinRef(project, w.id),
    provider: "AZURE",
    number: `#${w.id}`,
    title: str(f["System.Title"]),
    state: stateOf(rawState),
    rawState,
    kind: str(f["System.WorkItemType"]) || "Work item",
    url: itemUrl(base, project, w.id),
    container: { id: project, name: project, url: `${base}/${encodeURIComponent(project)}` },
    labels: str(f["System.Tags"])
      .split(";")
      .map((t) => t.trim())
      .filter(Boolean),
    assignees: assigned ? [assigned] : [],
    author: identity(f["System.CreatedBy"]),
    createdAt: str(f["System.CreatedDate"]),
    updatedAt: str(f["System.ChangedDate"]),
  };
}

async function wiql(creds: Credentials, scopeUrl: string, query: string, top: number) {
  const res = await call<{ workItems: { id: number }[] }>(
    creds,
    "POST",
    `${scopeUrl}/_apis/wit/wiql?${API}&$top=${top}`,
    { query },
  );
  return res.workItems.map((w) => w.id);
}

/** Carrega itens por id (em lotes), preservando a ordem dos ids. */
async function batch(
  creds: Credentials,
  ids: number[],
  fields: string[] = FIELDS,
): Promise<AzWorkItem[]> {
  const base = orgBase(creds);
  const out: AzWorkItem[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const res = await call<{ value: AzWorkItem[] }>(
      creds,
      "POST",
      `${base}/_apis/wit/workitemsbatch?${API}`,
      { ids: ids.slice(i, i + BATCH), fields, errorPolicy: "omit" },
    );
    out.push(...res.value.filter(Boolean));
  }
  const pos = new Map(ids.map((id, i) => [id, i]));
  return out.sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
}

/** Categorias de estado do tipo (Proposed, InProgress, Resolved, Completed, Removed). */
async function stateCategories(
  creds: Credentials,
  project: string,
  type: string,
): Promise<{ name: string; category: string }[]> {
  const res = await call<{ value: { name: string; category: string }[] }>(
    creds,
    "GET",
    `${orgBase(creds)}/${encodeURIComponent(project)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/states?${API}`,
  );
  return res.value;
}

async function getDetail(creds: Credentials, project: string, id: string): Promise<WorkItemDetail> {
  const base = orgBase(creds);
  const w = await call<AzWorkItem>(creds, "GET", `${base}/_apis/wit/workitems/${id}?${API}`);
  const item = mapAzureItem(base, w);
  const states = await stateCategories(creds, project, item.kind).catch(() => []);
  const cat = states.find((s) => s.name === item.rawState)?.category;
  return {
    ...item,
    state: cat ? (["Completed", "Removed", "Resolved"].includes(cat) ? "closed" : "open") : item.state,
    body: htmlToText(str(w.fields["System.Description"])),
    availableStates: states.length ? states.map((s) => s.name) : [item.rawState],
  };
}

type PatchOp = { op: "add" | "replace"; path: string; value: unknown };

function patchOps(input: {
  title?: string;
  body?: string;
  state?: string;
  labels?: string[];
  assignees?: string[];
}): PatchOp[] {
  const ops: PatchOp[] = [];
  const set = (field: string, value: unknown) =>
    ops.push({ op: "add", path: `/fields/${field}`, value });
  if (input.title !== undefined) set("System.Title", input.title);
  if (input.body !== undefined) set("System.Description", textToHtml(input.body));
  if (input.state !== undefined) set("System.State", input.state);
  if (input.labels !== undefined) set("System.Tags", input.labels.join("; "));
  // Azure só tem 1 responsável; "" remove.
  if (input.assignees !== undefined) set("System.AssignedTo", input.assignees[0] ?? "");
  return ops;
}

/** Tipo usado na criação: o primeiro disponível na ordem de preferência. */
const CREATE_TYPES = ["Issue", "User Story", "Product Backlog Item", "Requirement", "Task"];

async function defaultType(creds: Credentials, project: string): Promise<string> {
  const res = await call<{ value: { name: string; isDisabled?: boolean }[] }>(
    creds,
    "GET",
    `${orgBase(creds)}/${encodeURIComponent(project)}/_apis/wit/workitemtypes?${API}`,
  );
  const names = new Set(res.value.filter((t) => !t.isDisabled).map((t) => t.name));
  const pick = CREATE_TYPES.find((t) => names.has(t));
  if (!pick) throw new WorkInputError("Nenhum tipo de work item compatível no projeto");
  return pick;
}

/* ─── Boards ───────────────────────────────────────────────────────── */

interface AzBoard {
  id: string;
  name: string;
  columns: {
    id: string;
    name: string;
    columnType?: string;
    stateMappings: Record<string, string>;
  }[];
  fields?: { columnField?: { referenceName?: string } };
}

/** `projeto/time/boardId` (nomes não podem conter "/" no Azure DevOps). */
function splitBoardId(boardId: string): { project: string; team: string; id: string } {
  const [project, team, id] = boardId.split("/");
  if (!project || !team || !id) throw new WorkInputError(`Board inválido: ${boardId}`);
  return { project, team, id };
}

function teamUrl(base: string, project: string, team: string): string {
  return `${base}/${encodeURIComponent(project)}/${encodeURIComponent(team)}`;
}

async function loadBoard(creds: Credentials, boardId: string) {
  const { project, team, id } = splitBoardId(boardId);
  const base = orgBase(creds);
  const board = await call<AzBoard>(
    creds,
    "GET",
    `${teamUrl(base, project, team)}/_apis/work/boards/${encodeURIComponent(id)}?${API}`,
  );
  const columnField = board.fields?.columnField?.referenceName;
  if (!columnField) throw new WorkInputError("Board sem campo de coluna configurado");
  return { project, team, base, board, columnField };
}

/**
 * Coluna de um card: o campo Kanban.Column do board; se vazio (item nunca
 * aberto no board), a primeira coluna mapeada para o estado/tipo do item.
 */
export function azureColumnOf(
  board: AzBoard,
  columnField: string,
  w: AzWorkItem,
): string | undefined {
  const col = str(w.fields[columnField]);
  if (col && board.columns.some((c) => c.name === col)) return col;
  const type = str(w.fields["System.WorkItemType"]);
  const state = str(w.fields["System.State"]);
  return board.columns.find((c) => c.stateMappings[type] === state)?.name;
}

function cardOf(base: string, w: AzWorkItem): BoardCard {
  const it = mapAzureItem(base, w);
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

async function listProjects(creds: Credentials): Promise<WorkContainer[]> {
  const base = orgBase(creds);
  const res = await call<{ value: { name: string }[] }>(
    creds,
    "GET",
    `${base}/_apis/projects?${API}&$top=200`,
  );
  return res.value.map((p) => ({
    id: p.name,
    name: p.name,
    url: `${base}/${encodeURIComponent(p.name)}`,
  }));
}

export const azureWork: WorkAdapter = {
  provider: "AZURE",

  async listItems(creds, filter): Promise<ItemPage> {
    const base = orgBase(creds);
    const offset = parseNumCursor(filter.cursor, 0);
    const who = filter.involvement === "created" ? "[System.CreatedBy]" : "[System.AssignedTo]";
    const closed = AZURE_CLOSED_STATES.map(wiqlString).join(", ");
    const where = [`${who} = @me`];
    if (filter.state === "open") where.push(`[System.State] NOT IN (${closed})`);
    if (filter.state === "closed") where.push(`[System.State] IN (${closed})`);
    if (filter.q?.trim()) where.push(`[System.Title] CONTAINS ${wiqlString(filter.q.trim())}`);

    const ids = await wiql(
      creds,
      base,
      `SELECT [System.Id] FROM WorkItems WHERE ${where.join(" AND ")} ORDER BY [System.ChangedDate] DESC`,
      WIQL_TOP,
    );
    const pageIds = ids.slice(offset, offset + PER_PAGE);
    const items = (await batch(creds, pageIds)).map((w) => mapAzureItem(base, w));
    const next = offset + PER_PAGE;
    return {
      items,
      nextCursor: next < ids.length ? String(next) : null,
      // Limitado a WIQL_TOP: acima disso o total é "pelo menos".
      total: ids.length,
    };
  },

  async getItem(creds, ref) {
    const { container, id } = splitRef(ref);
    return getDetail(creds, container, id);
  },

  async createItem(creds, input) {
    const base = orgBase(creds);
    const type = await defaultType(creds, input.containerId);
    const w = await call<AzWorkItem>(
      creds,
      "POST",
      `${base}/${encodeURIComponent(input.containerId)}/_apis/wit/workitems/$${encodeURIComponent(type)}?${API}`,
      patchOps({ title: input.title, body: input.body, labels: input.labels }),
      "application/json-patch+json",
    );
    return mapAzureItem(base, w);
  },

  async updateItem(creds, ref, input) {
    const { container, id } = splitRef(ref);
    const ops = patchOps(input);
    if (ops.length > 0) {
      await call<AzWorkItem>(
        creds,
        "PATCH",
        `${orgBase(creds)}/_apis/wit/workitems/${id}?${API}`,
        ops,
        "application/json-patch+json",
      );
    }
    return getDetail(creds, container, id);
  },

  async listComments(creds, ref): Promise<WorkComment[]> {
    const { container, id } = splitRef(ref);
    const res = await call<{
      comments: { id: number; text: string; createdBy: Identity; createdDate: string }[];
    }>(
      creds,
      "GET",
      `${orgBase(creds)}/${encodeURIComponent(container)}/_apis/wit/workItems/${id}/comments?${COMMENTS_API}&order=asc&$top=200`,
    );
    return res.comments.map((c) => ({
      id: String(c.id),
      author: identity(c.createdBy),
      body: htmlToText(c.text),
      createdAt: c.createdDate,
    }));
  },

  async addComment(creds, ref, body): Promise<WorkComment> {
    const { container, id } = splitRef(ref);
    const c = await call<{ id: number; text: string; createdBy: Identity; createdDate: string }>(
      creds,
      "POST",
      `${orgBase(creds)}/${encodeURIComponent(container)}/_apis/wit/workItems/${id}/comments?${COMMENTS_API}`,
      { text: textToHtml(body) },
    );
    return {
      id: String(c.id),
      author: identity(c.createdBy),
      body: htmlToText(c.text),
      createdAt: c.createdDate,
    };
  },

  listContainers: listProjects,

  async listLabels(creds, containerId): Promise<WorkLabel[]> {
    const res = await call<{ value: { name: string }[] }>(
      creds,
      "GET",
      `${orgBase(creds)}/${encodeURIComponent(containerId)}/_apis/wit/tags?${TAGS_API}`,
    );
    return res.value
      .map((t) => ({ name: t.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async listBoards(creds): Promise<BoardSummary[]> {
    const base = orgBase(creds);
    const projects = (await listProjects(creds)).slice(0, MAX_BOARD_PROJECTS);
    const perProject = await Promise.all(
      projects.map(async (p) => {
        try {
          const proj = await call<{ defaultTeam?: { name: string } }>(
            creds,
            "GET",
            `${base}/_apis/projects/${encodeURIComponent(p.name)}?${API}`,
          );
          const team = proj.defaultTeam?.name;
          if (!team) return [];
          const boards = await call<{ value: { id: string; name: string }[] }>(
            creds,
            "GET",
            `${teamUrl(base, p.name, team)}/_apis/work/boards?${API}`,
          );
          return boards.value.map((b) => ({
            id: `${p.name}/${team}/${b.id}`,
            name: b.name,
            scope: `${p.name} · ${team}`,
            url: `${base}/${encodeURIComponent(p.name)}/_boards/board/t/${encodeURIComponent(team)}/${encodeURIComponent(b.name)}`,
          }));
        } catch {
          return []; // projeto sem acesso a boards: ignora
        }
      }),
    );
    return perProject.flat();
  },

  async getBoard(creds, boardId): Promise<Board> {
    const { project, team, base, board, columnField } = await loadBoard(creds, boardId);

    // Mesmo escopo do board: tipos mapeados nas colunas + área do time.
    const types = Object.keys(board.columns[0]?.stateMappings ?? {});
    const area = await call<{
      field: { referenceName: string };
      values: { value: string; includeChildren: boolean }[];
    }>(creds, "GET", `${teamUrl(base, project, team)}/_apis/work/teamsettings/teamfieldvalues?${API}`);
    const areaCond = area.values
      .map((v) =>
        `[${area.field.referenceName}] ${v.includeChildren ? "UNDER" : "="} ${wiqlString(v.value)}`,
      )
      .join(" OR ");
    const where = [
      `[System.TeamProject] = ${wiqlString(project)}`,
      `[System.State] <> 'Removed'`,
      ...(types.length ? [`[System.WorkItemType] IN (${types.map(wiqlString).join(", ")})`] : []),
      ...(areaCond ? [`(${areaCond})`] : []),
    ];
    const ids = await wiql(
      creds,
      base,
      `SELECT [System.Id] FROM WorkItems WHERE ${where.join(" AND ")} ORDER BY [System.ChangedDate] DESC`,
      BOARD_TOP,
    );
    const items = await batch(creds, ids, [...FIELDS, columnField]);

    const columns: BoardColumn[] = board.columns.map((c) => ({ id: c.name, name: c.name, cards: [] }));
    const byName = new Map(columns.map((c) => [c.name, c]));
    for (const w of items) {
      const col = azureColumnOf(board, columnField, w);
      if (col) byName.get(col)?.cards.push(cardOf(base, w));
    }
    return {
      id: boardId,
      name: `${project} · ${board.name}`,
      url: `${base}/${encodeURIComponent(project)}/_boards/board/t/${encodeURIComponent(team)}/${encodeURIComponent(board.name)}`,
      columns,
    };
  },

  async moveCard(creds, boardId, cardId, toColumnId) {
    const { base, board, columnField } = await loadBoard(creds, boardId);
    const { id } = splitRef(cardId);
    const column = board.columns.find((c) => c.name === toColumnId);
    if (!column) throw new WorkInputError(`Coluna inválida: ${toColumnId}`);
    const [w] = await batch(creds, [Number(id)], ["System.WorkItemType", "System.State"]);
    if (!w) throw new WorkNotFoundError();

    const ops: PatchOp[] = [{ op: "add", path: `/fields/${columnField}`, value: column.name }];
    // A coluna define o estado do tipo (ex.: "Active"); muda junto se diferente.
    const state = column.stateMappings[str(w.fields["System.WorkItemType"])];
    if (state && state !== str(w.fields["System.State"])) {
      ops.push({ op: "add", path: "/fields/System.State", value: state });
    }
    await call<AzWorkItem>(
      creds,
      "PATCH",
      `${base}/_apis/wit/workitems/${id}?${API}`,
      ops,
      "application/json-patch+json",
    );
  },
};
