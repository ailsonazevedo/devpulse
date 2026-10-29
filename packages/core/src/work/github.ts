import { Octokit } from "octokit";
import type { Credentials } from "../adapters/types.js";
import {
  ScopeError,
  WorkInputError,
  WorkNotFoundError,
  workErrorFromStatus,
} from "./errors.js";
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
  CreateFields,
  WorkContainer,
  WorkField,
  WorkFieldOption,
  WorkFieldValue,
  WorkItem,
  WorkItemDetail,
  WorkLabel,
  WorkLink,
  WorkUser,
} from "./types.js";

const PER_PAGE = 30;
/** A Search API só devolve os primeiros 1000 resultados. */
const SEARCH_CAP = 1000;
/** Itens de um Project v2 buscados por board (fallback paginado). */
const MAX_BOARD_ITEMS = 500;
/**
 * Página de itens de Project: acima de ~50 o GraphQL do GitHub fica lento de
 * forma não linear (100 itens ≈ 14s, perto do timeout de 10s do servidor).
 */
const BOARD_PAGE = 50;
/** Cards carregados por coluna (o total real vem em `BoardColumn.total`). */
const COLUMN_LIMIT = 50;
/** Coluna dos cards sem valor no campo Status. */
const NO_STATUS = "__none";

/**
 * Cliente para uso interativo: sem o throttling do octokit (que enfileira todo
 * GraphQL do processo a 1 req/s, como se fosse escrita) e sem retry automático
 * (que repete timeouts com espera e pode resolver `undefined`). Limites e
 * timeouts viram erros de domínio em `asWorkError`.
 */
