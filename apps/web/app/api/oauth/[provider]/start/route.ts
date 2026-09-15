import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { buildAuthorizeUrl, isOAuthConfigured } from "@/lib/oauth";
import { parseProvider } from "@/lib/provider-param";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ provider: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", _req.url));
  }

  const { provider: raw } = await ctx.params;
  const provider = parseProvider(raw);
  if (!provider) {
    return NextResponse.json({ error: "provider inválido" }, { status: 400 });
  }
  if (!isOAuthConfigured(provider)) {
    return NextResponse.redirect(
      new URL(`/connections?error=oauth_nao_configurado_${raw}`, _req.url),
    );
  }

  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(buildAuthorizeUrl(provider, state));
  // state em cookie httpOnly p/ validar CSRF no callback
  res.cookies.set(`oauth_state_${raw}`, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
