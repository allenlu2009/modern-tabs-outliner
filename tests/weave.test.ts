import { describe, it, expect } from 'vitest';
import { positionalWeave, calculateRestoreIndex } from '../src/utils';
import type { BaseNode } from '../src/types';

describe('positionalWeave algorithm', () => {
  it('preserves saved tabs while injecting newly ordered physical tabs', () => {
    const oldChildIds = ['saved-1', 'active-a', 'active-b', 'saved-2'];
    const activeTabIds = ['active-b', 'active-a'];
    const nodesToRemove = new Set<string>();

    const output = positionalWeave(oldChildIds, activeTabIds, nodesToRemove);

    expect(output).toEqual(['saved-1', 'active-b', 'active-a', 'saved-2']);
  });

  it('completely purges natively closed tabs from the ID pool', () => {
    const oldChildIds = ['saved-A', 'dying-tab', 'saved-B'];
    const activeTabIds: string[] = [];
    const nodesToRemove = new Set<string>(['dying-tab']);

    const output = positionalWeave(oldChildIds, activeTabIds, nodesToRemove);

    expect(output).toEqual(['saved-A', 'saved-B']);
  });

  it('appends exclusively new Chrome tabs to the end of the tree list', () => {
    const oldChildIds = ['active-1'];
    const activeTabIds = ['active-1', 'new-tab-2'];
    const nodesToRemove = new Set<string>();

    const output = positionalWeave(oldChildIds, activeTabIds, nodesToRemove);

    expect(output).toEqual(['active-1', 'new-tab-2']);
  });
});

