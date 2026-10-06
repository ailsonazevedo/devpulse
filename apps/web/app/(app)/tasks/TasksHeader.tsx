import Link from "next/link";

/** Título + abas Lista/Boards das telas de tarefas. */
export function TasksHeader({ active }: { active: "list" | "boards" }) {
  const tab = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={
        "border-b-2 px-1 pb-2 text-sm font-medium transition-colors " +
        (on
          ? "border-neutral-900 text-neutral-900 dark:border-white dark:text-white"
          : "border-transparent text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100")
      }
    >
      {label}
    </Link>
  );
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Tarefas</h1>
        <p className="text-sm text-neutral-500">
          Issues, work items e boards das suas contas conectadas — direto do provedor.
        </p>
      </div>
      <nav className="flex gap-4 border-b border-neutral-200 dark:border-neutral-800">
        {tab("/tasks", "Lista", active === "list")}
        {tab("/tasks/boards", "Boards", active === "boards")}
      </nav>
    </div>
  );
}

export function NoConnections() {
  return (
    <div className="card flex flex-col items-center gap-3 border-dashed p-10 text-center">
      <p className="text-sm text-neutral-500">
        Conecte o GitHub, GitLab ou Azure DevOps para ver e gerenciar suas tarefas.
      </p>
      <Link href="/connections" className="btn-primary">
        Conectar serviço
      </Link>
    </div>
  );
}
