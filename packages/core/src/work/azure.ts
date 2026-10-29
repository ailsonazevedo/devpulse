import { AuthError, type Credentials } from "../adapters/types.js";
import { WorkInputError, WorkNotFoundError, workErrorFromStatus } from "./errors.js";
import { htmlToText, joinRef, parseNumCursor, splitRef, textToHtml } from "./util.js";
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
  relations?: { rel: string; url: string; attributes?: { name?: string } }[] | null;
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
  return cached(creds, ["states", project, type], TTL.long, async () => {
    const res = await call<{ value: { name: string; category: string }[] }>(
      creds,
      "GET",
      `${orgBase(creds)}/${encodeURIComponent(project)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/states?${API}`,
    );
    return res.value.map((v) => ({ name: v.name, category: v.category }));
  });
}

/* ─── Campos ────────────────────────────────────────────────────────── */

/**
 * Campos de processo exibidos (na ordem), se o tipo os tiver. Além destes,
 * entram os `Custom.*` do tipo. Identidades e HTML ficam de fora.
 */
const KNOWN_FIELDS = [
  "Microsoft.VSTS.Common.Priority",
  "Microsoft.VSTS.Common.Severity",
  "Microsoft.VSTS.Scheduling.Effort",
  "Microsoft.VSTS.Scheduling.StoryPoints",
  "Microsoft.VSTS.Scheduling.Size",
  "Microsoft.VSTS.Scheduling.OriginalEstimate",
  "Microsoft.VSTS.Scheduling.RemainingWork",
  "Microsoft.VSTS.Scheduling.CompletedWork",
  "Microsoft.VSTS.Common.Activity",
  "Microsoft.VSTS.Common.ValueArea",
  "Microsoft.VSTS.Common.Risk",
  "Microsoft.VSTS.Common.BusinessValue",
  "Microsoft.VSTS.Common.TimeCriticality",
  "Microsoft.VSTS.Scheduling.StartDate",
  "Microsoft.VSTS.Scheduling.TargetDate",
  "Microsoft.VSTS.Scheduling.DueDate",
  "System.IterationPath",
  "System.AreaPath",
];

/** Rótulos em português dos campos mais comuns (os demais usam o nome do Azure). */
const FIELD_LABELS: Record<string, string> = {
  "Microsoft.VSTS.Common.Priority": "Prioridade",
  "Microsoft.VSTS.Common.Severity": "Severidade",
  "Microsoft.VSTS.Scheduling.Effort": "Esforço",
  "Microsoft.VSTS.Scheduling.StoryPoints": "Story points",
  "Microsoft.VSTS.Scheduling.Size": "Tamanho",
  "Microsoft.VSTS.Scheduling.OriginalEstimate": "Estimativa original (h)",
  "Microsoft.VSTS.Scheduling.RemainingWork": "Trabalho restante (h)",
  "Microsoft.VSTS.Scheduling.CompletedWork": "Trabalho concluído (h)",
  "Microsoft.VSTS.Common.Activity": "Atividade",
  "Microsoft.VSTS.Common.ValueArea": "Área de valor",
  "Microsoft.VSTS.Common.Risk": "Risco",
  "Microsoft.VSTS.Scheduling.StartDate": "Início",
  "Microsoft.VSTS.Scheduling.TargetDate": "Data alvo",
  "Microsoft.VSTS.Scheduling.DueDate": "Entrega",
  "System.IterationPath": "Iteração",
  "System.AreaPath": "Área",
};

interface AzTypeField {
  referenceName: string;
  name: string;
  alwaysRequired?: boolean;
  allowedValues?: string[];
}

interface AzFieldDef {
  referenceName: string;
  name: string;
  type: string;
  readOnly?: boolean;
}

interface AzNode {
  name: string;
  children?: AzNode[];
}

/** Árvore de Iterations/Areas → caminhos no formato do campo (`Projeto\\Sprint 1`). */
export function flattenNodes(root: AzNode, prefix = ""): string[] {
  const path = prefix ? `${prefix}\\${root.name}` : root.name;
  return [path, ...(root.children ?? []).flatMap((c) => flattenNodes(c, path))];
}