function makeClient(creds: Credentials): Octokit {
  return new Octokit({
    auth: creds.accessToken,
    throttle: { enabled: false },
    retry: { enabled: false },
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
    if (/Something went wrong while executing your query/i.test(first.message ?? "")) {
      return new Error("GitHub: a consulta demorou demais (timeout), tente de novo");
    }
    return new Error(`GitHub: ${first.message ?? "erro GraphQL"}`);
  }
  if (typeof e.status === "number") {
    return workErrorFromStatus("GitHub", e.status, e.message);
  }
  return err;
}

async function gh<T>(fn: () => Promise<T>): Promise<T> {
  let res: T;
  try {
    res = await fn();
  } catch (err) {
    throw asWorkError(err);
  }
  if (res === undefined || res === null) {
    throw new Error("GitHub: sem resposta (tempo esgotado), tente de novo");
  }
  return res;
}

interface GhUser {
  login: string;
  avatar_url?: string | null;
  name?: string | null;
}

export interface GhIssue {
  number: number;
  node_id?: string;
  milestone?: { number: number; title: string } | null;
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

/* ─── Campos (tipo, milestone, Projects v2) ────────────────────────── */

/** Cores nomeadas do GitHub (opções de Project e Issue Types) → hex. */
const GH_COLORS: Record<string, string> = {
  GRAY: "#6e7781",
  BLUE: "#0969da",
  GREEN: "#1a7f37",
  YELLOW: "#9a6700",
  ORANGE: "#bc4c00",
  RED: "#cf222e",
  PINK: "#bf3989",
  PURPLE: "#8250df",
};

const ghColor = (c?: string | null) => (c ? (GH_COLORS[c] ?? null) : null);

/** Tipos de campo de Project editáveis aqui e a letra usada no id. */
const KIND_OF: Record<string, "s" | "n" | "t" | "d" | "i"> = {
  SINGLE_SELECT: "s",
  NUMBER: "n",
  TEXT: "t",
  DATE: "d",
  ITERATION: "i",
};

export interface GqlProjectField {
  id?: string;
  name?: string;
  dataType?: string;
  options?: { id: string; name: string; color?: string; description?: string }[];
  configuration?: { iterations: { id: string; title: string; startDate: string }[] };
}

export interface GqlFieldValue {
  optionId?: string | null;
  number?: number | null;
  text?: string | null;
  date?: string | null;
  iterationId?: string | null;
  field?: { id?: string } | null;
}

const PROJECT_FIELDS = /* GraphQL */ `
  fields(first: 50) {
    nodes {
      ... on ProjectV2Field { id name dataType }
      ... on ProjectV2SingleSelectField { id name dataType options { id name color description } }
      ... on ProjectV2IterationField {
        id name dataType
        configuration { iterations { id title startDate } }
      }
    }
  }
`;

/** `pf:<projectId>:<fieldId>:<kind>` — o kind evita reconsultar o tipo ao salvar. */
export function parseProjectFieldId(id: string) {
  const [tag, projectId, fieldId, kind] = id.split(":");
  if (tag !== "pf" || !projectId || !fieldId || !kind) return null;
  return { projectId, fieldId, kind: kind as "s" | "n" | "t" | "d" | "i" };
}

/** Campos de um Project (exceto Status, que é a coluna do board) com os valores do item. */
export function mapProjectFields(
  project: { id: string; title: string; fields: { nodes: GqlProjectField[] } },
  values: GqlFieldValue[],
  { includeStatus = true } = {},
): WorkField[] {
  const byField = new Map(values.filter((v) => v.field?.id).map((v) => [v.field!.id!, v]));
  const out: WorkField[] = [];
  for (const f of project.fields.nodes) {
    const kind = f.dataType ? KIND_OF[f.dataType] : undefined;
    if (!f.id || !f.name || !kind) continue;
    if (!includeStatus && f.name === "Status" && kind === "s") continue;
    const v = byField.get(f.id);
    const base = { id: `pf:${project.id}:${f.id}:${kind}`, name: f.name, group: project.title };
    if (kind === "s") {
      out.push({
        ...base,
        type: "single_select",
        options: (f.options ?? []).map((o) => ({
          id: o.id,
          name: o.name,
          color: ghColor(o.color),
          description: o.description || null,
        })),
        value: v?.optionId ?? null,
      });
    } else if (kind === "i") {
      out.push({
        ...base,
        type: "single_select",
        options: (f.configuration?.iterations ?? []).map((it) => ({
          id: it.id,
          name: it.title,
          description: it.startDate,
        })),
        value: v?.iterationId ?? null,
      });
    } else if (kind === "n") {
      out.push({ ...base, type: "number", value: v?.number ?? null });
    } else if (kind === "t") {
      out.push({ ...base, type: "text", value: v?.text ?? null });
    } else {
      out.push({ ...base, type: "date", value: v?.date ?? null });
    }
  }
  return out;
}

interface GqlRepoMeta {
  id: string;
  issueTypes?: { nodes: { id: string; name: string; color?: string; description?: string }[] } | null;
  milestones: { nodes: { number: number; title: string; dueOn?: string | null }[] };
}

const REPO_META = (withTypes: boolean) => /* GraphQL */ `
  id
  ${withTypes ? "issueTypes(first: 25) { nodes { id name color description } }" : ""}
  milestones(first: 50, states: OPEN, orderBy: { field: DUE_DATE, direction: ASC }) {
    nodes { number title dueOn }
  }
`;

function baseFields(
  meta: GqlRepoMeta,
  current: { typeId?: string | null; milestone?: number | null },
): WorkField[] {
  const out: WorkField[] = [];
  const types = meta.issueTypes?.nodes ?? [];
  if (types.length > 0) {
    out.push({
      id: "type",
      name: "Tipo",
      type: "single_select",
      options: types.map((t) => ({
        id: t.id,
        name: t.name,
        color: ghColor(t.color),
        description: t.description || null,
      })),
      value: current.typeId ?? null,
    });
  }
  const milestones: WorkFieldOption[] = meta.milestones.nodes.map((m) => ({
    id: String(m.number),
    name: m.title,
    description: m.dueOn ? m.dueOn.slice(0, 10) : null,
  }));
  // milestone fechado ainda aparece como valor atual
  if (current.milestone && !milestones.some((m) => m.id === String(current.milestone))) {
    milestones.push({ id: String(current.milestone), name: `#${current.milestone}` });
  }
  out.push({
    id: "milestone",
    name: "Milestone",
    type: "single_select",
    options: milestones,
    value: current.milestone ? String(current.milestone) : null,
  });
  return out;
}

interface GqlIssueExtras {
  repository: (GqlRepoMeta & {
    issue: {
      id: string;
      issueType?: { id: string } | null;
      linkedBranches?: { nodes: { ref: { name: string } | null }[] };
      closedByPullRequestsReferences?: {
        nodes: { number: number; title: string; url: string; state: string }[];
      };
      projectItems: {
        nodes: {
          id: string;
          isArchived?: boolean;
          project: { id: string; title: string; closed?: boolean; fields: { nodes: GqlProjectField[] } };
          fieldValues: { nodes: GqlFieldValue[] };
        }[];
      };
    } | null;
  }) | null;
}

const ISSUE_EXTRAS = (modern: boolean) => /* GraphQL */ `
  query ($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      ${REPO_META(modern)}
      issue(number: $number) {
        id
        ${
          modern
            ? `issueType { id }
        linkedBranches(first: 10) { nodes { ref { name } } }
        closedByPullRequestsReferences(first: 10, includeClosedPrs: true) {
          nodes { number title url state }
        }`
            : ""
        }
        projectItems(first: 10) {
          nodes {
            id
            isArchived
            project { id title closed ${PROJECT_FIELDS} }
            fieldValues(first: 50) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue { optionId field { ... on ProjectV2FieldCommon { id } } }
                ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { id } } }
                ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { id } } }
                ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { id } } }
                ... on ProjectV2ItemFieldIterationValue { iterationId field { ... on ProjectV2FieldCommon { id } } }
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * GraphQL com fallback: GHES antigo não conhece Issue Types/linkedBranches —
 * refaz sem eles. Dados parciais (ex.: Project de org sem acesso) são aceitos.
 */
async function gqlModern<T>(
  api: Octokit,
  query: (modern: boolean) => string,
  vars: Record<string, unknown>,
): Promise<{ data: T; modern: boolean }> {
  for (const modern of [true, false]) {
    try {
      return { data: await api.graphql<T>(query(modern), vars), modern };
    } catch (err) {
      const e = err as { data?: T; errors?: { type?: string; message?: string }[] };
      const unknownField = e.errors?.some(
        (x) => x.type === "undefinedField" || /doesn't exist on type|undefinedField/i.test(x.message ?? ""),
      );
      if (modern && unknownField) continue;
      if (e.data && (e.data as { repository?: unknown }).repository) {
        return { data: e.data, modern };
      }
      throw asWorkError(err);
    }
  }
  throw new Error("GitHub: consulta GraphQL falhou");
}

async function detail(api: Octokit, container: string, i: GhIssue): Promise<WorkItemDetail> {
  const base = mapGithubIssue(i);
  const { owner, repo } = ownerRepo(container);
  const { data } = await gqlModern<GqlIssueExtras>(api, ISSUE_EXTRAS, {
    owner,
    name: repo,
    number: i.number,
  });
  const r = data.repository;
  const issue = r?.issue;
  const fields: WorkField[] = r
    ? baseFields(r, { typeId: issue?.issueType?.id, milestone: i.milestone?.number })
    : [];
  for (const item of issue?.projectItems.nodes ?? []) {
    if (!item || item.isArchived || item.project.closed) continue;
    fields.push(...mapProjectFields(item.project, item.fieldValues.nodes));
  }
  const repoUrl = base.container.url ?? "";
  const links: WorkLink[] = [
    ...(issue?.linkedBranches?.nodes ?? [])
      .filter((b) => b.ref)
      .map((b) => ({
        kind: "branch" as const,
        name: b.ref!.name,
        url: `${repoUrl}/tree/${b.ref!.name}`,
      })),
    ...(issue?.closedByPullRequestsReferences?.nodes ?? []).map((pr) => ({
      kind: "pull_request" as const,
      name: `#${pr.number} ${pr.title}`,
      url: pr.url,
      state: pr.state.toLowerCase(),
    })),
  ];
  return {
    ...base,
    body: i.body ?? "",
    availableStates: ["open", "closed"],
    fields,
    links,
    branchRepositories: null,
  };
}

