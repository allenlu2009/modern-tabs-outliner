import type { BaseNode } from "./types";
import { putNodes, getAllNodes, putNode, removeNode, clearAllNodes } from "./storage";
import { positionalWeave, calculateRestoreIndex, generateId } from "./utils";

let outlinerWindowId: number | null = null;
let pauseReconcile = false;
const intentionallySavedNodes = new Set<string>();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "INTENTIONAL_SAVE") {
    intentionallySavedNodes.add(msg.nodeId);
    return false;
  }
  if (msg.type === "RESTORE_NODE") {
    pauseReconcile = true;
    (async () => {
      try {
        const nodes = await getAllNodes();
        const nodeMap = new Map(nodes.map(n => [n.id, n]));
        const node = nodeMap.get(msg.nodeId);
        if (!node) throw new Error("Restoring node find failed");

        const openWindows = await chrome.windows.getAll();

        if (node.type === "window") {
            // Restore a full window (currently just creates the browser window)
            chrome.windows.create({ focused: true }, async (win) => {
                node.browserWindowId = win!.id;
                node.status = "open";
                node.updatedAt = Date.now();
                await putNode(node);
                pauseReconcile = false;
                safeReconcile();
            });
            return;
        }

        // --- Tab Restoration Logic ---
        let targetWindowId = node.browserWindowId;
        let isWinOpen = openWindows.some(w => w.id === targetWindowId);

        // If specific window isn't open, check if it has a saved parent window we should restore
        if (!isWinOpen && node.parentId) {
          const parent = nodeMap.get(node.parentId);
          if (parent && parent.type === "window") {
            const isParentOpen = openWindows.some(w => w.id === parent.browserWindowId);
            if (!isParentOpen) {
              // Create new window for this saved parent
              const newWin = await chrome.windows.create({ focused: true });
              parent.browserWindowId = newWin.id;
              parent.status = "open";
              parent.updatedAt = Date.now();
              await putNode(parent);
              targetWindowId = newWin.id;
              isWinOpen = true;
            } else {
              targetWindowId = parent.browserWindowId;
              isWinOpen = true;
            }
          }
        }

        // Final fallback: use any normal window if we still don't have a target
        if (!isWinOpen) {
          targetWindowId = openWindows.find(w => w.type === 'normal')?.id;
        }

        // Deep Index Calculation ensures strict outliner insertion
        let calculatedIndex: number | undefined = undefined;
        if (node.parentId) {
          const parent = nodeMap.get(node.parentId);
          if (parent && parent.childIds) {
            calculatedIndex = calculateRestoreIndex(node.id, parent.childIds, nodeMap);
          }
        }

        chrome.tabs.create({ url: msg.url, windowId: targetWindowId, index: calculatedIndex, active: true }, async (t) => {
          try {
            node.browserTabId = t.id;
            node.browserWindowId = t.windowId;
            node.status = "open";
            node.active = true;
            await putNode(node);
          } catch (err) {
            console.error(err);
          } finally {
            pauseReconcile = false;
            safeReconcile();
          }
        });
      } catch (err) {
         console.error(err);
         pauseReconcile = false;
         safeReconcile();
      }
    })();
    return false;
  }

  if (msg.type === "TAB_MOVED_UI") {
    pauseReconcile = true;
    chrome.tabs.move(msg.tabId, { windowId: msg.windowId, index: msg.index }, () => {
       pauseReconcile = false;
       safeReconcile();
    });
    return false;
  }
});

chrome.action.onClicked.addListener(async () => {
  if (outlinerWindowId !== null) {
    try {
      await chrome.windows.update(outlinerWindowId, { focused: true });
      return;
    } catch (e) {
      outlinerWindowId = null;
    }
  }
  
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('index.html'),
    type: 'popup',
    width: 420,
    height: 800,
    top: 50,
    left: 50,
    focused: true
  });
  
  if (win.id) {
    outlinerWindowId = win.id;
  }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  if (windowId === outlinerWindowId) {
    outlinerWindowId = null;
  }
});

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("Extension installed and initialized.");
  if (details.reason === "update" || details.reason === "install") {
     console.log("Developer Reload Detected: Wiping stale IDB cache to rebuild from absolute browser state...");
     await clearAllNodes();
  }
  await reconcileTabs();
});

