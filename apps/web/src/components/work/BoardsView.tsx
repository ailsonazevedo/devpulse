"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Board, BoardCard, BoardSummary } from "@devpulse/core/work";
import { providerMeta } from "@/components/labels";
import { ExternalLinkIcon, RefreshIcon } from "@/components/icons";
import { friendlyError, workFetch, type WorkConnection } from "./api";
import { Avatars, LabelChips } from "./bits";
import { ReconnectBanner } from "./ReconnectBanner";
import { TaskDrawer } from "./TaskDrawer";

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
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [boardId, setBoardId] = useState("");
  const [board, setBoard] = useState<Board | null>(null);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openCard, setOpenCard] = useState<BoardCard | null>(null);
  /** Board pedido na URL: só vale para a conexão inicial. */
  const pendingBoard = useRef(initialBoard);

  const connection = connections.find((c) => c.id === connectionId);

  useEffect(() => {
    if (!connectionId) return;
    let alive = true;
    setBoards(null);
    setBoard(null);
    setBoardId("");
    setError(null);
    workFetch<BoardSummary[]>(`/api/work/${connectionId}/boards`)
      .then((list) => {
        if (!alive) return;
        const wanted = pendingBoard.current;
        pendingBoard.current = undefined;
        setBoards(list);
        const keep = wanted && list.some((b) => b.id === wanted);
        setBoardId(keep ? wanted : (list[0]?.id ?? ""));
      })
      .catch((e) => {
        if (!alive) return;
        setBoards([]);
        setError(friendlyError(e));
      });
    return () => {
      alive = false;
    };
  }, [connectionId]);

  const loadBoard = useCallback(async () => {
    if (!connectionId || !boardId) return;
    setLoadingBoard(true);
    setError(null);
    try {
      const b = await workFetch<Board>(
        `/api/work/${connectionId}/board?id=${encodeURIComponent(boardId)}`,
      );
      setBoard(b);
    } catch (e) {
      setBoard(null);
      setError(friendlyError(e));
    } finally {
      setLoadingBoard(false);
    }
  }, [connectionId, boardId]);

  useEffect(() => {
    void loadBoard();
    const p = new URLSearchParams();
    if (connectionId) p.set("connection", connectionId);
    if (boardId) p.set("board", boardId);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  }, [loadBoard, connectionId, boardId, pathname, router]);

  /** Move otimista: atualiza a UI e desfaz se o provedor recusar. */
  async function move(cardId: string, toColumnId: string) {
    if (!board) return;
    const from = board.columns.find((c) => c.cards.some((x) => x.id === cardId));
    if (!from || from.id === toColumnId) return;
    const card = from.cards.find((x) => x.id === cardId)!;
    const before = board;
    setBoard({
      ...board,
      columns: board.columns.map((c) =>
        c.id === from.id
          ? { ...c, cards: c.cards.filter((x) => x.id !== cardId) }
          : c.id === toColumnId
            ? { ...c, cards: [card, ...c.cards] }
            : c,
      ),
    });
    setError(null);
    try {
      await workFetch(`/api/work/${connectionId}/board/move`, {
        method: "POST",
        body: { boardId: board.id, cardId, toColumnId },
      });
    } catch (e) {
      setBoard(before);
      setError(`Não foi possível mover o card: ${friendlyError(e)}`);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ReconnectBanner connections={connections} />

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={connectionId}
          onChange={(e) => setConnectionId(e.target.value)}
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
          onClick={() => void loadBoard()}
          disabled={!boardId}
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

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      {board ? (
        <Kanban
          board={board}
          dimmed={loadingBoard}
          onMove={(cardId, col) => void move(cardId, col)}
          onOpen={(card) => card.ref && setOpenCard(card)}
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
          onChanged={() => void loadBoard()}
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
}: {
  board: Board;
  dimmed: boolean;
  onMove: (cardId: string, toColumnId: string) => void;
  onOpen: (card: BoardCard) => void;
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
          <h3 className="flex items-center justify-between px-3 py-2 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
            <span className="truncate">{col.name}</span>
            <span className="text-neutral-400">{col.cards.length}</span>
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