/** Monta os campos editáveis do tipo; `values` são os campos atuais do item. */
export function buildAzureFields(
  typeFields: AzTypeField[],
  defs: Map<string, AzFieldDef>,
  paths: { iterations: string[]; areas: string[] },
  values: Record<string, unknown>,
): WorkField[] {
  const byRef = new Map(typeFields.map((f) => [f.referenceName, f]));
  const refs = [
    ...KNOWN_FIELDS.filter((r) => byRef.has(r)),
    ...typeFields.map((f) => f.referenceName).filter((r) => r.startsWith("Custom.")),
  ];
  const out: WorkField[] = [];
  for (const ref of refs) {
    const tf = byRef.get(ref)!;
    const def = defs.get(ref);
    const kind = def?.type ?? (ref.endsWith("Path") ? "treePath" : "string");
    if (def?.readOnly) continue;
    const name = FIELD_LABELS[ref] ?? tf.name;
    const raw = values[ref];
    const base = { id: ref, name, required: !!tf.alwaysRequired };
    const allowed = tf.allowedValues ?? [];
    if (kind === "treePath") {
      const opts = ref === "System.IterationPath" ? paths.iterations : paths.areas;
      if (opts.length === 0) continue;
      out.push({
        ...base,
        type: "single_select",
        options: opts.map((p) => ({ id: p, name: p })),
        value: typeof raw === "string" ? raw : null,
      });
    } else if (allowed.length > 0) {
      out.push({
        ...base,
        type: "single_select",
        options: allowed.map((v) => ({ id: v, name: v })),
        value: raw === undefined || raw === null || raw === "" ? null : String(raw),
      });
    } else if (kind === "boolean") {
      out.push({
        ...base,
        type: "single_select",
        options: [
          { id: "true", name: "Sim" },
          { id: "false", name: "Não" },
        ],
        value: typeof raw === "boolean" ? String(raw) : null,
      });
    } else if (kind === "integer" || kind === "double") {
      out.push({ ...base, type: "number", value: typeof raw === "number" ? raw : null });
    } else if (kind === "dateTime") {
      out.push({ ...base, type: "date", value: typeof raw === "string" ? raw.slice(0, 10) : null });
    } else if (kind === "string" || kind === "plainText") {
      out.push({ ...base, type: "text", value: typeof raw === "string" ? raw : null });
    }
  }
  return out;
}

/** Valor do campo convertido para o tipo do Azure (allowedValues chegam como texto). */
function coerce(def: AzFieldDef | undefined, value: WorkFieldValue): unknown {
  if (value === null || value === "") return null;
  if (def?.type === "integer" || def?.type === "double") {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new WorkInputError(`Número inválido em ${def.name}: ${value}`);
    return n;
  }
  if (def?.type === "boolean") return value === "true";
  return value;
}

async function fieldDefs(creds: Credentials, project: string): Promise<Map<string, AzFieldDef>> {
  const list = await cached(creds, ["field-defs", project], TTL.long, async () => {
    const res = await call<{ value: AzFieldDef[] }>(
      creds,
      "GET",
      `${orgBase(creds)}/${encodeURIComponent(project)}/_apis/wit/fields?${API}`,
    );
    return res.value.map((f) => ({
      referenceName: f.referenceName,
      name: f.name,
      type: f.type,
      readOnly: f.readOnly,
    }));
  });
  return new Map(list.map((f) => [f.referenceName, f]));
}

async function typeFields(creds: Credentials, project: string, type: string) {
  return cached(creds, ["type-fields", project, type], TTL.long, async () => {
    const res = await call<{ value: AzTypeField[] }>(
      creds,
      "GET",
      `${orgBase(creds)}/${encodeURIComponent(project)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/fields?$expand=allowedValues&${API}`,
    );
    return res.value.map((f) => ({
      referenceName: f.referenceName,
      name: f.name,
      alwaysRequired: f.alwaysRequired,
      allowedValues: f.allowedValues,
    }));
  });
}

async function classificationPaths(creds: Credentials, project: string) {
  return cached(creds, ["paths", project], TTL.medium, () => loadPaths(creds, project));
}

async function loadPaths(creds: Credentials, project: string) {
  const get = (group: "Iterations" | "Areas") =>
    call<AzNode>(
      creds,
      "GET",
      `${orgBase(creds)}/${encodeURIComponent(project)}/_apis/wit/classificationnodes/${group}?$depth=10&${API}`,
    )
      .then(flattenNodes)
      .catch(() => [] as string[]);
  const [iterations, areas] = await Promise.all([get("Iterations"), get("Areas")]);
  return { iterations, areas };
}

