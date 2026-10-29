import type { Provider } from "@prisma/client";
import type { Credentials } from "../adapters/types.js";

/**
 * Gestão de tarefas/issues/boards ao vivo na API do provedor (sem cache no DB).
 * Separado do ProviderAdapter (ingestão) para não inchar aquele contrato.
 *
 * Refs são strings opacas e estáveis por provedor, geradas e interpretadas só
 * pelo adapter: GitHub `owner/repo#123`, GitLab `projectId#iid`, Azure
 * `projeto#id`.
 */

/** Estado normalizado (comparável entre provedores). */
export type WorkState = "open" | "closed";

/** Relação do usuário com o item: atribuído a ele ou criado por ele. */
export type Involvement = "assigned" | "created";

export interface WorkUser {
  login: string;
  name?: string | null;
  avatarUrl?: string | null;
}

/** Onde um item vive: repositório (GitHub), projeto (GitLab/Azure). */
export interface WorkContainer {
  id: string;
  name: string;
  url?: string | null;
}

export interface WorkItem {
  ref: string;
  provider: Provider;
  /** identificador curto para exibição (ex.: "#123"). */
  number: string;
  title: string;
  state: WorkState;
  /** estado nativo do provedor (ex.: "Active", "opened"). */
  rawState: string;
  /** tipo nativo (issue, Bug, Task, User Story…). */
  kind: string;
  url: string;
  container: WorkContainer;
  labels: string[];
  assignees: WorkUser[];
  author: WorkUser | null;
  /** ISO 8601. */
  createdAt: string;
  updatedAt: string;
}

export type WorkFieldType = "single_select" | "number" | "text" | "date";

/** Valor de campo: id da opção, número, texto ou data `YYYY-MM-DD`; null = vazio. */
export type WorkFieldValue = string | number | null;

export interface WorkFieldOption {
  id: string;
  name: string;
  /** cor hex com "#" (quando o provedor informa). */
  color?: string | null;
  description?: string | null;
}

/**
 * Campo além de título/corpo/estado/labels/responsáveis: tipo, prioridade,
 * esforço, iteração, milestone, campos de Project… O `id` é opaco e só o
 * adapter o interpreta (ex.: GitHub `pf:<project>:<field>:<kind>`, Azure o
 * reference name). `type` (id "type") é o tipo do item em todos os provedores.
 */
export interface WorkField {
  id: string;
  name: string;
  type: WorkFieldType;
  /** opções de `single_select`. */
  options?: WorkFieldOption[];
  value: WorkFieldValue;
  /** agrupamento na UI (ex.: nome do Project no GitHub). */
  group?: string | null;
  required?: boolean;
  /** dica de formato (ex.: "3h 30m"). */
  hint?: string | null;
}

/** Branch ou PR/MR ligado à tarefa. */
export interface WorkLink {
  kind: "branch" | "pull_request";
  name: string;
  url: string | null;
  /** estado nativo do PR/MR (open, merged…). */
  state?: string | null;
}

export interface WorkItemDetail extends WorkItem {
  /** corpo em texto/markdown (HTML do Azure é convertido para texto). */
  body: string;
  /** valores aceitos em `UpdateItemInput.state`. */
  availableStates: string[];
  /** campos editáveis via `UpdateItemInput.fields`. */
  fields: WorkField[];
  /** branches e PRs/MRs vinculados. */
  links: WorkLink[];
  /**
   * Repositórios onde `createBranch` pode criar a branch (null = o próprio
   * repositório/projeto da tarefa).
   */
  branchRepositories: WorkContainer[] | null;
}

export interface WorkComment {
  id: string;
  author: WorkUser | null;
  body: string;
  createdAt: string;
}

export interface WorkLabel {
  name: string;
  /** cor hex com "#" (Azure: tags não têm cor). */
  color?: string | null;
  description?: string | null;
}

export interface ListFilter {
  state?: WorkState | "all";
  involvement?: Involvement;
  q?: string;
  /** cursor opaco devolvido pela página anterior. */
  cursor?: string | null;
}

