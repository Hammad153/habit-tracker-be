import {
  wouldCreateStackCycle,
  resolveStackChain,
  StackEdge,
} from './stack.utils';

const edge = (habitId: string, stackAfterHabitId?: string | null): StackEdge => ({
  habitId,
  stackAfterHabitId,
});

describe('wouldCreateStackCycle', () => {
  const edges = [
    edge('brush-teeth', null),
    edge('read', 'brush-teeth'),
    edge('meditate', 'read'),
  ];

  it('accepts a valid new stack link', () => {
    expect(wouldCreateStackCycle(edges, 'journal', 'meditate')).toBe(false);
  });

  it('rejects a self reference', () => {
    expect(wouldCreateStackCycle(edges, 'read', 'read')).toBe(true);
    expect(wouldCreateStackCycle([], 'a', 'a')).toBe(true);
  });

  it('rejects a two-node cycle', () => {
    // read currently stacks after brush-teeth; making brush-teeth follow read closes A -> B -> A.
    expect(wouldCreateStackCycle(edges, 'brush-teeth', 'read')).toBe(true);
  });

  it('rejects a three-node cycle', () => {
    // meditate -> read -> brush-teeth exists; adding brush-teeth after meditate closes the loop.
    expect(wouldCreateStackCycle(edges, 'brush-teeth', 'meditate')).toBe(true);
  });

  it('rejects a longer cycle formed deep in the chain', () => {
    const longChain = [
      edge('a', null),
      edge('b', 'a'),
      edge('c', 'b'),
      edge('d', 'c'),
      edge('e', 'd'),
    ];
    expect(wouldCreateStackCycle(longChain, 'a', 'e')).toBe(true);
    expect(wouldCreateStackCycle(longChain, 'f', 'e')).toBe(false);
  });

  it('ignores the edge being replaced when re-pointing a habit', () => {
    // Re-pointing meditate from read to brush-teeth must not count as a cycle
    // just because meditate itself participates in a chain.
    expect(wouldCreateStackCycle(edges, 'meditate', 'brush-teeth')).toBe(false);
  });

  it('treats an over-deep chain as cyclic to fail safe', () => {
    const loop = Array.from({ length: 150 }, (_, i) =>
      edge(`h${i}`, i === 0 ? null : `h${i - 1}`),
    );
    // h0 following h149 would traverse the entire corrupted-length chain.
    expect(wouldCreateStackCycle(loop, 'h0', 'h149')).toBe(true);
  });
});

describe('resolveStackChain', () => {
  it('returns cues ordered oldest first with the habit last', () => {
    const edges = [edge('read', 'brush-teeth'), edge('meditate', 'read')];
    expect(resolveStackChain(edges, 'meditate')).toEqual([
      'brush-teeth',
      'read',
      'meditate',
    ]);
  });

  it('returns only the habit when nothing is stacked', () => {
    expect(resolveStackChain([], 'solo')).toEqual(['solo']);
  });
});
