import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getUserId } from "@/lib/api-auth";
import { getFeed } from "@/lib/queries";

const Query = z.object({
  provider: z.enum(["GITHUB", "GITLAB", "AZURE"]).optional(),
  type: z
    .enum(["COMMIT", "PUSH", "PR", "MR", "ISSUE", "REVIEW", "COMMENT", "RELEASE", "OTHER"])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Atividades recentes do usuário (feed unificado). Aceita token pessoal. */
export async function GET(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  const parsed = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "filtro inválido", kind: "input" }, { status: 400 });
  }
  const { provider, type, limit } = parsed.data;
  const activities = await getFeed(userId, { provider, types: type ? [type] : undefined }, limit);
  return NextResponse.json({ activities });
}
