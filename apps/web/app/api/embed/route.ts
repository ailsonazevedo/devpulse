import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@devpulse/core";
import { auth } from "@/auth";

const bodySchema = z.object({
  action: z.enum(["enable", "regenerate", "disable"]),
});

/**
 * Liga/regenera/desliga o link público do heatmap (embed SVG). Regenerar
 * invalida o link anterior; desligar faz a URL antiga responder 404.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "ação inválida" }, { status: 400 });
  }

  const { action } = parsed.data;
  if (action === "enable") {
    // idempotente: mantém o token existente se já estiver ligado
    const current = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { embedToken: true },
    });
    if (current?.embedToken) {
      return NextResponse.json({ token: current.embedToken });
    }
  }

  const token = action === "disable" ? null : randomBytes(24).toString("base64url");
  await prisma.user.update({
    where: { id: session.user.id },
    data: { embedToken: token },
  });
  return NextResponse.json({ token });
}
