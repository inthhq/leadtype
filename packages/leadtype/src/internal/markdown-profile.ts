type ProfileStat = {
  count: number;
  totalMs: number;
};

const PROFILE_ENABLED = process.env.LEADTYPE_MARKDOWN_PROFILE === "1";
const profileStats = new Map<string, ProfileStat>();
let exitHookRegistered = false;

export function isMarkdownProfileEnabled(): boolean {
  return PROFILE_ENABLED;
}

export function recordMarkdownProfile(name: string, elapsedMs: number): void {
  if (!PROFILE_ENABLED) {
    return;
  }
  const stat = profileStats.get(name) ?? { count: 0, totalMs: 0 };
  stat.count += 1;
  stat.totalMs += elapsedMs;
  profileStats.set(name, stat);
  registerExitHook();
}

function registerExitHook(): void {
  if (exitHookRegistered) {
    return;
  }
  exitHookRegistered = true;
  process.once("beforeExit", () => {
    if (profileStats.size === 0) {
      return;
    }
    const rows = Array.from(profileStats, ([name, stat]) => ({
      avgMs: stat.totalMs / stat.count,
      count: stat.count,
      name,
      totalMs: stat.totalMs,
    })).sort((left, right) => right.totalMs - left.totalMs);

    process.stderr.write("\nleadtype markdown profile\n");
    process.stderr.write("name\tcount\ttotalMs\tavgMs\n");
    for (const row of rows) {
      process.stderr.write(
        `${row.name}\t${row.count}\t${row.totalMs.toFixed(2)}\t${row.avgMs.toFixed(2)}\n`
      );
    }
  });
}
