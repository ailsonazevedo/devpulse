import { NextResponse, type NextRequest } from "next/server";
import { enqueueSync, prisma } from "@devpulse/core";
import { clearConnectionCache } from "@devpulse/core/work";
import { auth } from "@/auth";

/** Re-dispara backfill de uma conexão do próprio usuário e limpa o cache de metadados. */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const conn = await prisma.providerConnection.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!conn) {
    return NextResponse.json({ error: "não encontrado" }, { status: 404 });
  }
  await enqueueSync(conn.id, "backfill");
  // Resync também renova os metadados de tarefas (labels, campos, boards…).
  await clearConnectionCache(conn.id);
  return NextResponse.json({ ok: true });
}
