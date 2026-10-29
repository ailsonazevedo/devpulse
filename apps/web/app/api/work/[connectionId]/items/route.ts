import type { NextRequest } from "next/server";
import { z } from "zod";
import { FieldValues, withWorkConnection } from "@/lib/work";

const CreateBody = z.object({
  containerId: z.string().min(1, "escolha o repositório/projeto"),
  title: z.string().trim().min(1, "informe um título").max(256),
  body: z.string().max(65_000).optional(),
  labels: z.array(z.string().trim().min(1)).max(20).optional(),
  assignees: z.array(z.string().trim().min(1)).max(10).optional(),
  fields: FieldValues.optional(),
  boardId: z.string().min(1).optional(),
  columnId: z.string().min(1).optional(),
});

/** Cria uma issue/work item no repositório/projeto escolhido (opcionalmente num board/coluna). */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await ctx.params;
  const json = await req.json().catch(() => ({}));
  return withWorkConnection(connectionId, (adapter, creds) =>
    adapter.createItem(creds, CreateBody.parse(json)),
  );
}
