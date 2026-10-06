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

export interface WorkItemDetail extends WorkItem {
  /** corpo em texto/markdown (HTML do Azure é convertido para texto). */
  body: string;
  /** valores aceitos em `UpdateItemInput.state`. */
  availableStates: string[];
}

export interface WorkComment {
  id: string;
  author: WorkUser | null;
  body: string;
  createdAt: string;
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
}

export interface UpdateItemInput {
  title?: string;
  body?: string;
  /** um dos `WorkItemDetail.availableStates`. */
  state?: string;
  labels?: string[];
  /** logins (GitHub/GitLab) ou e-mail/uniqueName (Azure, só o primeiro). */
  assignees?: string[];
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
  listBoards(creds: Credentials): Promise<BoardSummary[]>;
  getBoard(creds: Credentials, boardId: string): Promise<Board>;
  moveCard(
    creds: Credentials,
    boardId: string,
    cardId: string,
    toColumnId: string,
  ): Promise<void>;
}