/** Grava um valor de campo de Project num item (null limpa). */
async function setProjectField(
  api: Octokit,
  projectId: string,
  itemId: string,
  fieldId: string,
  kind: "s" | "n" | "t" | "d" | "i",
  value: WorkFieldValue,
) {
  if (value === null || value === "") {
    await gh(() =>
      api.graphql(
        `mutation ($p: ID!, $i: ID!, $f: ID!) {
          clearProjectV2ItemFieldValue(input: { projectId: $p, itemId: $i, fieldId: $f }) { clientMutationId }
        }`,
        { p: projectId, i: itemId, f: fieldId },
      ),
    );
    return;
  }
  let v: Record<string, unknown>;
  if (kind === "s") v = { singleSelectOptionId: String(value) };
  else if (kind === "i") v = { iterationId: String(value) };
  else if (kind === "n") {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new WorkInputError(`Número inválido: ${value}`);
    v = { number: n };
  } else if (kind === "d") v = { date: String(value) };
  else v = { text: String(value) };
  await gh(() =>
    api.graphql(
      `mutation ($p: ID!, $i: ID!, $f: ID!, $v: ProjectV2FieldValue!) {
        updateProjectV2ItemFieldValue(input: { projectId: $p, itemId: $i, fieldId: $f, value: $v }) { clientMutationId }
      }`,
      { p: projectId, i: itemId, f: fieldId, v },
    ),
  );
}

