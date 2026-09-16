import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { upsertConnection } from "@/lib/connections";

const bodySchema = z
  .object({
    provider: z.enum(["GITHUB", "GITLAB", "AZURE"]),
    token: z.string().min(10),
    baseUrl: z
      .string()
      .url()
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? v : undefined)),
  })
  // Azure DevOps é scoped por organização: a base URL (ex.:
  // https://dev.azure.com/sua-org) é obrigatória.
  .refine((b) => b.provider !== "AZURE" || Boolean(b.baseUrl), {
    message: "Azure DevOps exige a URL da organização (ex.: https://dev.azure.com/sua-org)",
    path: ["baseUrl"],
  });

/** Conecta um provedor via Personal Access Token (inclui self-hosted via baseUrl). */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "payload inválido", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const conn = await upsertConnection({
      userId: session.user.id,
      provider: parsed.data.provider,
      authMethod: "PAT",
      accessToken: parsed.data.token,
      baseUrl: parsed.data.baseUrl ?? null,
    });
    return NextResponse.json({
      id: conn.id,
      provider: conn.provider,
      login: conn.externalLogin,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "erro ao validar token";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