export interface ItemPage {
  items: WorkItem[];
  nextCursor: string | null;
  /** total de itens que casam com o filtro (null = provedor não informa). */
  total: number | null;
}

export interface CreateItemInput {
  containerId: string;
  title: string;
  body?: string;
  labels?: string[];
  /** logins (GitHub/GitLab) ou e-mail/uniqueName (Azure, só o primeiro). */
  assignees?: string[];
  /** valores por `WorkField.id` (de `getCreateFields`). */
  fields?: Record<string, WorkFieldValue>;
  /** cria já dentro do board, na coluna `columnId` (ids de `getBoard`). */
  boardId?: string;
  columnId?: string;
}

export interface CreateFieldsQuery {
  containerId?: string;
  boardId?: string;
  /** tipo escolhido (Azure: os campos dependem do tipo). */
  type?: string;
}

export interface CreateFields {
  fields: WorkField[];
  /** repositório/projeto imposto pelo board (null = livre). */
  container: WorkContainer | null;
}

export interface CreateBranchInput {
  name: string;
  /** repositório (Azure: um de `branchRepositories`; demais: o da tarefa). */
  repositoryId?: string;
}

export interface UpdateItemInput {
  title?: string;
  body?: string;
  /** um dos `WorkItemDetail.availableStates`. */
  state?: string;
  labels?: string[];
  /** logins (GitHub/GitLab) ou e-mail/uniqueName (Azure, só o primeiro). */
  assignees?: string[];
  /** valores por `WorkField.id` (de `WorkItemDetail.fields`); null limpa. */
  fields?: Record<string, WorkFieldValue>;
}

export interface BoardSummary {
  id: string;
  name: string;
  /** repo/projeto/time dono do board, para exibição. */
  scope: string;
  url?: string | null;
}

/** Card de board. `ref` é o work item por trás (null = rascunho no GitHub). */
export interface BoardCard {
  id: string;
  ref: string | null;
  number: string | null;
  title: string;
  url: string | null;
  kind: string;
  labels: string[];
  assignees: WorkUser[];
}

export interface BoardColumn {
  id: string;
  name: string;
  cards: BoardCard[];
  /** total de cards na coluna quando só parte foi carregada (null/ausente = todos). */
  total?: number | null;
}

export interface Board {
  id: string;
  name: string;
  url: string | null;
  columns: BoardColumn[];
}

export interface WorkAdapter {
  readonly provider: Provider;
  listItems(creds: Credentials, filter: ListFilter): Promise<ItemPage>;
  getItem(creds: Credentials, ref: string): Promise<WorkItemDetail>;
  createItem(creds: Credentials, input: CreateItemInput): Promise<WorkItem>;
  updateItem(
    creds: Credentials,
    ref: string,
    input: UpdateItemInput,
  ): Promise<WorkItemDetail>;
  listComments(creds: Credentials, ref: string): Promise<WorkComment[]>;
  addComment(
    creds: Credentials,
    ref: string,
    body: string,
  ): Promise<WorkComment>;
  /** Repos/projetos onde o usuário pode criar itens. */
  listContainers(creds: Credentials): Promise<WorkContainer[]>;
  /** Labels (tags no Azure) disponíveis num repositório/projeto. */
  listLabels(creds: Credentials, containerId: string): Promise<WorkLabel[]>;
  /** Pessoas que podem ser responsáveis por itens do repositório/projeto. */
  listAssignees(creds: Credentials, containerId: string): Promise<WorkUser[]>;
  /** Campos disponíveis ao criar (num repositório/projeto e/ou board). */
  getCreateFields(creds: Credentials, query: CreateFieldsQuery): Promise<CreateFields>;
  /** Cria uma branch a partir da principal e a vincula à tarefa. */
  createBranch(
    creds: Credentials,
    ref: string,
    input: CreateBranchInput,
  ): Promise<WorkLink>;
  listBoards(creds: Credentials): Promise<BoardSummary[]>;
  getBoard(creds: Credentials, boardId: string): Promise<Board>;
  moveCard(
    creds: Credentials,
    boardId: string,
    cardId: string,
    toColumnId: string,
  ): Promise<void>;
}
