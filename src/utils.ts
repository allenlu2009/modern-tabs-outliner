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
