import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@devpulse/core";
import { env, isDev } from "./env";

/**
 * Auth do APP (login do usuário) — separado das conexões de dados (OAuth/PAT
 * dos provedores, tratadas em /api/oauth e /api/connections).
 *
 * MVP: login por email (dev). Em produção, trocar por magic-link/OAuth de login.
 * Estratégia JWT (necessária ao usar Credentials).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: env.AUTH_SECRET,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      id: "dev-email",
      name: "Dev (email)",
      credentials: { email: { label: "Email", type: "email" } },
      async authorize(credentials) {
        if (!isDev) return null;
        const email = String(credentials?.email ?? "")
          .trim()
          .toLowerCase();
        if (!email || !email.includes("@")) return null;
        const user = await prisma.user.upsert({
          where: { email },
          update: {},
          create: { email, name: email.split("@")[0] },
        });
        return { id: user.id, email: user.email, name: user.name ?? undefined };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid && session.user) {
        session.user.id = String(token.uid);
      }
      return session;
    },
  },
});