async function setIssueType(api: Octokit, issueId: string, typeId: WorkFieldValue) {
  await gh(() =>
    api.graphql(
      `mutation ($i: ID!, $t: ID) {
        updateIssueIssueType(input: { issueId: $i, issueTypeId: $t }) { clientMutationId }
      }`,
      { i: issueId, t: typeId === null || typeId === "" ? null : String(typeId) },
    ),
  );
}

/** Aplica `type` e campos `pf:*` (projectItems resolve o item de cada Project). */
async function applyFields(
  api: Octokit,
  issueNodeId: string,
  fields: Record<string, WorkFieldValue>,
  knownItems: Map<string, string> = new Map(),
) {
  if ("type" in fields) await setIssueType(api, issueNodeId, fields.type ?? null);
  const pf = Object.entries(fields)
    .map(([id, value]) => ({ p: parseProjectFieldId(id), value }))
    .filter((x): x is { p: NonNullable<ReturnType<typeof parseProjectFieldId>>; value: WorkFieldValue } => !!x.p);
  if (pf.length === 0) return;

  const items = new Map(knownItems);
  if (pf.some((x) => !items.has(x.p.projectId))) {
    const res = await gh(() =>
      api.graphql<{
        node: { projectItems: { nodes: { id: string; project: { id: string } }[] } } | null;
      }>(
        `query ($id: ID!) {
          node(id: $id) { ... on Issue { projectItems(first: 20) { nodes { id project { id } } } } }
        }`,
        { id: issueNodeId },
      ),
    );
    for (const n of res.node?.projectItems.nodes ?? []) items.set(n.project.id, n.id);
  }
  for (const { p, value } of pf) {
    const itemId = items.get(p.projectId);
    if (!itemId) throw new WorkInputError("A tarefa não está nesse Project");
    await setProjectField(api, p.projectId, itemId, p.fieldId, p.kind, value);
  }
}

