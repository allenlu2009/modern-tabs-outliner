import type { BaseNode } from "./types";
import { putNodes, getAllNodes, putNode, removeNode, clearAllNodes } from "./storage";
import { positionalWeave, calculateRestoreIndex, generateId } from "./utils";

let outlinerWindowId: number | null = null;
let pauseReconcile = false;
const intentionallySavedNodes = new Set<string>();

export async function handleMessage(msg: any) {
  if (msg.type === "INTENTIONAL_SAVE") {
    intentionallySavedNodes.add(msg.nodeId);
    return;
  }
  if (msg.type === "RESTORE_NODE") {
    pauseReconcile = true;
    try {
      const nodes = await getAllNodes();
      const nodeMap = new Map(nodes.map(n => [n.id, n]));
      const node = nodeMap.get(msg.nodeId);
      if (!node) throw new Error("Restoring node find failed");

      const openWindows = await chrome.windows.getAll();

      if (node.type === "window" || node.type === "group") {
        const getAllChildTabs = (n: BaseNode): BaseNode[] => {
            if (n.type === 'tab') return [n];
            if (!n.childIds) return [];
            return n.childIds.flatMap(id => {
                const child = nodeMap.get(id);
                return child ? getAllChildTabs(child) : [];
            });
        };
        const childTabs = getAllChildTabs(node);
        const urls = childTabs.map(t => t.url || "about:blank");
        
        // Target window detection for branch restoration
        let targetWindowId: number | undefined = undefined;
        if (node.type === "group") {
            // Find parent window in outliner
            let curr = node;
            while (curr && curr.parentId) {
                const p = nodeMap.get(curr.parentId);
                if (p?.type === 'window') {
                    const isWinOpen = openWindows.find(w => w.id === p.browserWindowId);
                    if (isWinOpen) targetWindowId = p.browserWindowId;
                    break;
                }
                curr = p!;
            }
        }

        if (targetWindowId) {
            // Restore into existing window
            for (const tNode of childTabs) {
                 if (tNode.status !== 'open') {
                    const t = await chrome.tabs.create({ url: tNode.url, windowId: targetWindowId });
                    tNode.browserTabId = t.id;
                    tNode.browserWindowId = t.windowId;
                    tNode.status = "open";
                    tNode.updatedAt = Date.now();
                    await putNode(tNode);
                 }
            }
        } else {
            // Create new window
            const win = await chrome.windows.create({ focused: true, url: urls.length > 0 ? urls : undefined });
            if (!win) {
              pauseReconcile = false;
              return;
            }
            if (node.type === 'window') {
                node.browserWindowId = win.id;
                node.status = "open";
            }
            
            const nodesToPut: BaseNode[] = [node];
            if (win.tabs) {
              win.tabs.forEach((t, i) => {
                const tabNode = childTabs[i];
                if (tabNode) {
                  tabNode.browserTabId = t.id;
                  tabNode.browserWindowId = win.id;
                  tabNode.status = "open";
                  tabNode.active = t.active;
                  tabNode.updatedAt = Date.now();
                  nodesToPut.push(tabNode);
                }
              });
            }
            await putNodes(nodesToPut);
        }
        
        pauseReconcile = false;
        safeReconcile();
        return;
      }

      // --- Tab Restoration Logic ---
      let targetWindowId = node.browserWindowId;
      let isWinOpen = openWindows.some(w => w.id === targetWindowId);

      // If specific window isn't open, search up for a window ancestor
      if (!isWinOpen && node.parentId) {
        let currId = node.parentId;
        while (currId) {
          const parent = nodeMap.get(currId);
          if (!parent) break;
          if (parent.type === "window") {
            const isParentOpen = openWindows.some(w => w.id === parent.browserWindowId);
            if (!isParentOpen) {
              const newWin = await chrome.windows.create({ focused: true });
              parent.browserWindowId = newWin.id;
              parent.status = "open";
              parent.updatedAt = Date.now();
              await putNode(parent);
              targetWindowId = newWin.id;
            } else {
              targetWindowId = parent.browserWindowId;
            }
            isWinOpen = true;
            break;
          }
          currId = parent.parentId!;
        }
      }

      if (!isWinOpen) {
        targetWindowId = openWindows.find(w => w.type === 'normal')?.id;
      }

      let calculatedIndex: number | undefined = undefined;
      if (node.parentId) {
        const parent = nodeMap.get(node.parentId);
        if (parent && parent.childIds) {
          calculatedIndex = calculateRestoreIndex(node.id, parent.childIds, nodeMap);
        }
      }

      const t = await chrome.tabs.create({ url: msg.url, windowId: targetWindowId, index: calculatedIndex, active: true });
      node.browserTabId = t.id;
      node.browserWindowId = t.windowId;
      node.status = "open";
      node.active = true;
      node.updatedAt = Date.now();
      await putNode(node);
      pauseReconcile = false;
      safeReconcile();
    } catch (err) {
      console.error(err);
      pauseReconcile = false;
      safeReconcile();
    }
    return;
  }

  if (msg.type === "TAB_MOVED_UI") {
    pauseReconcile = true;
    chrome.tabs.move(msg.tabId, { windowId: msg.windowId, index: msg.index }, () => {
       pauseReconcile = false;
       safeReconcile();
    });
    return;
  }
}

