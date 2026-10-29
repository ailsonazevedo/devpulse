import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@devpulse/core";
import { auth } from "@/auth";
import { generateApiToken } from "@/lib/api-auth";

const MAX_TOKENS = 20;

const bodySchema = z.object({
  name: z.string().trim().min(1, "nome obrigatório").max(60),
});

/** Tokens pessoais do usuário (sem o segredo). Só via sessão. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  const tokens = await prisma.apiToken.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, prefix: true, lastUsedAt: true, createdAt: true },
  });
  return NextResponse.json({ tokens });
}

/**
 * Cria um token pessoal. O valor em claro volta só nesta resposta; depois
 * fica apenas o hash. Exige sessão (um token não cria outros tokens).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "entrada inválida" },
      { status: 400 },
    );
  }
  const userId = session.user.id;
  const count = await prisma.apiToken.count({ where: { userId } });
  if (count >= MAX_TOKENS) {
    return NextResponse.json(
      { error: `limite de ${MAX_TOKENS} tokens atingido` },
      { status: 400 },
    );
  }

  const { token, tokenHash, prefix } = generateApiToken();
  const row = await prisma.apiToken.create({
    data: { userId, name: parsed.data.name, tokenHash, prefix },
    select: { id: true, name: true, prefix: true, lastUsedAt: true, createdAt: true },
  });
  return NextResponse.json({ token, apiToken: row }, { status: 201 });
}
