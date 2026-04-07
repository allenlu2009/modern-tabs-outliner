import { describe, it, expect } from 'vitest';
import { positionalWeave, calculateRestoreIndex } from '../src/utils';
import type { BaseNode } from '../src/types';

describe('positionalWeave algorithm', () => {
  it('preserves saved tabs while injecting newly ordered physical tabs', () => {
    // Array simulating: Node 1 (Crashed/Saved), Node 2 (Physical Slot), Node 3 (Physical Slot), Node 4 (Saved)
    const oldChildIds = ['saved-1', 'active-a', 'active-b', 'saved-2'];
    
    // Simulate user locally swapping Tab B and Tab A in Chrome
    const activeTabIds = ['active-b', 'active-a'];
    const nodesToRemove = new Set<string>();

    const output = positionalWeave(oldChildIds, activeTabIds, nodesToRemove);

    // The output MUST preserve saved-1 and saved-2 at outer boundaries, but swap active-b and active-a inwards
    expect(output).toEqual(['saved-1', 'active-b', 'active-a', 'saved-2']);
  });

  it('completely purges natively closed tabs from the ID pool', () => {
    const oldChildIds = ['saved-A', 'dying-tab', 'saved-B'];
    const activeTabIds: string[] = [];
    const nodesToRemove = new Set<string>(['dying-tab']);

    const output = positionalWeave(oldChildIds, activeTabIds, nodesToRemove);

    // The algorithm drops 'dying-tab' seamlessly
    expect(output).toEqual(['saved-A', 'saved-B']);
  });

  it('appends exclusively new Chrome tabs to the end of the tree list', () => {
    const oldChildIds = ['active-1'];
    // User opened a new tab natively
    const activeTabIds = ['active-1', 'new-tab-2'];
    const nodesToRemove = new Set<string>();

    const output = positionalWeave(oldChildIds, activeTabIds, nodesToRemove);

    expect(output).toEqual(['active-1', 'new-tab-2']);
  });
});

describe('calculateRestoreIndex logic offset', () => {
  it('correctly calculates the physical index for restored tabs based on open precedents', () => {
    // Simulated Tree Sequence:
    // 0: Tab A (open) -> Physical Index 0
    // 1: Tab B (saved) -> (skipped)
    // 2: Tab C (open) -> Physical Index 1
    // 3: Tab TARGET (saved) -> Expected Physical Restore Index 2
    // 4: Tab D (open) -> Physical Index 2 (will be shifted to 3)

    const parentChildIds = ['tab-a', 'tab-b', 'tab-c', 'tab-target', 'tab-d'];
    const nodeMap = new Map<string, BaseNode>([
      ['tab-a', { id: 'tab-a', status: 'open' } as BaseNode],
      ['tab-b', { id: 'tab-b', status: 'saved' } as BaseNode],
      ['tab-c', { id: 'tab-c', status: 'open' } as BaseNode],
      ['tab-target', { id: 'tab-target', status: 'saved' } as BaseNode],
      ['tab-d', { id: 'tab-d', status: 'open' } as BaseNode]
    ]);

    const resultIndex = calculateRestoreIndex('tab-target', parentChildIds, nodeMap);
    
    // There are EXACTLY two 'open' tabs prior to 'tab-target'
    expect(resultIndex).toBe(2);
  });

  it('returns exactly 0 if restoring to the very top of a window', () => {
    const parentChildIds = ['tab-target', 'tab-1'];
    const nodeMap = new Map<string, BaseNode>([
      ['tab-target', { id: 'tab-target', status: 'saved' } as BaseNode],
      ['tab-1', { id: 'tab-1', status: 'open' } as BaseNode]
    ]);

    const resultIndex = calculateRestoreIndex('tab-target', parentChildIds, nodeMap);
    expect(resultIndex).toBe(0);
  });
});
