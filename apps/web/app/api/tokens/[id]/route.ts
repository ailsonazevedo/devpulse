import { NextResponse } from "next/server";
import { prisma } from "@devpulse/core";
import { auth } from "@/auth";

/** Revoga um token pessoal (efeito imediato). */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const { count } = await prisma.apiToken.deleteMany({
    where: { id, userId: session.user.id },
  });
  if (count === 0) {
    return NextResponse.json({ error: "token não encontrado" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
