"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const nav = [
  { href: "/feed", label: "Feed" },
  { href: "/heatmap", label: "Heatmap" },
  { href: "/connections", label: "Conexões" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 text-sm">
      {nav.map((n) => {
        const active = pathname === n.href;
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={
              "rounded-lg px-3 py-1.5 font-medium transition-colors " +
              (active
                ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100")
            }
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
