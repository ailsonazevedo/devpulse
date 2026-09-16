import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { isDev } from "@/env";
import { GitHubIcon, GitLabIcon, LogoMark } from "@/components/icons";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user?.id) redirect("/feed");

  async function login(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "");
    await signIn("dev-email", { email, redirectTo: "/feed" });
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900">
            <LogoMark className="h-7 w-7" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">DevPulse</h1>
            <p className="mt-1 text-sm text-neutral-500">
              Todas as suas contribuições, num só feed.
            </p>
          </div>
          <div className="flex items-center gap-2 text-neutral-400">
            <GitHubIcon className="h-5 w-5" />
            <GitLabIcon className="h-5 w-5" />
            <span className="text-xs">e mais</span>
          </div>
        </div>

        {isDev ? (
          <form action={login} className="card flex flex-col gap-3 p-5">
            <label htmlFor="email" className="text-sm font-medium">
              Entrar por email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              placeholder="voce@exemplo.com"
              className="input"
            />
            <button type="submit" className="btn-primary w-full">
              Entrar
            </button>
            <p className="text-xs text-neutral-400">
              Login por email é apenas para desenvolvimento. Em produção, troque
              por magic-link ou OAuth de login.
            </p>
          </form>
        ) : (
          <div className="card p-5 text-sm text-red-500">
            Login de produção não configurado. Configure um provedor de login em{" "}
            <code>src/auth.ts</code>.
          </div>
        )}
      </div>
    </main>
  );
}
