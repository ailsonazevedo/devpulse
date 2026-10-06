import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@devpulse/core";
import { getWorkAdapter, withConnection, type WorkItem } from "@devpulse/core/work";
import { auth } from "@/auth";
import { classifyWorkError, type WorkErrorKind } from "@/lib/work";

const Query = z.object({
  provider: z.enum(["GITHUB", "GITLAB", "AZURE"]).optional(),
  connectionId: z.string().optional(),
  state: z.enum(["open", "closed", "all"]).default("open"),
  involvement: z.enum(["assigned", "created"]).default("assigned"),
  q: z.string().max(200).optional(),
  cursor: z.string().optional(),
});

/** Cursor combinado: conexão → cursor da próxima página (null = esgotada). */
type Cursors = Record<string, string | null>;

function decodeCursor(raw: string | undefined): Cursors | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursors;
  } catch {
    return undefined;
  }
}

export interface ItemsResponse {
  items: (WorkItem & { connectionId: string })[];
  nextCursor: string | null;
  /** total por conexão que respondeu (null = provedor não informa). */
  totals: Record<string, number | null>;
  errors: { connectionId: string; kind: WorkErrorKind; message: string }[];
}

/**
 * Lista unificada: consulta ao vivo todas as conexões do usuário em paralelo.
 * Falha de um provedor não derruba os demais (volta em `errors`).
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  const userId = session.user.id;
  const parsed = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "filtro inválido", kind: "input" }, { status: 400 });
  }
  const { provider, connectionId, state, involvement, q } = parsed.data;
  const cursors = decodeCursor(parsed.data.cursor);

  const connections = await prisma.providerConnection.findMany({
    where: {
      userId,
      status: { not: "REVOKED" },
      ...(provider ? { provider } : {}),
      ...(connectionId ? { id: connectionId } : {}),
    },
    select: { id: true, provider: true },
    orderBy: { createdAt: "asc" },
  });
  // Na paginação, só segue as conexões que ainda têm próxima página.
  const targets = cursors
    ? connections.filter((c) => typeof cursors[c.id] === "string")
    : connections;

  const results = await Promise.allSettled(
    targets.map((c) =>
      withConnection(c.id, userId, (creds) =>
        getWorkAdapter(c.provider).listItems(creds, {
          state,
          involvement,
          q,
          cursor: cursors?.[c.id] ?? null,
        }),
      ),
    ),
  );

  const res: ItemsResponse = { items: [], nextCursor: null, totals: {}, errors: [] };
  const next: Cursors = {};
  results.forEach((r, i) => {
    const id = targets[i]!.id;
    if (r.status === "fulfilled") {
      res.items.push(...r.value.items.map((it) => ({ ...it, connectionId: id })));
      next[id] = r.value.nextCursor;
      res.totals[id] = r.value.total;
    } else {
      const { kind, message } = classifyWorkError(r.reason);
      res.errors.push({ connectionId: id, kind, message });
    }
  });
  res.items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (Object.values(next).some((c) => c !== null)) {
    res.nextCursor = Buffer.from(JSON.stringify(next)).toString("base64url");
  }
  return NextResponse.json(res);
}
