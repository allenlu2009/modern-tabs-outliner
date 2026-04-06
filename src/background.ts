import type { BaseNode } from "./types";
import { putNodes, getAllNodes, putNode } from "./storage";

let outlinerWindowId: number | null = null;
let pauseReconcile = false;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "RESTORE_NODE") {
    pauseReconcile = true;
    chrome.tabs.create({ url: msg.url, active: true }, async (t) => {
      try {
        const nodes = await getAllNodes();
        const nodeMap = new Map(nodes.map(n => [n.id, n]));
        const node = nodeMap.get(msg.nodeId);
        if (node) {
          node.browserTabId = t.id;
          node.browserWindowId = t.windowId;
          node.status = "open";
          node.active = true;
          await putNode(node);
        }
      } catch (err) {
        console.error(err);
      } finally {
        pauseReconcile = false;
        safeReconcile();
      }
    });
    return true;
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

chrome.runtime.onInstalled.addListener(async () => {
  console.log("Extension installed and initialized.");
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

  function generateId() {
    return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
  }

  // 2. Mark previously "open" nodes that no longer exist as "crashed" or "saved"
  for (const node of existingNodes) {
    if (node.status === "open") {
      if (node.type === "window" && node.browserWindowId && !activeWindowIds.has(node.browserWindowId)) {
        node.status = "crashed";
        nodesToSave.push(node);
      } else if (node.type === "tab" && node.browserTabId && !activeTabIds.has(node.browserTabId)) {
        node.status = "saved";
        nodesToSave.push(node);
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
    
    // Safely append new tabs without overwriting the historical saved ones
    const finalChildIds = [...(winNode.childIds || [])];
    for (const id of activeTabIds) {
      if (!finalChildIds.includes(id)) {
        finalChildIds.push(id);
      }
    }
    winNode.childIds = finalChildIds;
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

  broadcastUpdate();
}

async function safeReconcile() {
  if (pauseReconcile) return;
  await reconcileTabs();
}

// Reconcile tree on major tab/window events
chrome.tabs.onCreated.addListener(safeReconcile);
chrome.tabs.onRemoved.addListener(safeReconcile);
chrome.tabs.onUpdated.addListener(safeReconcile);
chrome.tabs.onActivated.addListener(safeReconcile);
chrome.windows.onCreated.addListener(safeReconcile);
chrome.windows.onRemoved.addListener(safeReconcile);
chrome.windows.onFocusChanged.addListener(safeReconcile);

// Provide the initial sync on background startup as well.
safeReconcile();