export function initializeBackground() {
  chrome.runtime.onMessage.addListener((msg) => {
    handleMessage(msg);
    return false; 
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

  safeReconcile();
}

function broadcastUpdate() {
  chrome.runtime.sendMessage({ type: "TREE_UPDATED" }).catch(() => {});
}

async function reconcileTabs() {
  const windows = await chrome.windows.getAll({ populate: true });
  const nodesToSave: BaseNode[] = [];
  const now = Date.now();

  const activeWindowIds = new Set(windows.map(w => w.id));
  const activeTabIds = new Set(windows.flatMap(w => (w.tabs || []).map(t => t.id)));

  const existingNodes = await getAllNodes();
  const nodeMap = new Map(existingNodes.map(n => [n.id, n]));

  const winByBrowserId = new Map(existingNodes.filter(n => n.type === 'window' && n.browserWindowId).map(n => [n.browserWindowId, n]));
  const tabByBrowserId = new Map(existingNodes.filter(n => n.type === 'tab' && n.browserTabId).map(n => [n.browserTabId, n]));

  const nodesToRemove = new Set<string>();
  
  for (const node of existingNodes) {
    if (node.status === "open") {
      if (node.type === "window" && node.browserWindowId && !activeWindowIds.has(node.browserWindowId)) {
        if (intentionallySavedNodes.has(node.id)) {
          node.status = "saved";
          nodesToSave.push(node);
          intentionallySavedNodes.delete(node.id);
        } else {
          const childrenIds = node.childIds || [];
          const hasAnyChildren = childrenIds.some(id => nodeMap.has(id) && !nodesToRemove.has(id));
          if (!hasAnyChildren) {
            nodesToRemove.add(node.id);
          } else {
            node.status = "saved";
            nodesToSave.push(node);
          }
        }
      } else if (node.type === "tab" && node.browserTabId && !activeTabIds.has(node.browserTabId)) {
        if (intentionallySavedNodes.has(node.id)) {
           node.status = "saved";
           node.active = false;
           nodesToSave.push(node);
           intentionallySavedNodes.delete(node.id);
        } else {
           nodesToRemove.add(node.id);
        }
      }
    }
  }

  for (const w of windows) {
    if (w.id === outlinerWindowId) continue;

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
    
    const tabsInThisWindow: string[] = [];
    
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
        tabNode.active = t.active;
        tabNode.browserWindowId = w.id;

        // VIRTUAL PARENTING: Preserve group parent if it exists
        if (tabNode.parentId && nodeMap.get(tabNode.parentId)?.type === 'group') {
           // Keep the group parent
        } else {
           tabNode.parentId = winNode.id;
        }
      }
      
      // Collect only tabs that are logically direct children of this window
      if (tabNode.parentId === winNode.id) {
        tabsInThisWindow.push(tabNode.id);
      }
      nodesToSave.push(tabNode);
    }
    
    // Positional Weave: Only weave tabs that are direct children of the window (not in groups)
    // We also need to PRESERVE group nodes that are under this window!
    // Re-weave the window's childIds, keeping groups in place and weaving tabs around them
    winNode.childIds = positionalWeave(winNode.childIds || [], tabsInThisWindow, nodesToRemove);
    nodesToSave.push(winNode);
  }

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
