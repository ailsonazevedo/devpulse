import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { NavLinks } from "@/components/NavLinks";
import { QueryProvider } from "@/components/QueryProvider";
import { LogOutIcon, LogoMark } from "@/components/icons";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-neutral-50/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-6">
            <Link href="/feed" className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900 text-white dark:bg-white dark:text-neutral-900">
                <LogoMark className="h-5 w-5" />
              </span>
              <span className="text-base font-semibold tracking-tight">
                DevPulse
              </span>
            </Link>
            <NavLinks />
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-neutral-500 sm:inline">
              {session.user.email}
            </span>
            <form action={logout}>
              <button
                type="submit"
                title="Sair"
                className="btn-ghost px-2.5 py-1.5"
              >
                <LogOutIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Sair</span>
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <QueryProvider>{children}</QueryProvider>
      </main>
    </div>
  );
}