function milestoneOf(fields: Record<string, WorkFieldValue> | undefined): number | null | undefined {
  if (!fields || !("milestone" in fields)) return undefined;
  const v = fields.milestone;
  return v === null || v === "" ? null : Number(v);
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

const BOARD_ITEM = /* GraphQL */ `
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
`;

/** Fallback (GHES sem filtro `query` em items): todos os itens, paginados. */
const BOARD_QUERY = /* GraphQL */ `
  query ($id: ID!, $after: String) {
    node(id: $id) {
      ... on ProjectV2 {
        title
        url
        field(name: "Status") {
          ... on ProjectV2SingleSelectField { id options { id name } }
        }
        items(first: ${BOARD_PAGE}, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { ${BOARD_ITEM} }
        }
      }
    }
  }
`;

const BOARD_META = /* GraphQL */ `
  query ($id: ID!) {
    node(id: $id) {
      ... on ProjectV2 {
        title
        url
        field(name: "Status") {
          ... on ProjectV2SingleSelectField { id options { id name } }
        }
      }
    }
  }
`;

/** Itens de uma coluna, filtrados no servidor (mesma sintaxe da busca do Project). */
const COLUMN_QUERY = /* GraphQL */ `
  query ($id: ID!, $q: String!) {
    node(id: $id) {
      ... on ProjectV2 {
        items(first: ${COLUMN_LIMIT}, query: $q) {
          totalCount
          nodes { ${BOARD_ITEM} }
        }
      }
    }
  }
`;

type BoardNode = NonNullable<GqlBoard["node"]>["items"]["nodes"][number];

/** Filtro de uma coluna: `status:"Nome"` (aspas escapadas) ou `no:status`. */
export function columnQuery(name: string | null): string {
  return name === null ? "no:status" : `status:"${name.replace(/(["\\])/g, "\\$1")}"`;
}

/** Monta as colunas a partir dos itens (fallback sem filtro no servidor). */
function boardFromItems(
  options: { id: string; name: string }[],
  nodes: BoardNode[],
): BoardColumn[] {
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
  return columns;
}

/** `query` em items não existe no GHES antigo. */
function unsupportedQueryArg(err: unknown): boolean {
  const errors = (err as { errors?: { message?: string; type?: string }[] }).errors ?? [];
  return errors.some(
    (e) =>
      e.type === "argumentNotAccepted" ||
      /argument 'query'|doesn't accept argument/i.test(e.message ?? ""),
  );
}

async function pagedBoard(api: Octokit, boardId: string) {
  let after: string | null = null;
  let first: NonNullable<GqlBoard["node"]> | null = null;
  const nodes: BoardNode[] = [];
  do {
    const res: GqlBoard = await gh(() =>
      api.graphql<GqlBoard>(BOARD_QUERY, { id: boardId, after }),
    );
    if (!res.node) throw new WorkNotFoundError("Board não encontrado");
    first ??= res.node;
    nodes.push(...res.node.items.nodes);
    after = res.node.items.pageInfo.hasNextPage ? res.node.items.pageInfo.endCursor : null;
  } while (after && nodes.length < MAX_BOARD_ITEMS);
  return { meta: first!, columns: boardFromItems(first!.field?.options ?? [], nodes) };
}

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

async function statusFieldId(
  creds: Credentials,
  api: Octokit,
  projectId: string,
): Promise<string> {
  return cached(creds, ["status-field", projectId], TTL.long, () => loadStatusFieldId(api, projectId));
}

async function loadStatusFieldId(api: Octokit, projectId: string): Promise<string> {
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
    return detail(api, container, res.data as unknown as GhIssue);
  },

  async createItem(creds, input) {
    const api = makeClient(creds);
    const res = await gh(() =>
      api.rest.issues.create({
        ...ownerRepo(input.containerId),
        title: input.title,
        body: input.body,
        labels: input.labels,
        assignees: input.assignees,
        milestone: milestoneOf(input.fields) ?? undefined,
      }),
    );
    const issue = res.data as unknown as GhIssue;
    // labels inexistentes são criadas pelo GitHub
    if (input.labels?.length) await invalidate(creds, ["labels", input.containerId]);
    const fields = { ...input.fields };
    delete fields.milestone;

    // No board: adiciona ao Project e põe na coluna (campo Status).
    const items = new Map<string, string>();
    if (input.boardId) {
      const added = await gh(() =>
        api.graphql<{ addProjectV2ItemById: { item: { id: string } } }>(
          `mutation ($p: ID!, $c: ID!) {
            addProjectV2ItemById(input: { projectId: $p, contentId: $c }) { item { id } }
          }`,
          { p: input.boardId, c: issue.node_id },
        ),
      );
      const itemId = added.addProjectV2ItemById.item.id;
      items.set(input.boardId, itemId);
      if (input.columnId && input.columnId !== NO_STATUS) {
        const fieldId = await statusFieldId(creds, api, input.boardId);
        await setProjectField(api, input.boardId, itemId, fieldId, "s", input.columnId);
      }
    }
    if (Object.keys(fields).length > 0 && issue.node_id) {
      await applyFields(api, issue.node_id, fields, items);
    }
    return mapGithubIssue(issue);
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
        milestone: milestoneOf(input.fields),
      }),
    );
    const issue = res.data as unknown as GhIssue;
    if (input.labels?.length) await invalidate(creds, ["labels", container]);
    const fields = { ...input.fields };
    delete fields.milestone;
    if (Object.keys(fields).length > 0 && issue.node_id) {
      await applyFields(api, issue.node_id, fields);
    }
    return detail(api, container, issue);
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
    return cached(creds, ["containers"], TTL.short, async () => {
      const api = makeClient(creds);
      const res = await gh(() =>
        api.rest.repos.listForAuthenticatedUser({ sort: "pushed", per_page: 100 }),
      );
      return res.data
        .filter((r) => r.has_issues && !r.archived)
        .map((r) => ({ id: r.full_name, name: r.full_name, url: r.html_url }));
    });
  },

  async listLabels(creds, containerId): Promise<WorkLabel[]> {
    return cached(creds, ["labels", containerId], TTL.short, async () => {
      const api = makeClient(creds);
      const labels = await gh(() =>
        api.paginate(api.rest.issues.listLabelsForRepo, {
          ...ownerRepo(containerId),
          per_page: 100,
        }),
      );
      return labels.map((l) => ({
        name: l.name,
        color: l.color ? `#${l.color}` : null,
        description: l.description ?? null,
      }));
    });
  },

  async listAssignees(creds, containerId): Promise<WorkUser[]> {
    return cached(creds, ["assignees", containerId], TTL.medium, async () => {
      const api = makeClient(creds);
      const users = await gh(() =>
        api.paginate(api.rest.issues.listAssignees, { ...ownerRepo(containerId), per_page: 100 }),
      );
      return users.map((u) => ({ login: u.login, avatarUrl: u.avatar_url ?? null }));
    });
  },

  async getCreateFields(creds, query): Promise<CreateFields> {
    const api = makeClient(creds);
    const fields: WorkField[] = [];
    const containerId = query.containerId;
    const boardId = query.boardId;
    if (containerId) {
      const { owner, repo } = ownerRepo(containerId);
      const meta = await cached(creds, ["repo-meta", containerId], TTL.short, async () => {
        const { data } = await gqlModern<{ repository: GqlRepoMeta | null }>(
          api,
          (modern) => `query ($owner: String!, $name: String!) {
            repository(owner: $owner, name: $name) { ${REPO_META(modern)} }
          }`,
          { owner, name: repo },
        );
        return { repository: data.repository };
      });
      if (meta.repository) fields.push(...baseFields(meta.repository, {}));
    }
    if (boardId) {
      const project = await cached(creds, ["project-fields", boardId], TTL.short, async () => {
        const res = await gh(() =>
          api.graphql<{
            node: { id: string; title: string; fields: { nodes: GqlProjectField[] } } | null;
          }>(
            `query ($id: ID!) { node(id: $id) { ... on ProjectV2 { id title ${PROJECT_FIELDS} } } }`,
            { id: boardId },
          ),
        );
        if (!res.node) throw new WorkNotFoundError("Board não encontrado");
        return res.node;
      });
      // Status vem da coluna escolhida.
      fields.push(...mapProjectFields(project, [], { includeStatus: false }));
    }
    return { fields, container: null };
  },

  async createBranch(creds, ref, input): Promise<WorkLink> {
    const { container, id } = splitRef(ref);
    const { owner, repo } = ownerRepo(container);
    const api = makeClient(creds);
    const res = await gh(() =>
      api.graphql<{
        repository: {
          id: string;
          url: string;
          defaultBranchRef: { target: { oid: string } } | null;
          issue: { id: string } | null;
        } | null;
      }>(
        `query ($owner: String!, $name: String!, $number: Int!) {
          repository(owner: $owner, name: $name) {
            id url
            defaultBranchRef { target { oid } }
            issue(number: $number) { id }
          }
        }`,
        { owner, name: repo, number: Number(id) },
      ),
    );
    const r = res.repository;
    if (!r?.issue) throw new WorkNotFoundError("Issue não encontrada");
    if (!r.defaultBranchRef) throw new WorkInputError("Repositório sem branch principal");
    const vars = { issue: r.issue.id, repo: r.id, oid: r.defaultBranchRef.target.oid, name: input.name };
    const created = await gh(() =>
      api.graphql<{ createLinkedBranch: { linkedBranch: { ref: { name: string } | null } | null } }>(
        `mutation ($issue: ID!, $repo: ID!, $oid: GitObjectID!, $name: String!) {
          createLinkedBranch(input: { issueId: $issue, repositoryId: $repo, oid: $oid, name: $name }) {
            linkedBranch { ref { name } }
          }
        }`,
        vars,
      ),
    );
    const name = created.createLinkedBranch.linkedBranch?.ref?.name ?? input.name;
    return { kind: "branch", name, url: `${r.url}/tree/${name}` };
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

async function loadBoards(creds: Credentials): Promise<BoardSummary[]> {
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
}

async function loadBoard(creds: Credentials, boardId: string): Promise<Board> {
  const api = makeClient(creds);
  // título e colunas mudam raramente; os cards (abaixo) são sempre ao vivo
  const metaRes = await cached(creds, ["board-meta", boardId], TTL.short, () =>
    gh(() =>
      api.graphql<{
        node: {
          title: string;
          url: string;
          field: { id: string; options: { id: string; name: string }[] } | null;
        } | null;
      }>(BOARD_META, { id: boardId }),
    ),
  );
  const meta = metaRes.node;
  if (!meta) throw new WorkNotFoundError("Board não encontrado");
  const options = meta.field?.options ?? [];

  // Uma consulta por coluna, em paralelo: só os primeiros cards de cada uma
  // (colunas como Done costumam ter centenas) e cada consulta fica leve.
  let columns: BoardColumn[];
  try {
    const targets = [{ id: NO_STATUS, name: "Sem status", q: columnQuery(null) }].concat(
      options.map((o) => ({ id: o.id, name: o.name, q: columnQuery(o.name) })),
    );
    columns = await Promise.all(
      targets.map(async (t) => {
        const res = await api.graphql<{
          node: { items: { totalCount: number; nodes: BoardNode[] } } | null;
        }>(COLUMN_QUERY, { id: boardId, q: t.q });
        const items = res?.node?.items;
        if (!items) throw new Error("GitHub: sem resposta (tempo esgotado), tente de novo");
        const cards = items.nodes
          .filter((n) => !n.isArchived)
          // o filtro é textual: confere o status de fato
          .filter((n) => (n.status?.optionId ?? NO_STATUS) === t.id)
          .map((n) => mapGithubCard(n.id, n.content));
        return {
          id: t.id,
          name: t.name,
          cards,
          total: items.totalCount > items.nodes.length ? items.totalCount : null,
        };
      }),
    );
  } catch (err) {
    if (!unsupportedQueryArg(err)) throw asWorkError(err);
    columns = (await pagedBoard(api, boardId)).columns;
  }

  // "Sem status" só aparece se tiver cards (ou se o project não tem Status).
  const shown = columns.filter(
    (c) => c.id !== NO_STATUS || c.cards.length > 0 || options.length === 0,
  );
  return { id: boardId, name: meta.title, url: meta.url, columns: shown };
}

async function moveCard(
  creds: Credentials,
  boardId: string,
  cardId: string,
  toColumnId: string,
): Promise<void> {
  const api = makeClient(creds);
  const fieldId = await statusFieldId(creds, api, boardId);
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
}