async function workItemTypes(creds: Credentials, project: string): Promise<string[]> {
  return cached(creds, ["types", project], TTL.long, async () => {
    const res = await call<{ value: { name: string; isDisabled?: boolean }[] }>(
      creds,
      "GET",
      `${orgBase(creds)}/${encodeURIComponent(project)}/_apis/wit/workitemtypes?${API}`,
    );
    return res.value.filter((t) => !t.isDisabled).map((t) => t.name);
  });
}

/** Tipos fora da criação manual (gerenciados pelo próprio Azure). */
const HIDDEN_TYPES = new Set([
  "Test Plan",
  "Test Suite",
  "Test Case",
  "Shared Steps",
  "Shared Parameter",
  "Code Review Request",
  "Code Review Response",
  "Feedback Request",
  "Feedback Response",
]);

/** Campos do tipo + o próprio tipo (id "type") como primeiro campo. */
async function fieldsFor(
  creds: Credentials,
  project: string,
  type: string,
  values: Record<string, unknown>,
  allowedTypes?: string[],
): Promise<WorkField[]> {
  const [types, tf, defs, paths] = await Promise.all([
    allowedTypes ? Promise.resolve(allowedTypes) : workItemTypes(creds, project),
    typeFields(creds, project, type),
    fieldDefs(creds, project),
    classificationPaths(creds, project),
  ]);
  const options = types.filter((t) => !HIDDEN_TYPES.has(t));
  if (!options.includes(type)) options.unshift(type);
  return [
    {
      id: "type",
      name: "Tipo",
      type: "single_select",
      options: options.map((t) => ({ id: t, name: t })),
      value: type,
      required: true,
    },
    ...buildAzureFields(tf, defs, paths, values),
  ];
}

interface AzRepo {
  id: string;
  name: string;
  webUrl?: string;
  defaultBranch?: string;
  project?: { id: string };
  isDisabled?: boolean;
}

async function listRepos(creds: Credentials, project: string): Promise<AzRepo[]> {
  return cached(creds, ["repos", project], TTL.medium, async () => {
    const res = await call<{ value: AzRepo[] }>(
      creds,
      "GET",
      `${orgBase(creds)}/${encodeURIComponent(project)}/_apis/git/repositories?${API}`,
    );
    return res.value
      .filter((r) => !r.isDisabled)
      .map((r) => ({
        id: r.id,
        name: r.name,
        webUrl: r.webUrl,
        defaultBranch: r.defaultBranch,
        project: r.project ? { id: r.project.id } : undefined,
      }));
  });
}

/** `vstfs:///Git/Ref/{projeto}%2F{repo}%2FGB{branch}` e `.../PullRequestId/{projeto}%2F{repo}%2F{id}`. */
export function parseArtifactLink(url: string):
  | { kind: "branch"; repoId: string; name: string }
  | { kind: "pull_request"; repoId: string; id: string }
  | null {
  const m = /^vstfs:\/\/\/Git\/(Ref|PullRequestId)\/(.+)$/i.exec(url);
  if (!m) return null;
  const [, type, rest] = m;
  const parts = decodeURIComponent(rest!).split("/");
  const repoId = parts[1];
  const tail = parts.slice(2).join("/");
  if (!repoId || !tail) return null;
  if (type!.toLowerCase() === "ref") {
    return tail.startsWith("GB") ? { kind: "branch", repoId, name: tail.slice(2) } : null;
  }
  return { kind: "pull_request", repoId, id: tail };
}

function linksOf(w: AzWorkItem, repos: AzRepo[]): WorkLink[] {
  const byId = new Map(repos.map((r) => [r.id.toLowerCase(), r]));
  const out: WorkLink[] = [];
  for (const rel of w.relations ?? []) {
    if (rel.rel !== "ArtifactLink") continue;
    const a = parseArtifactLink(rel.url);
    if (!a) continue;
    const repo = byId.get(a.repoId.toLowerCase());
    if (a.kind === "branch") {
      out.push({
        kind: "branch",
        name: repo ? `${a.name} (${repo.name})` : a.name,
        url: repo?.webUrl ? `${repo.webUrl}?version=GB${encodeURIComponent(a.name)}` : null,
      });
    } else {
      out.push({
        kind: "pull_request",
        name: `PR ${a.id}${repo ? ` (${repo.name})` : ""}`,
        url: repo?.webUrl ? `${repo.webUrl}/pullrequest/${a.id}` : null,
      });
    }
  }
  return out;
}

