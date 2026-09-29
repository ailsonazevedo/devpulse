import type { NextRequest } from "next/server";
import { z } from "zod";
import { type Provider, prisma } from "@devpulse/core";
import {
  ALL_PROVIDERS,
  renderErrorSvg,
  renderHeatmapSvg,
} from "@devpulse/core/heatmap";
import { getConnectedProviders, getHeatmap } from "@/lib/queries";

/**
 * Embed público do heatmap (SVG) para READMEs/perfis — sem sessão, o acesso é
 * pelo token não adivinhável do usuário. Os dados são atualizados pelo worker a
 * cada poucos minutos; o cache HTTP (4h) faz o proxy de imagens do GitHub
 * (camo) buscar uma versão nova várias vezes ao dia.
 */

export const dynamic = "force-dynamic";

const CACHE = "public, max-age=14400, s-maxage=14400, stale-while-revalidate=86400";

const querySchema = z.object({
  theme: z.enum(["light", "dark", "auto"]).catch("auto"),
  color: z.enum(["level", "provider"]).catch("level"),
  header: z
    .enum(["0", "1", "false", "true"])
    .transform((v) => v === "1" || v === "true")
    .catch(true),
  providers: z.string().optional().catch(undefined),
});

function svgResponse(body: string, status: number, cache: string) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": cache,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token: raw } = await ctx.params;
  const token = raw.replace(/\.svg$/i, "");
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const q = querySchema.parse({
    theme: sp.theme ?? "auto",
    color: sp.color ?? "level",
    header: sp.header ?? "1",
    providers: sp.providers,
  });
  const theme = q.theme;

  const user = token
    ? await prisma.user.findUnique({ where: { embedToken: token }, select: { id: true } })
    : null;
  if (!user) {
    // cache curto: um link reativado/regenerado não deve ficar preso num 404
    return svgResponse(
      renderErrorSvg("link inválido ou desativado", theme),
      404,
      "public, max-age=300",
    );
  }

  const connected = await getConnectedProviders(user.id);
  const requested = q.providers
    ?.split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is Provider => (ALL_PROVIDERS as string[]).includes(s));
  const filtered = requested?.length
    ? connected.filter((p) => requested.includes(p))
    : connected;
  const providers = ALL_PROVIDERS.filter((p) => filtered.includes(p));

  const days = await getHeatmap(user.id);
  const svg = renderHeatmapSvg(days, {
    theme,
    providers,
    colorBy: q.color,
    header: q.header,
  });
  return svgResponse(svg, 200, CACHE);
}
