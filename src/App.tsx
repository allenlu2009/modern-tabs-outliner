import { useEffect, useState } from 'react';
import './App.css';
import type { TreeNode } from './types';
import { getAllNodes, removeNode, putNode, putNodes } from './storage';
import { generateId } from './utils';

function NodeItem({ node }: { node: TreeNode }) {
  const [collapsed, setCollapsed] = useState(!!node.collapsed);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(node.title || '');

  const focusTab = async () => {
    if (typeof chrome !== 'undefined' && chrome.windows) {
      if (node.browserTabId && node.browserWindowId && node.status === 'open') {
        await chrome.windows.update(node.browserWindowId, { focused: true });
        await chrome.tabs.update(node.browserTabId, { active: true });
      } else if (node.url && node.status !== 'open') {
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage({ type: "RESTORE_NODE", nodeId: node.id, url: node.url }).catch(err => console.log(err));
        }
      }
    }
  };

  const closeTab = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof chrome !== 'undefined' && chrome.tabs && node.browserTabId) {
      if (chrome.runtime) {
        try {
          await chrome.runtime.sendMessage({ type: "INTENTIONAL_SAVE", nodeId: node.id });
        } catch (e) { console.error(e); }
      }
      chrome.tabs.remove(node.browserTabId).catch(() => {});
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

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editTitle.trim() === '') return;
    try {
      const updatedNode = { ...node, title: editTitle, updatedAt: Date.now() };
      delete (updatedNode as any).children; // Don't save hydrated children
      await putNode(updatedNode);
      setIsEditing(false);
      window.dispatchEvent(new CustomEvent('REFRESH_TREE'));
    } catch(err) {
      console.error(err);
    }
  };

  return (
    <div className="tree-node">
      {node.type === 'window' || node.type === 'group' ? (
        <div className="group-header" onClick={() => setCollapsed(!collapsed)}>
          <span className="collapser">{collapsed ? '▶ ' : '▼ '}</span>
          <span className="node-icon">{node.type === 'window' ? '🪟' : '📁'}</span>
          {isEditing ? (
            <form onSubmit={handleRename} className="inline-edit" onClick={(e) => e.stopPropagation()}>
              <input 
                autoFocus 
                value={editTitle} 
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={handleRename}
              />
            </form>
          ) : (
            <span 
              className="group-title" 
              onDoubleClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
            >
              {node.title} {node.type === 'window' && node.status !== 'open' && <span className="status-badge">[{node.status}]</span>}
              {collapsed && node.children && <span className="child-count">({node.children.length})</span>}
            </span>
          )}
          <div className="node-actions group-actions">
            {node.type === 'group' && (
              <button className="btn-icon" onClick={removeNodeBtn} title="Remove Group">🗑️</button>
            )}
          </div>
        </div>
      ) : (
        <div 
          className={`node-content ${node.status !== 'open' ? 'closed-tab' : ''}`}
          onClick={focusTab}
        >
          {node.favIconUrl && <img src={node.favIconUrl} className="favicon" alt="icon" />}
          <div className={`node-title ${node.active ? 'active-tab' : ''}`} title={node.title}>{node.title}</div>
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

  const addGroup = async () => {
    try {
      const now = Date.now();
      const newGroup = {
        id: `group-${generateId()}`,
        type: 'group' as const,
        parentId: 'root',
        childIds: [],
        title: 'New Group',
        createdAt: now,
        updatedAt: now,
        sortOrder: 0
      };
      
      const nodes = await getAllNodes();
      const rootNode = nodes.find(n => n.id === 'root');
      if (rootNode) {
        rootNode.childIds.unshift(newGroup.id);
        await putNodes([newGroup, rootNode]);
      } else {
        await putNode(newGroup);
      }
      
      window.dispatchEvent(new CustomEvent('REFRESH_TREE'));
    } catch (err) {
      console.error(err);
    }
  };

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
               rootNodes.push(hydratedNode);
            }
          }
        });

        // Fix order based on childIds
        nodeMap.forEach(node => {
          if (node.children && node.childIds) {
            node.children.sort((a, b) => {
              const idxA = node.childIds.indexOf(a.id);
              const idxB = node.childIds.indexOf(b.id);
              return (idxA === -1 ? 9999 : idxA) - (idxB === -1 ? 9999 : idxB);
            });
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
      // ... handled by storage logic mostly now
      return () => window.removeEventListener('REFRESH_TREE', refreshListener);
    }
  }, []);

  return (
    <div className="outliner-container">
      <div className="session-root">
        <span className="root-icon">🌐</span> Current Session
        <button className="btn-icon add-group-btn" onClick={addGroup} title="Add Group">📁+</button>
      </div>
      {treeData.map(node => (
        <NodeItem key={node.id} node={node} />
      ))}
    </div>
  );
}

export default App;
