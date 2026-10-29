"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import type { Board, BoardCard, BoardSummary } from "@devpulse/core/work";
import { providerMeta } from "@/components/labels";
import { ExternalLinkIcon, RefreshIcon } from "@/components/icons";
import { friendlyError, workFetch, type WorkConnection } from "./api";
import { Avatars, LabelChips } from "./bits";
import { ReconnectBanner } from "./ReconnectBanner";
import { TaskDrawer } from "./TaskDrawer";
import { NewTaskDialog, type BoardTarget } from "./NewTaskDialog";
import { prefetchTask, useBoard, useBoards, useRefresh, workKeys } from "./queries";

export function BoardsView({
  connections,
  initialConnection,
  initialBoard,
}: {
  connections: WorkConnection[];
  initialConnection?: string;
  initialBoard?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [connectionId, setConnectionId] = useState(
    connections.some((c) => c.id === initialConnection)
      ? initialConnection!
      : (connections[0]?.id ?? ""),
  );
  const [boardId, setBoardId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [openCard, setOpenCard] = useState<BoardCard | null>(null);
  const [newIn, setNewIn] = useState<BoardTarget | null>(null);
  /** Board pedido na URL: só vale para a conexão inicial. */
  const pendingBoard = useRef(initialBoard);
  const qc = useQueryClient();
  const refresh = useRefresh();

  const connection = connections.find((c) => c.id === connectionId);
  const boardsQuery = useBoards(connectionId);
  const boards: BoardSummary[] | null =
    boardsQuery.data ?? (boardsQuery.isError ? [] : null);
  const boardQuery = useBoard(connectionId, boardId);
  const board = boardQuery.data ?? null;
  const loadingBoard = boardQuery.isFetching || refreshing;
  const queryError = boardsQuery.error ?? boardQuery.error;

  // Escolhe o board: o da URL (1ª vez) ou o primeiro da lista.
  useEffect(() => {
    const list = boardsQuery.data;
    if (!list) return;
    if (boardId && list.some((b) => b.id === boardId)) return;
    const wanted = pendingBoard.current;
    pendingBoard.current = undefined;
    setBoardId(wanted && list.some((b) => b.id === wanted) ? wanted : (list[0]?.id ?? ""));
  }, [boardsQuery.data, boardId]);

  useEffect(() => {
    const p = new URLSearchParams();
    if (connectionId) p.set("connection", connectionId);
    if (boardId) p.set("board", boardId);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  }, [connectionId, boardId, pathname, router]);

  /** "Recarregar": ignora também o cache de metadados do servidor (colunas, boards). */
  async function reload() {
    if (!connectionId || !boardId) return;
    setRefreshing(true);
    setError(null);
    try {
      await Promise.all([refresh.board(connectionId, boardId), refresh.boards(connectionId)]);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setRefreshing(false);
    }
  }

  /** Move otimista no cache: atualiza a UI e desfaz se o provedor recusar. */
  async function move(cardId: string, toColumnId: string) {
    if (!board) return;
    const from = board.columns.find((c) => c.cards.some((x) => x.id === cardId));
    if (!from || from.id === toColumnId) return;
    const card = from.cards.find((x) => x.id === cardId)!;
    const key = workKeys.board(connectionId, board.id);
    const before = board;
    await qc.cancelQueries({ queryKey: key });
    qc.setQueryData<Board>(key, {
      ...board,
      columns: board.columns.map((c) =>
        c.id === from.id
          ? { ...c, cards: c.cards.filter((x) => x.id !== cardId), total: c.total && c.total - 1 }
          : c.id === toColumnId
            ? { ...c, cards: [card, ...c.cards], total: c.total && c.total + 1 }
            : c,
      ),
    });
    setError(null);
    try {
      await workFetch(`/api/work/${connectionId}/board/move`, {
        method: "POST",
        body: { boardId: board.id, cardId, toColumnId },
      });
      void qc.invalidateQueries({ queryKey: workKeys.tasks() });
      if (card.ref) void qc.invalidateQueries({ queryKey: workKeys.item(connectionId, card.ref) });
    } catch (e) {
      qc.setQueryData(key, before);
      setError(`Não foi possível mover o card: ${friendlyError(e)}`);
    }
  }

  const shownError = error ?? (queryError ? friendlyError(queryError) : null);

  return (
    <div className="flex flex-col gap-4">
      <ReconnectBanner connections={connections} />

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={connectionId}
          onChange={(e) => {
            setConnectionId(e.target.value);
            setBoardId("");
            setError(null);
          }}
          className="input py-1.5 text-sm"
          aria-label="Conta"
        >
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {providerMeta[c.provider].label} · {c.login}
            </option>
          ))}
        </select>
        <select
          value={boardId}
          onChange={(e) => setBoardId(e.target.value)}
          disabled={!boards || boards.length === 0}
          className="input min-w-0 flex-1 py-1.5 text-sm"
          aria-label="Board"
        >
          {boards === null && <option>Carregando boards…</option>}
          {boards?.length === 0 && <option value="">Nenhum board encontrado</option>}
          {boards?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.scope} · {b.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => void reload()}
          disabled={!boardId || refreshing}
          className="btn-ghost px-2.5 py-1.5 text-xs"
          title="Recarregar"
        >
          <RefreshIcon className={"h-3.5 w-3.5 " + (loadingBoard ? "animate-spin" : "")} />
        </button>
        {board?.url && (
          <a
            href={board.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost px-2.5 py-1.5 text-xs"
          >
            Abrir no provedor <ExternalLinkIcon className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {connection?.provider === "GITHUB" && (
        <p className="text-xs text-neutral-400">
          No GitHub, os boards são os Projects (v2) e as colunas vêm do campo “Status”.
          Não aparecem os Projects de uma organização? Ela pode restringir apps OAuth: em
          GitHub → Settings → Applications → Authorized OAuth Apps → DevPulse, peça ou
          conceda acesso à organização.
        </p>
      )}

      {shownError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {shownError}
        </p>
      )}

      {board ? (
        <Kanban
          board={board}
          dimmed={loadingBoard}
          onMove={(cardId, col) => void move(cardId, col)}
          onOpen={(card) => card.ref && setOpenCard(card)}
          onHover={(card) => card.ref && prefetchTask(qc, connectionId, card.ref)}
          onCreate={(columnId) =>
            setNewIn({
              id: board.id,
              name: board.name,
              columns: board.columns.map((c) => ({ id: c.id, name: c.name })),
              columnId,
            })
          }
        />
      ) : (
        loadingBoard && (
          <div className="flex gap-3 overflow-hidden">
            {Array.from({ length: 4 }, (_, i) => (
              <div
                key={i}
                className="h-72 w-72 shrink-0 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800/60"
              />
            ))}
          </div>
        )
      )}

      {newIn && connection && (
        <NewTaskDialog
          connections={[connection]}
          board={newIn}
          onClose={() => setNewIn(null)}
          onCreated={() => {
            setNewIn(null);
            void qc.invalidateQueries({ queryKey: workKeys.board(connectionId, newIn.id) });
            void qc.invalidateQueries({ queryKey: workKeys.tasks() });
          }}
        />
      )}

      {openCard?.ref && connection && (
        <TaskDrawer
          connection={connection}
          item={{
            ref: openCard.ref,
            title: openCard.title,
            provider: connection.provider,
            url: openCard.url ?? "",
            number: openCard.number ?? "",
          }}
          onClose={() => setOpenCard(null)}
          onChanged={() => void qc.invalidateQueries({ queryKey: workKeys.board(connectionId, boardId) })}
        />
      )}
    </div>
  );
}

function Kanban({
  board,
  dimmed,
  onMove,
  onOpen,
  onCreate,
  onHover,
}: {
  board: Board;
  dimmed: boolean;
  onMove: (cardId: string, toColumnId: string) => void;
  onOpen: (card: BoardCard) => void;
  onCreate: (columnId: string) => void;
  onHover: (card: BoardCard) => void;
}) {
  const [over, setOver] = useState<string | null>(null);

  return (
    <div
      className={
        "-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 transition-opacity sm:-mx-6 sm:px-6 " +
        (dimmed ? "opacity-60" : "")
      }
    >
      {board.columns.map((col) => (
        <section
          key={col.id}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(col.id);
          }}
          onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
          onDrop={(e) => {
            e.preventDefault();
            setOver(null);
            const cardId = e.dataTransfer.getData("text/plain");
            if (cardId) onMove(cardId, col.id);
          }}
          className={
            "flex max-h-[70vh] w-72 shrink-0 flex-col rounded-xl border bg-neutral-100/70 transition-colors dark:bg-neutral-900/60 " +
            (over === col.id
              ? "border-neutral-400 dark:border-neutral-500"
              : "border-transparent")
          }
        >
          <h3 className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
            <span className="truncate">{col.name}</span>
            <span
              className="text-neutral-400"
              title={col.total ? `Mostrando ${col.cards.length} de ${col.total}` : undefined}
            >
              {col.total ? `${col.cards.length} de ${col.total}` : col.cards.length}
            </span>
            <button
              onClick={() => onCreate(col.id)}
              aria-label={`Nova tarefa em ${col.name}`}
              title="Nova tarefa nesta coluna"
              className="ml-auto rounded-md px-1.5 text-base leading-none text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            >
              +
            </button>
          </h3>
          <ul className="flex min-h-16 flex-col gap-2 overflow-y-auto px-2 pb-2">
            {col.cards.map((card) => (
              <li
                key={card.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", card.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => onOpen(card)}
                onMouseEnter={() => onHover(card)}
                className={
                  "card cursor-grab px-3 py-2 text-sm active:cursor-grabbing " +
                  (card.ref ? "hover:border-neutral-300 dark:hover:border-neutral-700" : "")
                }
              >
                <div className="mb-1 flex items-center gap-1.5 text-[11px] text-neutral-400">
                  {card.number && <span>{card.number}</span>}
                  <span>{card.kind}</span>
                </div>
                <p className="line-clamp-3 font-medium leading-snug">{card.title}</p>
                {(card.labels.length > 0 || card.assignees.length > 0) && (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <LabelChips labels={card.labels} max={3} />
                    <Avatars users={card.assignees} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
