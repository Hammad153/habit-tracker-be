/**
 * Habit stacking cycle detection.
 *
 * A stack is a functional graph: each habit points at most one habit it
 * follows (stackAfterHabitId). "A -> B" means "after A I do B" is stored as
 * B.stackAfterHabitId = A.id.
 *
 * These helpers are pure so they can be unit tested without a database.
 */

export type StackEdge = {
  habitId: string;
  stackAfterHabitId: string | null | undefined;
};

export const MAX_STACK_DEPTH = 100;

/**
 * Walks the existing chain starting at `proposedParent` and reports whether
 * adding the edge `habitId -> proposedParent` would close a cycle.
 *
 * Example: existing B -> A. Adding A -> B: walk from B and we reach A, so
 * this returns true.
 */
export const wouldCreateStackCycle = (
  edges: StackEdge[],
  habitId: string,
  proposedParentId: string,
): boolean => {
  if (!habitId || !proposedParentId) return false;
  if (habitId === proposedParentId) return true;

  const nextAfter = new Map<string, string>();
  for (const edge of edges) {
    if (edge.habitId === habitId) continue; // the edge being replaced/created
    if (edge.stackAfterHabitId) {
      nextAfter.set(edge.habitId, edge.stackAfterHabitId);
    }
  }

  let current = proposedParentId;
  for (let depth = 0; depth < MAX_STACK_DEPTH; depth++) {
    if (current === habitId) return true;
    const next = nextAfter.get(current);
    if (!next) return false;
    // Defensive: a corrupted chain containing its own tail must not loop.
    if (next === current) return false;
    current = next;
  }
  // Depth exceeded: treat as cyclic to fail safe.
  return true;
};

/**
 * Resolves the full cue chain for a habit, e.g. [wake up] -> [coffee] ->
 * [read]. Returns habit ids ordered from the oldest cue to the habit itself
 * (`forHabitId` last).
 */
export const resolveStackChain = (
  edges: StackEdge[],
  forHabitId: string,
): string[] => {
  const parentOf = new Map<string, string>();
  for (const edge of edges) {
    if (edge.stackAfterHabitId) parentOf.set(edge.habitId, edge.stackAfterHabitId);
  }

  const chain: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = forHabitId;
  while (current && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = parentOf.get(current);
  }
  return chain.reverse();
};
