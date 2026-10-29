import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@devpulse/core";
import { clearConnectionCache } from "@devpulse/core/work";
import { auth } from "@/auth";

/** Desconecta: apaga tokens + atividades da conexão (isolado por userId). */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  const { id } = await ctx.params;

  // garante ownership antes de apagar
  const result = await prisma.providerConnection.deleteMany({
    where: { id, userId: session.user.id },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "não encontrado" }, { status: 404 });
  }
  await clearConnectionCache(id);
  return NextResponse.json({ ok: true });
}
