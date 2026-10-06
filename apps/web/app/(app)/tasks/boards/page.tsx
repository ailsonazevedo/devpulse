import { auth } from "@/auth";
import { getWorkConnections } from "@/lib/queries";
import { BoardsView } from "@/components/work/BoardsView";
import { NoConnections, TasksHeader } from "../TasksHeader";

export default async function BoardsPage({
  searchParams,
}: {
  searchParams: Promise<{ connection?: string; board?: string }>;
}) {
  const session = await auth();
  const userId = session!.user.id;
  const sp = await searchParams;
  const connections = await getWorkConnections(userId);

  return (
    <div className="flex flex-col gap-6">
      <TasksHeader active="boards" />
      {connections.length === 0 ? (
        <NoConnections />
      ) : (
        <BoardsView
          connections={connections}
          initialConnection={sp.connection}
          initialBoard={sp.board}
        />
      )}
    </div>
  );
}
