import { useEffect, useState } from 'react';
import './App.css';
import type { TreeNode } from './types';
import { getAllNodes, removeNode } from './storage';
function NodeItem({ node }: { node: TreeNode }) {
  const [collapsed, setCollapsed] = useState(!!node.collapsed);

  const focusTab = async () => {
    if (typeof chrome !== 'undefined' && chrome.windows) {
      if (node.browserTabId && node.browserWindowId && node.status === 'open') {
        await chrome.windows.update(node.browserWindowId, { focused: true });
        await chrome.tabs.update(node.browserTabId, { active: true });
      } else if (node.url && node.status !== 'open') {
        await removeNode(node.id);
        await chrome.tabs.create({ url: node.url });
        window.dispatchEvent(new CustomEvent('REFRESH_TREE'));
      }
    }
  };

  const closeTab = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof chrome !== 'undefined' && chrome.tabs && node.browserTabId) {
      chrome.tabs.remove(node.browserTabId);
    }
  };

  const removeNodeBtn = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await removeNode(node.id);
      if (node.status === 'open' && node.browserTabId) {
        if (typeof chrome !== 'undefined' && chrome.tabs) {
          chrome.tabs.remove(node.browserTabId).catch(() => {});
        }
      }
      window.dispatchEvent(new CustomEvent('REFRESH_TREE'));
    } catch(err) {
      console.error(err);
    }
  };

  return (
    <div className="tree-node">
      {node.type === 'window' ? (
        <div className="window-header" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '▶ ' : '▼ '} {node.title} {collapsed && node.children && <span className="child-count">({node.children.length})</span>}
          {node.status !== 'open' && <span className="status-badge">[{node.status}]</span>}
        </div>
      ) : (
        <div 
          className={`node-content ${node.status !== 'open' ? 'closed-tab' : ''}`}
          onClick={focusTab}
        >
          {node.favIconUrl && <img src={node.favIconUrl} className="favicon" alt="icon" />}
          <div className="node-title" title={node.title}>{node.title}</div>
          <div className="node-actions">
            {node.status === 'open' && (
              <button className="btn-icon" onClick={closeTab} title="Close Tab">⨯</button>
            )}
            <button className="btn-icon" onClick={removeNodeBtn} title="Remove Node">🗑️</button>
          </div>
        </div>
      )}
      
      {!collapsed && node.children && node.children.length > 0 && (
        <div className="node-children">
          {node.children.map(child => (
            <NodeItem key={child.id} node={child} />
          ))}
        </div>
      )}
    </div>
  );
}

function App() {
  const [treeData, setTreeData] = useState<TreeNode[]>([]);

  useEffect(() => {
    const loadTree = async () => {
      try {
        const flatNodes = await getAllNodes();
        const nodeMap = new Map<string, TreeNode>();
        
        flatNodes.forEach(node => {
          nodeMap.set(node.id, { ...node, children: [] });
        });

        // Hydrate
        let rootNodes: TreeNode[] = [];
        
        flatNodes.forEach(node => {
          const hydratedNode = nodeMap.get(node.id)!;
          if (node.id === "root" || node.parentId === null) {
            rootNodes.push(hydratedNode);
          } else {
            const parent = nodeMap.get(node.parentId);
            if (parent && parent.children) {
              parent.children.push(hydratedNode);
            } else {
               // Orphand, add to root
               rootNodes.push(hydratedNode);
            }
          }
        });

        // The root itself is what we want its children of mostly
        const root = nodeMap.get("root");
        if (root && root.children) {
          setTreeData(root.children);
        } else {
          setTreeData(rootNodes.filter(n => n.id !== "root"));
        }
      } catch (e) {
        console.error("Failed to load tree from IndexedDB", e);
      }
    };

    loadTree();

    const refreshListener = () => loadTree();
    window.addEventListener('REFRESH_TREE', refreshListener);

    if (typeof chrome !== 'undefined' && chrome.runtime) {
      const listener = (msg: any) => {
        if (msg.type === "TREE_UPDATED") {
          loadTree();
        }
      };
      
      chrome.runtime.onMessage.addListener(listener);
      return () => {
        chrome.runtime.onMessage.removeListener(listener);
        window.removeEventListener('REFRESH_TREE', refreshListener);
      };
    } else {
      // Mock data for local Vite preview unattached to extension
      setTreeData([
        {
          id: 'win-1',
          type: 'window',
          title: 'Main Window',
          status: 'open',
          parentId: "root",
          childIds: ["tab-1", "tab-2"],
          createdAt: 0,
          updatedAt: 0,
          sortOrder: 0,
          children: [
            { id: 'tab-1', type: 'tab', title: 'Google', url: 'https://google.com', status: 'open', parentId: "win-1", childIds: [], createdAt: 0, updatedAt: 0, sortOrder: 0, children: [] },
            { id: 'tab-2', type: 'tab', title: 'GitHub', url: 'https://github.com', status: 'saved', parentId: "win-1", childIds: [], createdAt: 0, updatedAt: 0, sortOrder: 1 }
          ]
        }
      ]);
      return () => window.removeEventListener('REFRESH_TREE', refreshListener);
    }
  }, []);

  return (
    <div className="outliner-container">
      <div className="session-root">
        <span className="root-icon">🌐</span> Current Session
      </div>
      {treeData.map(node => (
        <NodeItem key={node.id} node={node} />
      ))}
    </div>
  );
}

export default App;
