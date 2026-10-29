"use client";

import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import type { Provider } from "@devpulse/core";
import type {
  Board,
  BoardSummary,
  CreateFields,
  WorkComment,
  WorkContainer,
  WorkItem,
  WorkItemDetail,
  WorkLabel,
  WorkUser,
} from "@devpulse/core/work";
import { itemUrl, workFetch } from "./api";

/** Metadados (labels, pessoas, campos, repositórios, boards) mudam pouco. */
const META = 5 * 60_000;
/** Dados ao vivo (lista, board, detalhe): mostra o cache e revalida logo. */
const LIVE = 30_000;

export type ListItem = WorkItem & { connectionId: string };

export interface ItemsResponse {
  items: ListItem[];
  nextCursor: string | null;
  totals: Record<string, number | null>;
  errors: { connectionId: string; kind: string; message: string }[];
}

export interface TaskFilters {
  provider?: Provider;
  state: "open" | "closed" | "all";
  involvement: "assigned" | "created";
  q: string;
}

export function tasksQuery(f: TaskFilters, cursor?: string | null): string {
  const p = new URLSearchParams();
  if (f.provider) p.set("provider", f.provider);
  if (f.state !== "open") p.set("state", f.state);
  if (f.involvement !== "assigned") p.set("involvement", f.involvement);
  if (f.q.trim()) p.set("q", f.q.trim());
  if (cursor) p.set("cursor", cursor);
  return p.toString();
}

export interface CreateFieldsParams {
  container?: string;
  board?: string;
  type?: string;
}

export const workKeys = {
  all: ["work"] as const,
  tasks: (f?: TaskFilters) => (f ? (["work", "tasks", f] as const) : (["work", "tasks"] as const)),
  containers: (cid: string) => ["work", cid, "containers"] as const,
  labels: (cid: string, container: string) => ["work", cid, "labels", container] as const,
  assignees: (cid: string, container: string) => ["work", cid, "assignees", container] as const,
  createFields: (cid: string, p: CreateFieldsParams) => ["work", cid, "create-fields", p] as const,
  boards: (cid: string) => ["work", cid, "boards"] as const,
  board: (cid: string, boardId: string) => ["work", cid, "board", boardId] as const,
  item: (cid: string, ref: string) => ["work", cid, "item", ref] as const,
  comments: (cid: string, ref: string) => ["work", cid, "comments", ref] as const,
};

/** URL de cada recurso (também usada pelo "Recarregar", que ignora o cache do servidor). */
const urls = {
  containers: (cid: string) => `/api/work/${cid}/containers`,
  labels: (cid: string, c: string) => `/api/work/${cid}/labels?container=${encodeURIComponent(c)}`,
  assignees: (cid: string, c: string) =>
    `/api/work/${cid}/assignees?container=${encodeURIComponent(c)}`,
  createFields: (cid: string, p: CreateFieldsParams) => {
    const q = new URLSearchParams();
    if (p.container) q.set("container", p.container);
    if (p.board) q.set("board", p.board);
    if (p.type) q.set("type", p.type);
    return `/api/work/${cid}/fields?${q}`;
  },
  boards: (cid: string) => `/api/work/${cid}/boards`,
  board: (cid: string, id: string) => `/api/work/${cid}/board?id=${encodeURIComponent(id)}`,
};

export function useContainers(cid: string) {
  return useQuery({
    queryKey: workKeys.containers(cid),
    queryFn: ({ signal }) => workFetch<WorkContainer[]>(urls.containers(cid), { signal }),
    enabled: !!cid,
    staleTime: META,
  });
}

export function useLabels(cid: string, container: string | null) {
  return useQuery({
    queryKey: workKeys.labels(cid, container ?? ""),
    queryFn: ({ signal }) => workFetch<WorkLabel[]>(urls.labels(cid, container!), { signal }),
    enabled: !!cid && !!container,
    staleTime: META,
  });
}

export function useAssignees(cid: string, container: string | null) {
  return useQuery({
    queryKey: workKeys.assignees(cid, container ?? ""),
    queryFn: ({ signal }) => workFetch<WorkUser[]>(urls.assignees(cid, container!), { signal }),
    enabled: !!cid && !!container,
    staleTime: META,
  });
}

export function useCreateFields(cid: string, p: CreateFieldsParams) {
  return useQuery({
    queryKey: workKeys.createFields(cid, p),
    queryFn: ({ signal }) => workFetch<CreateFields>(urls.createFields(cid, p), { signal }),
    enabled: !!cid && !!(p.container || p.board),
    staleTime: META,
  });
}

export function useBoards(cid: string) {
  return useQuery({
    queryKey: workKeys.boards(cid),
    queryFn: ({ signal }) => workFetch<BoardSummary[]>(urls.boards(cid), { signal }),
    enabled: !!cid,
    staleTime: META,
  });
}

export function useBoard(cid: string, boardId: string) {
  return useQuery({
    queryKey: workKeys.board(cid, boardId),
    queryFn: ({ signal }) => workFetch<Board>(urls.board(cid, boardId), { signal }),
    enabled: !!cid && !!boardId,
    staleTime: LIVE,
    refetchOnWindowFocus: true,
  });
}

const fetchItem = (cid: string, ref: string, signal?: AbortSignal) =>
  workFetch<WorkItemDetail>(itemUrl(cid, ref), { signal });

export function useTaskDetail(cid: string, ref: string) {
  return useQuery({
    queryKey: workKeys.item(cid, ref),
    queryFn: ({ signal }) => fetchItem(cid, ref, signal),
    staleTime: LIVE,
  });
}

export function useComments(cid: string, ref: string) {
  return useQuery({
    queryKey: workKeys.comments(cid, ref),
    queryFn: ({ signal }) => workFetch<WorkComment[]>(itemUrl(cid, ref, "/comments"), { signal }),
    staleTime: LIVE,
  });
}

/** Lista unificada, paginada por cursor; troca de filtro mantém a lista anterior visível. */
export function useTasks(filters: TaskFilters) {
  return useInfiniteQuery({
    queryKey: workKeys.tasks(filters),
    queryFn: ({ pageParam, signal }) =>
      workFetch<ItemsResponse>(`/api/work/items?${tasksQuery(filters, pageParam)}`, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
    staleTime: LIVE,
    refetchOnWindowFocus: true,
  });
}

/** Começa a carregar o detalhe antes do clique (hover num card/linha). */
export function prefetchTask(qc: QueryClient, cid: string, ref: string) {
  void qc.prefetchQuery({
    queryKey: workKeys.item(cid, ref),
    queryFn: ({ signal }) => fetchItem(cid, ref, signal),
    staleTime: LIVE,
  });
}

/**
 * "Recarregar": busca de novo ignorando o cache de metadados do servidor e
 * substitui o cache local.
 */
export function useRefresh() {
  const qc = useQueryClient();
  return {
    board: (cid: string, boardId: string) =>
      refresh(qc, workKeys.board(cid, boardId), urls.board(cid, boardId)),
    boards: (cid: string) => refresh(qc, workKeys.boards(cid), urls.boards(cid)),
  };
}

function refresh(qc: QueryClient, key: QueryKey, url: string) {
  return qc.fetchQuery({
    queryKey: key,
    queryFn: () => workFetch(url, { refresh: true }),
    staleTime: 0,
  });
}

/** Após editar/criar: lista e boards da conexão revalidam em segundo plano. */
export function invalidateLists(qc: QueryClient, cid: string) {
  void qc.invalidateQueries({ queryKey: workKeys.tasks() });
  void qc.invalidateQueries({ queryKey: ["work", cid, "board"] });
}
