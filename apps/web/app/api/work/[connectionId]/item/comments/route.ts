import type { NextRequest } from "next/server";
import { z } from "zod";
import { withWorkConnection } from "@/lib/work";

const Ref = z.string().min(1, "ref obrigatória");
const CommentBody = z.object({
  body: z.string().trim().min(1, "comentário vazio").max(65_000),
});

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await ctx.params;
  const ref = req.nextUrl.searchParams.get("ref");
  return withWorkConnection(connectionId, (adapter, creds) =>
    adapter.listComments(creds, Ref.parse(ref)),
  );
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await ctx.params;
  const ref = req.nextUrl.searchParams.get("ref");
  const json = await req.json().catch(() => ({}));
  return withWorkConnection(connectionId, (adapter, creds) =>
    adapter.addComment(creds, Ref.parse(ref), CommentBody.parse(json).body),
  );
}