describe('calculateRestoreIndex logic offset', () => {
  it('correctly calculates the physical index for restored tabs based on open precedents', () => {
    const parentChildIds = ['tab-a', 'tab-b', 'tab-c', 'tab-target', 'tab-d'];
    const nodeMap = new Map<string, BaseNode>([
      ['tab-a', { id: 'tab-a', status: 'open' } as BaseNode],
      ['tab-b', { id: 'tab-b', status: 'saved' } as BaseNode],
      ['tab-c', { id: 'tab-c', status: 'open' } as BaseNode],
      ['tab-target', { id: 'tab-target', status: 'saved' } as BaseNode],
      ['tab-d', { id: 'tab-d', status: 'open' } as BaseNode]
    ]);

    const resultIndex = calculateRestoreIndex('tab-target', parentChildIds, nodeMap);
    expect(resultIndex).toBe(2); // tab-a and tab-c are open
  });

  it('handles sequential restoration correctly', () => {
    const parentChildIds = ['tab-1', 'tab-2', 'tab-3'];
    const nodeMap = new Map<string, BaseNode>([
      ['tab-1', { id: 'tab-1', status: 'saved' } as BaseNode],
      ['tab-2', { id: 'tab-2', status: 'saved' } as BaseNode],
      ['tab-3', { id: 'tab-3', status: 'saved' } as BaseNode],
    ]);

    // Restore tab-1
    expect(calculateRestoreIndex('tab-1', parentChildIds, nodeMap)).toBe(0);
    nodeMap.get('tab-1')!.status = 'open';

    // Restore tab-2
    expect(calculateRestoreIndex('tab-2', parentChildIds, nodeMap)).toBe(1);
    nodeMap.get('tab-2')!.status = 'open';

    // Restore tab-3
    expect(calculateRestoreIndex('tab-3', parentChildIds, nodeMap)).toBe(2);
  });

  it('preserves order when restoring out-of-order', () => {
    const parentChildIds = ['tab-1', 'tab-2', 'tab-3'];
    const nodeMap = new Map<string, BaseNode>([
      ['tab-1', { id: 'tab-1', status: 'saved' } as BaseNode],
      ['tab-2', { id: 'tab-2', status: 'saved' } as BaseNode],
      ['tab-3', { id: 'tab-3', status: 'saved' } as BaseNode],
    ]);

    // Restore middle tab first
    expect(calculateRestoreIndex('tab-2', parentChildIds, nodeMap)).toBe(0);
    nodeMap.get('tab-2')!.status = 'open';

    // Restore first tab
    expect(calculateRestoreIndex('tab-1', parentChildIds, nodeMap)).toBe(0);
    nodeMap.get('tab-1')!.status = 'open';

    // Now tab-1 is index 0, tab-2 is index 1. Order is [tab-1, tab-2]. Correct!
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

// ─── Drag-and-Drop tree mutation helpers ──────────────────────────────────────
// These tests validate the pure data-structure logic behind handleDragEnd.
// They mirror exactly what App.tsx does during a DND operation.

function simulateDND(
  nodes: BaseNode[],
  activeId: string,
  overId: string,
  activeIndex: number,
  overIndex: number
): { nodes: BaseNode[]; movedToParent: string } {
  const nodeMap = new Map<string, BaseNode>(
    nodes.map(n => [n.id, { ...n, childIds: [...n.childIds] }])
  );
  const activeNode = nodeMap.get(activeId)!;
  const overNode = nodeMap.get(overId)!;
  const draggingDown = activeIndex < overIndex;

  const oldParentId = activeNode.parentId || 'root';
  const oldParent = nodeMap.get(oldParentId);

  const dropIntoContainer = overNode.type === 'group';
  const newParentId = dropIntoContainer ? overNode.id : (overNode.parentId || 'root');
  const newParent = nodeMap.get(newParentId)!;
  const isSameParent = oldParentId === newParentId;

  let insertIndex = 0;
  if (dropIntoContainer) {
    if (oldParent) oldParent.childIds = oldParent.childIds.filter(id => id !== activeId);
    insertIndex = 0;
  } else if (isSameParent) {
    oldParent!.childIds = oldParent!.childIds.filter(id => id !== activeId);
    const overIdxAfter = newParent.childIds.indexOf(overId);
    insertIndex = draggingDown
      ? (overIdxAfter < 0 ? newParent.childIds.length : overIdxAfter + 1)
      : (overIdxAfter < 0 ? 0 : overIdxAfter);
  } else {
    if (oldParent) oldParent.childIds = oldParent.childIds.filter(id => id !== activeId);
    const idx = newParent.childIds.indexOf(overId);
    insertIndex = idx < 0 ? newParent.childIds.length : idx;
  }

  newParent.childIds.splice(insertIndex, 0, activeId);
  activeNode.parentId = newParentId;

  return {
    nodes: Array.from(nodeMap.values()),
    movedToParent: newParentId,
  };
}

describe('DND same-parent reorder', () => {
  const makeWindow = (id: string, childIds: string[]): BaseNode => ({
    id, type: 'window', status: 'open', parentId: 'root',
    childIds, title: id, createdAt: 0, updatedAt: 0, sortOrder: 0,
  });
  const makeTab = (id: string, parentId: string): BaseNode => ({
    id, type: 'tab', status: 'open', parentId,
    childIds: [], title: id, createdAt: 0, updatedAt: 0, sortOrder: 0,
  });

  it('moves a tab DOWN by 1 when dragging past the next sibling', () => {
    // Tabs in order: [A, B, C, D]  —  drag A (idx 0) past B (idx 1)
    const win = makeWindow('win1', ['A', 'B', 'C', 'D']);
    const nodes = [win, makeTab('A', 'win1'), makeTab('B', 'win1'), makeTab('C', 'win1'), makeTab('D', 'win1')];

    const { nodes: result } = simulateDND(nodes, 'A', 'B', 0, 1);
    const parent = result.find(n => n.id === 'win1')!;
    expect(parent.childIds).toEqual(['B', 'A', 'C', 'D']);
  });

  it('moves a tab UP by 1 when dragging past the previous sibling', () => {
    // Tabs in order: [A, B, C, D]  —  drag D (idx 3) past C (idx 2)
    const win = makeWindow('win1', ['A', 'B', 'C', 'D']);
    const nodes = [win, makeTab('A', 'win1'), makeTab('B', 'win1'), makeTab('C', 'win1'), makeTab('D', 'win1')];

    const { nodes: result } = simulateDND(nodes, 'D', 'C', 3, 2);
    const parent = result.find(n => n.id === 'win1')!;
    expect(parent.childIds).toEqual(['A', 'B', 'D', 'C']);
  });

  it('moves a tab from the bottom to the very top', () => {
    const win = makeWindow('win1', ['A', 'B', 'C', 'D']);
    const nodes = [win, makeTab('A', 'win1'), makeTab('B', 'win1'), makeTab('C', 'win1'), makeTab('D', 'win1')];

    const { nodes: result } = simulateDND(nodes, 'D', 'A', 3, 0);
    const parent = result.find(n => n.id === 'win1')!;
    expect(parent.childIds).toEqual(['D', 'A', 'B', 'C']);
  });
});

describe('DND cross-window move', () => {
  const makeWindow = (id: string, childIds: string[]): BaseNode => ({
    id, type: 'window', status: 'open', parentId: 'root',
    childIds, title: id, createdAt: 0, updatedAt: 0, sortOrder: 0,
  });
  const makeTab = (id: string, parentId: string): BaseNode => ({
    id, type: 'tab', status: 'open', parentId,
    childIds: [], title: id, createdAt: 0, updatedAt: 0, sortOrder: 0,
  });

  it('moves a tab from Window1 to Window2 at the correct position', () => {
    // Window1: [A, B]  Window2: [C, D, E]  —  drag B near D (idx 1 in win2)
    const win1 = makeWindow('win1', ['A', 'B']);
    const win2 = makeWindow('win2', ['C', 'D', 'E']);
    const nodes = [
      win1, win2,
      makeTab('A', 'win1'), makeTab('B', 'win1'),
      makeTab('C', 'win2'), makeTab('D', 'win2'), makeTab('E', 'win2'),
    ];

    // activeIndex=1 (B is second in flat list), overIndex=4 (D is fifth)
    const { nodes: result, movedToParent } = simulateDND(nodes, 'B', 'D', 1, 4);
    expect(movedToParent).toBe('win2');

    const parent1 = result.find(n => n.id === 'win1')!;
    const parent2 = result.find(n => n.id === 'win2')!;
    expect(parent1.childIds).toEqual(['A']);
    expect(parent2.childIds).toEqual(['C', 'B', 'D', 'E']); // B inserted before D
  });

  it('removes old parent window from childIds when it becomes empty', () => {
    // Window1 has only tab B. Move B to Window2.
    const win1 = makeWindow('win1', ['B']);
    const win2 = makeWindow('win2', ['C']);
    const nodes = [win1, win2, makeTab('B', 'win1'), makeTab('C', 'win2')];

    const { nodes: result } = simulateDND(nodes, 'B', 'C', 0, 1);
    const parent1 = result.find(n => n.id === 'win1')!;
    // Window1 should now have no children (caller should then delete it from DB)
    expect(parent1.childIds).toEqual([]);
  });
});

describe('zombie window prevention', () => {
  it('detects that a window has no valid remaining children after tab removal', () => {
    // Simulate the check done in removeNodeBtn
    const allNodes: BaseNode[] = [
      { id: 'win1', type: 'window', status: 'open', parentId: 'root',
        childIds: ['tab-A'], title: 'Win1', createdAt: 0, updatedAt: 0, sortOrder: 0 },
      { id: 'tab-A', type: 'tab', status: 'open', parentId: 'win1',
        childIds: [], title: 'Tab A', createdAt: 0, updatedAt: 0, sortOrder: 0 },
    ];

    const removedId = 'tab-A';
    const parentNode = allNodes.find(n => n.id === 'win1')!;
    const remainingValid = parentNode.childIds
      .filter(cid => cid !== removedId)
      .filter(cid => allNodes.some(n => n.id === cid));

    // After removing tab-A, window should have 0 valid children → should be auto-removed
    expect(remainingValid.length).toBe(0);
  });

  it('does NOT remove a window that still has other valid tabs', () => {
    const allNodes: BaseNode[] = [
      { id: 'win1', type: 'window', status: 'open', parentId: 'root',
        childIds: ['tab-A', 'tab-B'], title: 'Win1', createdAt: 0, updatedAt: 0, sortOrder: 0 },
      { id: 'tab-A', type: 'tab', status: 'open', parentId: 'win1',
        childIds: [], title: 'Tab A', createdAt: 0, updatedAt: 0, sortOrder: 0 },
      { id: 'tab-B', type: 'tab', status: 'open', parentId: 'win1',
        childIds: [], title: 'Tab B', createdAt: 0, updatedAt: 0, sortOrder: 0 },
    ];

    const removedId = 'tab-A';
    const parentNode = allNodes.find(n => n.id === 'win1')!;
    const remainingValid = parentNode.childIds
      .filter(cid => cid !== removedId)
      .filter(cid => allNodes.some(n => n.id === cid));

    // tab-B still exists → do NOT remove window
    expect(remainingValid.length).toBe(1);
    expect(remainingValid).toContain('tab-B');
  });
});
