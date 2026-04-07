import { describe, it, expect } from 'vitest';
import { positionalWeave } from '../src/utils';

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
