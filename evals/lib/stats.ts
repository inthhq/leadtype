const WILSON_Z_95 = 1.96;

export type Aggregate = {
  n: number;
  passes: number;
  /** passes / n */
  rate: number;
  /** Wilson 95% score interval [low, high], each in [0, 1]. */
  ci95: [number, number];
};

/**
 * Wilson score interval for a binomial proportion. Preferred over the normal
 * approximation here because n per cell is small (10) and pass rates often sit
 * near 0 or 1, where the naive interval breaks down.
 */
export function wilsonInterval(
  passes: number,
  n: number,
  z = WILSON_Z_95
): [number, number] {
  if (n === 0) {
    return [0, 0];
  }
  const phat = passes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (phat + z2 / (2 * n)) / denom;
  const margin =
    (z * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n)) / denom;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

export function aggregateCounts(passes: number, n: number): Aggregate {
  return {
    n,
    passes,
    rate: n === 0 ? 0 : passes / n,
    ci95: wilsonInterval(passes, n),
  };
}

export function aggregate(outcomes: boolean[]): Aggregate {
  return aggregateCounts(outcomes.filter(Boolean).length, outcomes.length);
}

export function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function formatPct(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`;
}

export function formatCi(ci: [number, number]): string {
  return `[${(ci[0] * 100).toFixed(0)}–${(ci[1] * 100).toFixed(0)}%]`;
}
