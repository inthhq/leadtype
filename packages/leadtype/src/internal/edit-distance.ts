/**
 * Bounded Levenshtein distance, shared by search's typo tolerance and the
 * config loader's did-you-mean suggestions. Bounded because both callers only
 * ever ask "is this within N edits?" — computing the exact distance for
 * far-apart strings is wasted work, so rows short-circuit once every cell
 * exceeds the bound.
 */
export function editDistanceWithin(
  left: string,
  right: string,
  maxDistance: number
): boolean {
  if (Math.abs(left.length - right.length) > maxDistance) {
    return false;
  }

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = current[0] ?? leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      const deletion = (previous[rightIndex] ?? 0) + 1;
      const insertion = (current[rightIndex - 1] ?? 0) + 1;
      const substitution = (previous[rightIndex - 1] ?? 0) + substitutionCost;
      const value = Math.min(deletion, insertion, substitution);
      current[rightIndex] = value;
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maxDistance) {
      return false;
    }
    previous = current;
  }

  return (previous[right.length] ?? Number.POSITIVE_INFINITY) <= maxDistance;
}
