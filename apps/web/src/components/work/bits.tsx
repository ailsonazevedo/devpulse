import type { WorkState, WorkUser } from "@devpulse/core/work";

export function StateBadge({ state, raw }: { state: WorkState; raw: string }) {
  return (
    <span
      title={raw}
      className={
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium " +
        (state === "open"
          ? "bg-green-50 text-green-700 dark:bg-green-950/50 dark:text-green-300"
          : "bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300")
      }
    >
      <span
        className={"h-1.5 w-1.5 rounded-full " + (state === "open" ? "bg-green-500" : "bg-violet-500")}
      />
      {raw}
    </span>
  );
}

export function LabelChips({ labels, max }: { labels: string[]; max?: number }) {
  const shown = max ? labels.slice(0, max) : labels;
  const rest = labels.length - shown.length;
  if (labels.length === 0) return null;
  return (
    <span className="flex shrink-0 flex-wrap items-center gap-1">
      {shown.map((l) => (
        <span
          key={l}
          className="rounded-full border border-neutral-200 px-1.5 py-px text-[10px] font-medium text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
        >
          {l}
        </span>
      ))}
      {rest > 0 && <span className="text-[10px] text-neutral-400">+{rest}</span>}
    </span>
  );
}

export function Avatars({ users }: { users: WorkUser[] }) {
  if (users.length === 0) return null;
  return (
    <span className="flex shrink-0 -space-x-1.5" title={users.map((u) => u.name ?? u.login).join(", ")}>
      {users.slice(0, 3).map((u) =>
        u.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={u.login}
            src={u.avatarUrl}
            alt=""
            className="h-6 w-6 rounded-full border-2 border-white object-cover dark:border-neutral-900"
          />
        ) : (
          <span
            key={u.login}
            className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-neutral-200 text-[10px] font-semibold uppercase text-neutral-600 dark:border-neutral-900 dark:bg-neutral-700 dark:text-neutral-200"
          >
            {(u.name ?? u.login).slice(0, 1)}
          </span>
        ),
      )}
    </span>
  );
}
