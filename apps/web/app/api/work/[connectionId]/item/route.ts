import type { NextRequest } from "next/server";
import { z } from "zod";
import { withWorkConnection } from "@/lib/work";

const Ref = z.string().min(1, "ref obrigatória");

const UpdateBody = z
  .object({
    title: z.string().trim().min(1).max(256),
    body: z.string().max(65_000),
    state: z.string().min(1),
    labels: z.array(z.string().trim().min(1)).max(50),
    assignees: z.array(z.string().trim().min(1)).max(10),
  })
  .partial();

/** Detalhe de um item (ref na query: contém "/" e "#"). */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await ctx.params;
  const ref = req.nextUrl.searchParams.get("ref");
  return withWorkConnection(connectionId, (adapter, creds) =>
    adapter.getItem(creds, Ref.parse(ref)),
  );
}

/** Edita título, corpo, estado, labels e/ou responsáveis. */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await ctx.params;
  const ref = req.nextUrl.searchParams.get("ref");
  const json = await req.json().catch(() => ({}));
  return withWorkConnection(connectionId, (adapter, creds) =>
    adapter.updateItem(creds, Ref.parse(ref), UpdateBody.parse(json)),
  );
}
