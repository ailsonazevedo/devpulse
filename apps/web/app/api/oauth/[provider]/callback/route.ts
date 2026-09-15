import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { exchangeCode } from "@/lib/oauth";
import { upsertConnection } from "@/lib/connections";
import { parseProvider } from "@/lib/provider-param";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ provider: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const { provider: raw } = await ctx.params;
  const provider = parseProvider(raw);
  if (!provider) {
    return NextResponse.json({ error: "provider inválido" }, { status: 400 });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = req.cookies.get(`oauth_state_${raw}`)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(
      new URL("/connections?error=state_invalido", req.url),
    );
  }

  try {
    const tokens = await exchangeCode(provider, code);
    await upsertConnection({
      userId: session.user.id,
      provider,
      authMethod: "OAUTH",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
    });
    const res = NextResponse.redirect(
      new URL("/connections?connected=" + raw, req.url),
    );
    res.cookies.delete(`oauth_state_${raw}`);
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "erro";
    return NextResponse.redirect(
      new URL(`/connections?error=${encodeURIComponent(msg)}`, req.url),
    );
  }
}