async function getDetail(creds: Credentials, project: string, id: string): Promise<WorkItemDetail> {
  const base = orgBase(creds);
  const w = await call<AzWorkItem>(
    creds,
    "GET",
    `${base}/_apis/wit/workitems/${id}?$expand=relations&${API}`,
  );
  const item = mapAzureItem(base, w);
  const [states, fields, repos] = await Promise.all([
    stateCategories(creds, project, item.kind).catch(() => []),
    fieldsFor(creds, project, item.kind, w.fields).catch(() => [] as WorkField[]),
    listRepos(creds, project).catch(() => [] as AzRepo[]),
  ]);
  const cat = states.find((s) => s.name === item.rawState)?.category;
  return {
    ...item,
    state: cat ? (["Completed", "Removed", "Resolved"].includes(cat) ? "closed" : "open") : item.state,
    body: htmlToText(str(w.fields["System.Description"])),
    availableStates: states.length ? states.map((s) => s.name) : [item.rawState],
    fields,
    links: linksOf(w, repos),
    branchRepositories: repos.map((r) => ({ id: r.id, name: r.name, url: r.webUrl ?? null })),
  };
}

type PatchOp =
  | { op: "add" | "replace"; path: string; value: unknown }
  | { op: "remove"; path: string };

function patchOps(
  input: {
    title?: string;
    body?: string;
    state?: string;
    labels?: string[];
    assignees?: string[];
    fields?: Record<string, WorkFieldValue>;
  },
  defs?: Map<string, AzFieldDef>,
): PatchOp[] {
  const ops: PatchOp[] = [];
  const set = (field: string, value: unknown) =>
    ops.push({ op: "add", path: `/fields/${field}`, value });
  if (input.title !== undefined) set("System.Title", input.title);
  if (input.body !== undefined) set("System.Description", textToHtml(input.body));
  if (input.state !== undefined) set("System.State", input.state);
  if (input.labels !== undefined) set("System.Tags", input.labels.join("; "));
  // Azure só tem 1 responsável; "" remove.
  if (input.assignees !== undefined) set("System.AssignedTo", input.assignees[0] ?? "");
  for (const [ref, value] of Object.entries(input.fields ?? {})) {
    if (ref === "type") {
      if (value) set("System.WorkItemType", String(value));
      continue;
    }
    if (!/^[\w.]+$/.test(ref)) throw new WorkInputError(`Campo inválido: ${ref}`);
    const v = coerce(defs?.get(ref), value);
    if (v === null) ops.push({ op: "remove", path: `/fields/${ref}` });
    else set(ref, v);
  }
  return ops;
}

const hasFields = (f: Record<string, WorkFieldValue> | undefined) =>
  Object.keys(f ?? {}).some((k) => k !== "type");

/** Tipo usado na criação: o primeiro disponível na ordem de preferência. */
const CREATE_TYPES = ["Issue", "User Story", "Product Backlog Item", "Requirement", "Task"];

async function defaultType(creds: Credentials, project: string, allowed?: string[]): Promise<string> {
  const names = new Set(allowed ?? (await workItemTypes(creds, project)));
  const pick = CREATE_TYPES.find((t) => names.has(t)) ?? [...names][0];
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
  // configuração (colunas/mapeamentos); os cards são sempre ao vivo
  const board = await cached(creds, ["board", boardId], TTL.short, async () => {
    const b = await call<AzBoard>(
      creds,
      "GET",
      `${teamUrl(base, project, team)}/_apis/work/boards/${encodeURIComponent(id)}?${API}`,
    );
    return {
      id: b.id,
      name: b.name,
      columns: b.columns.map((c) => ({
        id: c.id,
        name: c.name,
        columnType: c.columnType,
        stateMappings: c.stateMappings,
      })),
      fields: { columnField: { referenceName: b.fields?.columnField?.referenceName } },
    } satisfies AzBoard;
  });
  const columnField = board.fields?.columnField?.referenceName;
  if (!columnField) throw new WorkInputError("Board sem campo de coluna configurado");
  return { project, team, base, board, columnField };
}

