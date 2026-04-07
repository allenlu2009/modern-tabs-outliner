import type { BaseNode } from "./types";

/**
 * Positional Weave Algorithm
 * Interweaves live physical Chrome tabs seamlessly back into historical nested Outliner child slots.
 */
export function positionalWeave(
  oldChildIds: string[],
  activeTabIds: string[],
  nodesToRemove: Set<string>
): string[] {
  const finalChildIds: string[] = [];
  const activeTabsToInsert = [...activeTabIds];
  
  for (const oldId of oldChildIds) {
    if (nodesToRemove.has(oldId)) {
        continue;
    }
    if (activeTabIds.includes(oldId)) {
        if (activeTabsToInsert.length > 0) {
            finalChildIds.push(activeTabsToInsert.shift()!);
        }
    } else {
        finalChildIds.push(oldId);
    }
  }
  
  for (const remainingId of activeTabsToInsert) {
    finalChildIds.push(remainingId);
  }
  
  return finalChildIds;
}

/**
 * Calculates the precise physical Chrome array index mapping for a node being revived.
 * By iterating through the visual hierarchy and observing the 'open' states logically,
 * we intercept Chrome's destructive append-to-back defaults natively.
 */
export function calculateRestoreIndex(
  targetNodeId: string,
  parentChildIds: string[],
  nodeMap: Map<string, BaseNode>
): number | undefined {
  const pos = parentChildIds.indexOf(targetNodeId);
  if (pos === -1) return undefined;

  let openCount = 0;
  for (let i = 0; i < pos; i++) {
    const siblingId = parentChildIds[i];
    const sibling = nodeMap.get(siblingId);
    if (sibling && sibling.status === 'open') {
      openCount++;
    }
  }
  return openCount;
}

export function generateId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID 
    ? crypto.randomUUID() 
    : Math.random().toString(36).substring(2) + Date.now().toString(36);
}
