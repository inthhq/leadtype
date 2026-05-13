"use client";

import { usePathname, useRouter } from "next/navigation";

const frameworks = [
  { id: "next", label: "Next.js" },
  { id: "react", label: "React" },
  { id: "javascript", label: "JavaScript" },
] as const;

type FrameworkId = (typeof frameworks)[number]["id"];

const frameworkRoutePattern =
  /^\/docs\/frameworks\/(next|react|javascript)(\/(.*))?$/;

function suffixFromPath(pathname: string): {
  framework: FrameworkId;
  suffix: string;
} | null {
  const match = pathname.match(frameworkRoutePattern);
  if (!match) {
    return null;
  }
  return {
    framework: match[1] as FrameworkId,
    suffix: match[3] ?? "quickstart",
  };
}

interface FrameworkSwitcherProps {
  /** Routes that exist for each framework; passed in from a server component. */
  knownRoutes: Set<string>;
}

export function FrameworkSwitcher({ knownRoutes }: FrameworkSwitcherProps) {
  const pathname = usePathname();
  const router = useRouter();
  const current = suffixFromPath(pathname);

  // Only show on /docs/frameworks/* routes.
  if (!current) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1 rounded-md border p-2 text-sm">
      <span className="px-1 text-xs uppercase tracking-wide opacity-60">
        Framework
      </span>
      <div className="flex gap-1">
        {frameworks.map(({ id, label }) => {
          const preferred = `/docs/frameworks/${id}/${current.suffix}`;
          const fallback = `/docs/frameworks/${id}/quickstart`;
          const target = knownRoutes.has(preferred) ? preferred : fallback;
          const isActive = id === current.framework;
          return (
            <button
              aria-pressed={isActive}
              className={`flex-1 rounded-sm border px-2 py-1 text-xs ${
                isActive
                  ? "border-fd-foreground/30 bg-fd-accent"
                  : "border-transparent hover:bg-fd-accent/60"
              }`}
              key={id}
              onClick={() => router.push(target)}
              type="button"
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