// Broadcast changes to the React App
function broadcastUpdate() {
  chrome.runtime.sendMessage({ type: "TREE_UPDATED" }).catch(() => {});
}

async function reconcileTabs() {
  const windows = await chrome.windows.getAll({ populate: true });
  const nodesToSave: BaseNode[] = [];
  const now = Date.now();

  const activeWindowIds = new Set(windows.map(w => w.id));
  const activeTabIds = new Set(windows.flatMap(w => (w.tabs || []).map(t => t.id)));

  // 1. Fetch existing nodes from IndexedDB
  const existingNodes = await getAllNodes();
  const nodeMap = new Map(existingNodes.map(n => [n.id, n]));

  // Create lookups to securely match stable nodes across sessions
  const winByBrowserId = new Map(existingNodes.filter(n => n.type === 'window' && n.browserWindowId).map(n => [n.browserWindowId, n]));
  const tabByBrowserId = new Map(existingNodes.filter(n => n.type === 'tab' && n.browserTabId).map(n => [n.browserTabId, n]));

  // 2. Mark previously "open" nodes that no longer exist as "crashed" or "saved"
  const nodesToRemove = new Set<string>();
  
  for (const node of existingNodes) {
    if (node.status === "open") {
      if (node.type === "window" && node.browserWindowId && !activeWindowIds.has(node.browserWindowId)) {
        if (intentionallySavedNodes.has(node.id)) {
          node.status = "saved";
          nodesToSave.push(node);
          intentionallySavedNodes.delete(node.id);
        } else {
          // If a window is missing from the browser, only mark it as 'crashed' if it has open tabs.
          // If it's empty, or only has saved/closed nodes, we might remove it unless it was intentional.
          const childrenIds = node.childIds || [];
          const hasOpenChildren = childrenIds.some(id => {
            const child = nodeMap.get(id);
            return child && child.status === "open" && !nodesToRemove.has(id);
          });

          // Check for any children that exist at all (open, saved, or crashed) and aren't being removed
          const hasAnyChildren = childrenIds.some(id => {
            const child = nodeMap.get(id);
            return child && !nodesToRemove.has(id);
          });

          if (!hasAnyChildren) {
            nodesToRemove.add(node.id);
          } else if (hasOpenChildren) {
            node.status = "crashed";
            nodesToSave.push(node);
          } else {
            // Window is closed but has 'saved' children - mark window as saved too
            node.status = "saved";
            nodesToSave.push(node);
          }
        }
      } else if (node.type === "tab" && node.browserTabId && !activeTabIds.has(node.browserTabId)) {
        // Did the user click 'X' inside the outliner UI specifically to save it?
        if (intentionallySavedNodes.has(node.id)) {
           node.status = "saved";
           node.active = false;
           nodesToSave.push(node);
           intentionallySavedNodes.delete(node.id);
        } else {
           // Standard Native Chrome close - DESTROY node entirely to keep strict sync.
           nodesToRemove.add(node.id);
        }
      }
    }
  }

  // 3. Insert or update active windows and tabs
  for (const w of windows) {
    if (w.id === outlinerWindowId) continue; // Skip the popup window

    let winNode = winByBrowserId.get(w.id);
    if (!winNode) {
      winNode = {
        id: `win-${w.id}-${generateId()}`,
        type: "window",
        parentId: "root",
        childIds: [],
        createdAt: now,
        updatedAt: now,
        sortOrder: 0,
        status: "open",
        browserWindowId: w.id,
        title: "Window"
      };
    } else {
      winNode.status = "open";
      winNode.updatedAt = now;
      if (!winNode.childIds) winNode.childIds = [];
    }
    
    const activeTabIds: string[] = [];
    
    for (const t of (w.tabs || [])) {
      let tabNode = tabByBrowserId.get(t.id);
      
      if (!tabNode) {
        tabNode = {
          id: `tab-${t.id}-${generateId()}`,
          type: "tab",
          parentId: winNode.id,
          childIds: [],
          title: t.title || "New Tab",
          url: t.url,
          favIconUrl: t.favIconUrl,
          createdAt: now,
          updatedAt: now,
          sortOrder: t.index,
          status: "open",
          browserTabId: t.id,
          browserWindowId: w.id,
          active: t.active
        };
      } else {
        tabNode.status = "open";
        tabNode.title = t.title || tabNode.title;
        tabNode.url = t.url || tabNode.url;
        tabNode.favIconUrl = t.favIconUrl || tabNode.favIconUrl;
        tabNode.updatedAt = now;
        tabNode.parentId = winNode.id;
        tabNode.active = t.active;
      }
      activeTabIds.push(tabNode.id);
      nodesToSave.push(tabNode);
    }
    
    // Seamless Positional Weave Algorithm via unit-tested utility
    winNode.childIds = positionalWeave(winNode.childIds || [], activeTabIds, nodesToRemove);
    nodesToSave.push(winNode);
  }

  // Ensure root workspace node exists
  if (!nodeMap.has("root")) {
    nodesToSave.push({
      id: "root",
      type: "workspace",
      parentId: null,
      childIds: windows.filter(w => w.id !== outlinerWindowId).map(w => `win-${w.id}`),
      createdAt: now,
      updatedAt: now,
      sortOrder: 0
    });
  } else {
    const rootNode = nodeMap.get("root")!;
    
    // We append any missing active windows to the root.
    const activeWinNodeIds = windows.filter(w => w.id !== outlinerWindowId).map(w => `win-${w.id}`);
    const rootChildSet = new Set(rootNode.childIds);
    let dirty = false;
    for (const winId of activeWinNodeIds) {
       if (!rootChildSet.has(winId)) {
          rootNode.childIds.push(winId);
          dirty = true;
       }
    }
    if (dirty) nodesToSave.push(rootNode);
  }

  const uniqueNodesToSave = new Map(nodesToSave.map(n => [n.id, n]));
  if (uniqueNodesToSave.size > 0) {
     await putNodes(Array.from(uniqueNodesToSave.values()));
  }
  
  if (nodesToRemove.size > 0) {
     for (const dyingId of nodesToRemove) {
        await removeNode(dyingId);
     }
  }

  broadcastUpdate();
}

let isReconciling = false;
let pendingReconcile = false;

async function safeReconcile() {
  if (pauseReconcile) return;
  if (isReconciling) {
    pendingReconcile = true;
    return;
  }
  
  isReconciling = true;
  try {
    await reconcileTabs();
  } finally {
    isReconciling = false;
    if (pendingReconcile) {
      pendingReconcile = false;
      safeReconcile();
    }
  }
}

// Reconcile tree on major tab/window events
chrome.tabs.onCreated.addListener(safeReconcile);
chrome.tabs.onRemoved.addListener(safeReconcile);
chrome.tabs.onUpdated.addListener(safeReconcile);
chrome.tabs.onActivated.addListener(safeReconcile);
chrome.tabs.onMoved.addListener(safeReconcile);
chrome.tabs.onAttached.addListener(safeReconcile);
chrome.tabs.onDetached.addListener(safeReconcile);
chrome.tabs.onReplaced.addListener(safeReconcile);
chrome.windows.onCreated.addListener(safeReconcile);
chrome.windows.onRemoved.addListener(safeReconcile);
chrome.windows.onFocusChanged.addListener(safeReconcile);

// Provide the initial sync on background startup as well.
safeReconcile();
