import type { NextRequest } from "next/server";
import { z } from "zod";
import { withWorkConnection } from "@/lib/work";

const Ref = z.string().min(1, "ref obrigatória");
const BranchBody = z.object({
  // regras do git (check-ref-format) no essencial
  name: z
    .string()
    .trim()
    .min(1, "informe o nome da branch")
    .max(200)
    .regex(/^(?!\/|.*(\/\/|\.\.|@\{|\/$|\.lock$|\.$))[^\s~^:?*[\\\x00-\x1f\x7f]+$/, "nome de branch inválido"),
  repositoryId: z.string().min(1).optional(),
});

/** Cria uma branch a partir da principal, vinculada à tarefa (ref na query). */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await ctx.params;
  const ref = req.nextUrl.searchParams.get("ref");
  const json = await req.json().catch(() => ({}));
  return withWorkConnection(connectionId, (adapter, creds) =>
    adapter.createBranch(creds, Ref.parse(ref ?? ""), BranchBody.parse(json)),
  );
}