/** Área padrão do time (onde itens criados pelo board precisam estar). */
async function teamArea(creds: Credentials, project: string, team: string): Promise<string | null> {
  const res = await teamFieldValues(creds, project, team).catch(() => null);
  return res?.defaultValue ?? null;
}

/** Áreas do time (escopo do board e área padrão de itens novos). */
function teamFieldValues(creds: Credentials, project: string, team: string) {
  return cached(creds, ["team-fields", project, team], TTL.long, () =>
    call<{
      defaultValue?: string;
      field: { referenceName: string };
      values: { value: string; includeChildren: boolean }[];
    }>(
      creds,
      "GET",
      `${teamUrl(orgBase(creds), project, team)}/_apis/work/teamsettings/teamfieldvalues?${API}`,
    ),
  );
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
  return cached(creds, ["projects"], TTL.short, () => loadProjects(creds));
}

async function loadProjects(creds: Credentials): Promise<WorkContainer[]> {
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
    const fields = { ...input.fields };
    let boardTypes: string[] | undefined;
    if (input.boardId) {
      const { project, team, board } = await loadBoard(creds, input.boardId);
      if (project !== input.containerId) {
        throw new WorkInputError("O board pertence a outro projeto");
      }
      boardTypes = Object.keys(board.columns[0]?.stateMappings ?? {});
      // Área padrão do time do board (senão o item não aparece nele).
      if (!fields["System.AreaPath"]) {
        const area = await teamArea(creds, project, team);
        if (area) fields["System.AreaPath"] = area;
      }
    }
    const type = fields.type ? String(fields.type) : await defaultType(creds, input.containerId, boardTypes);
    delete fields.type;
    const defs = hasFields(fields) ? await fieldDefs(creds, input.containerId) : undefined;
    const w = await call<AzWorkItem>(
      creds,
      "POST",
      `${base}/${encodeURIComponent(input.containerId)}/_apis/wit/workitems/$${encodeURIComponent(type)}?${API}`,
      patchOps(
        {
          title: input.title,
          body: input.body,
          labels: input.labels,
          assignees: input.assignees?.length ? input.assignees : undefined,
          fields,
        },
        defs,
      ).filter((op) => op.op !== "remove"),
      "application/json-patch+json",
    );
    const item = mapAzureItem(base, w);
    // tags novas passam a existir no projeto
    if (input.labels?.length) await invalidate(creds, ["labels", input.containerId]);
    if (input.boardId && input.columnId) {
      await azureWork.moveCard(creds, input.boardId, item.ref, input.columnId);
    }
    return item;
  },

  async updateItem(creds, ref, input) {
    const { container, id } = splitRef(ref);
    const defs = hasFields(input.fields) ? await fieldDefs(creds, container) : undefined;
    const ops = patchOps(input, defs);
    if (ops.length > 0) {
      await call<AzWorkItem>(
        creds,
        "PATCH",
        `${orgBase(creds)}/_apis/wit/workitems/${id}?${API}`,
        ops,
        "application/json-patch+json",
      );
    }
    if (input.labels?.length) await invalidate(creds, ["labels", container]);
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
    return cached(creds, ["labels", containerId], TTL.short, async () => {
      const res = await call<{ value: { name: string }[] }>(
        creds,
        "GET",
        `${orgBase(creds)}/${encodeURIComponent(containerId)}/_apis/wit/tags?${TAGS_API}`,
      );
      return res.value
        .map((t) => ({ name: t.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    });
  },

  async listAssignees(creds, containerId): Promise<WorkUser[]> {
    return cached(creds, ["assignees", containerId], TTL.medium, () =>
      loadAssignees(creds, containerId),
    );
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
    return getBoard(creds, boardId);
  },

  async moveCard(creds, boardId, cardId, toColumnId) {
    return moveCard(creds, boardId, cardId, toColumnId);
  },
};

async function loadAssignees(creds: Credentials, containerId: string): Promise<WorkUser[]> {
  const base = orgBase(creds);
  const p = encodeURIComponent(containerId);
  const teams = await call<{ value: { id: string }[] }>(
    creds,
    "GET",
    `${base}/_apis/projects/${p}/teams?$top=20&${API}`,
  );
  const members = await Promise.all(
    teams.value.slice(0, 10).map((t) =>
      call<{ value: { identity: Identity & { isContainer?: boolean } }[] }>(
        creds,
        "GET",
        `${base}/_apis/projects/${p}/teams/${t.id}/members?$top=500&${API}`,
      )
        .then((r) => r.value)
        .catch(() => []),
    ),
  );
  const seen = new Map<string, WorkUser>();
  for (const m of members.flat()) {
    if (m.identity.isContainer) continue; // grupos
    const u = identity(m.identity);
    if (u && !seen.has(u.login.toLowerCase())) seen.set(u.login.toLowerCase(), u);
  }
  return [...seen.values()].sort((a, b) => (a.name ?? a.login).localeCompare(b.name ?? b.login));
}

async function createFields(creds: Credentials, query: CreateFieldsQuery): Promise<CreateFields> {
  let project = query.containerId;
  let container: WorkContainer | null = null;
  let boardTypes: string[] | undefined;
  let area: string | null = null;
  if (query.boardId) {
    const b = await loadBoard(creds, query.boardId);
    project = b.project;
    container = { id: b.project, name: b.project, url: `${b.base}/${encodeURIComponent(b.project)}` };
    boardTypes = Object.keys(b.board.columns[0]?.stateMappings ?? {});
    area = await teamArea(creds, b.project, b.team);
  }
  if (!project) return { fields: [], container };
  const type = query.type || (await defaultType(creds, project, boardTypes));
  const fields = await fieldsFor(
    creds,
    project,
    type,
    area ? { "System.AreaPath": area } : {},
    boardTypes,
  );
  return { fields, container };
}

async function createBranch(
  creds: Credentials,
  ref: string,
  input: CreateBranchInput,
): Promise<WorkLink> {
  const { container, id } = splitRef(ref);
  const base = orgBase(creds);
  const repos = await listRepos(creds, container);
  const repo = input.repositoryId
    ? repos.find((r) => r.id === input.repositoryId)
    : (repos.find((r) => r.name === container) ?? repos[0]);
  if (!repo) throw new WorkInputError("Nenhum repositório Git no projeto");
  if (!repo.defaultBranch || !repo.project) {
    throw new WorkInputError(`O repositório ${repo.name} não tem branch principal`);
  }
  const repoUrl = `${base}/${encodeURIComponent(container)}/_apis/git/repositories/${repo.id}`;
  const head = await call<{ value: { objectId: string }[] }>(
    creds,
    "GET",
    `${repoUrl}/refs?filter=${encodeURIComponent(repo.defaultBranch.replace(/^refs\//, ""))}&${API}`,
  );
  const sha = head.value[0]?.objectId;
  if (!sha) throw new WorkInputError("Branch principal não encontrada");
  const res = await call<{ value: { success: boolean; customMessage?: string; updateStatus?: string }[] }>(
    creds,
    "POST",
    `${repoUrl}/refs?${API}`,
    [{ name: `refs/heads/${input.name}`, oldObjectId: "0".repeat(40), newObjectId: sha }],
  );
  const r = res.value[0];
  if (!r?.success) {
    throw new WorkInputError(
      `Não foi possível criar a branch: ${r?.customMessage ?? r?.updateStatus ?? "erro"}`,
    );
  }
  // Vínculo "Branch" no work item (aparece em Development).
  const artifact = `vstfs:///Git/Ref/${encodeURIComponent(`${repo.project.id}/${repo.id}/GB${input.name}`)}`;
  await call(
    creds,
    "PATCH",
    `${base}/_apis/wit/workitems/${id}?${API}`,
    [
      {
        op: "add",
        path: "/relations/-",
        value: { rel: "ArtifactLink", url: artifact, attributes: { name: "Branch" } },
      },
    ],
    "application/json-patch+json",
  );
  return {
    kind: "branch",
    name: input.name,
    url: repo.webUrl ? `${repo.webUrl}?version=GB${encodeURIComponent(input.name)}` : null,
  };
}

async function loadBoards(creds: Credentials): Promise<BoardSummary[]> {
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
}

async function getBoard(creds: Credentials, boardId: string): Promise<Board> {
  const { project, team, base, board, columnField } = await loadBoard(creds, boardId);

  // Mesmo escopo do board: tipos mapeados nas colunas + área do time.
  const types = Object.keys(board.columns[0]?.stateMappings ?? {});
  const area = await teamFieldValues(creds, project, team);
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
}

async function moveCard(
  creds: Credentials,
  boardId: string,
  cardId: string,
  toColumnId: string,
): Promise<void> {
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
}
