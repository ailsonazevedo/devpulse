import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";

const nav = [
  { href: "/feed", label: "Feed" },
  { href: "/heatmap", label: "Heatmap" },
  { href: "/connections", label: "Conexões" },
];

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
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <header className="mb-6 flex items-center justify-between border-b border-neutral-200 pb-4 dark:border-neutral-800">
        <div className="flex items-center gap-6">
          <Link href="/feed" className="text-lg font-bold">
            DevPulse
          </Link>
          <nav className="flex gap-4 text-sm">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-neutral-500 sm:inline">
            {session.user.email}
          </span>
          <form action={logout}>
            <button className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
              Sair
            </button>
          </form>
        </div>
      </header>
      {children}
    </div>
  );
}
