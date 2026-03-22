// Background service worker for Tabs Outliner

let outlinerWindowId: number | null = null;

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

// Initialize or update tree on startup
chrome.runtime.onInstalled.addListener(async () => {
  console.log("Extension installed and initialized.");
  await syncCurrentTabsToState();
});

export interface TreeNode {
  id: string; // unique ID for outliner item
  tabId?: number; // current Chrome Tab ID if open
  windowId?: number; // current Chrome Window ID if open
  type: 'window' | 'tab' | 'group';
  title: string;
  url?: string;
  favIconUrl?: string;
  children: TreeNode[];
  isOpen: boolean; // true if tab is currently open, false if saved session
  isCollapsed?: boolean;
}

// Sync current open windows/tabs to our custom storage state
async function syncCurrentTabsToState() {
  const windows = await chrome.windows.getAll({ populate: true });
  
  // In a full implementation, we'd recursively merge with existing chrome.storage.local
  // Using a flat-to-tree map with openerTabId for nesting
  const state: TreeNode[] = windows.map(w => {
    return {
      id: `win-${w.id}`,
      windowId: w.id,
      type: 'window',
      title: `Window`,
      isOpen: true,
      children: (w.tabs || []).map(t => ({
        id: `tab-${t.id}`,
        tabId: t.id,
        windowId: w.id,
        type: 'tab',
        title: t.title || 'New Tab',
        url: t.url,
        favIconUrl: t.favIconUrl,
        isOpen: true,
        children: [] 
      }))
    };
  });
  
  await chrome.storage.local.set({ treeData: state });
}

// Event Listeners for tabs updates
chrome.tabs.onCreated.addListener(async () => {
  // Sync the whole tree for this basic implementation
  await syncCurrentTabsToState();
});

chrome.tabs.onRemoved.addListener(async () => {
  // Instead of deleting from treeData, we will later just set isOpen = false
  await syncCurrentTabsToState();
});

chrome.tabs.onUpdated.addListener(async () => {
  await syncCurrentTabsToState();
});
