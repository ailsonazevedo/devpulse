import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { isDev } from "@/env";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user?.id) redirect("/feed");

  async function login(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "");
    await signIn("dev-email", { email, redirectTo: "/feed" });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">DevPulse</h1>
        <p className="text-sm text-neutral-500">
          Feed unificado das suas contribuições em GitHub, GitLab e mais.
        </p>
      </div>

      {isDev ? (
        <form action={login} className="flex flex-col gap-3">
          <label className="text-sm font-medium">Entrar (dev) por email</label>
          <input
            name="email"
            type="email"
            required
            placeholder="voce@exemplo.com"
            className="rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700"
          >
            Entrar
          </button>
          <p className="text-xs text-neutral-400">
            Login por email é apenas para desenvolvimento. Em produção, troque por
            magic-link ou OAuth de login.
          </p>
        </form>
      ) : (
        <p className="text-sm text-red-500">
          Login de produção não configurado. Configure um provedor de login em
          <code> src/auth.ts</code>.
        </p>
      )}
    </main>
  );
}
