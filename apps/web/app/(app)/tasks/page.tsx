import type { Provider } from "@devpulse/core";
import { auth } from "@/auth";
import { getWorkConnections } from "@/lib/queries";
import { TasksView, type TaskFilters } from "@/components/work/TasksView";
import { NoConnections, TasksHeader } from "./TasksHeader";

const PROVIDERS: Provider[] = ["GITHUB", "GITLAB", "AZURE"];

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string; state?: string; involvement?: string; q?: string }>;
}) {
  const session = await auth();
  const userId = session!.user.id;
  const sp = await searchParams;
  const connections = await getWorkConnections(userId);

  const initial: TaskFilters = {
    provider: PROVIDERS.includes(sp.provider as Provider) ? (sp.provider as Provider) : undefined,
    state: sp.state === "closed" || sp.state === "all" ? sp.state : "open",
    involvement: sp.involvement === "created" ? "created" : "assigned",
    q: sp.q ?? "",
  };

  return (
    <div className="flex flex-col gap-6">
      <TasksHeader active="list" />
      {connections.length === 0 ? (
        <NoConnections />
      ) : (
        <TasksView connections={connections} initial={initial} />
      )}
    </div>
  );
}
