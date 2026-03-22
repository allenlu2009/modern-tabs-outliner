import { useEffect, useState } from 'react';
import './App.css';

interface TreeNode {
  id: string;
  tabId?: number;
  windowId?: number;
  type: 'window' | 'tab' | 'group';
  title: string;
  url?: string;
  favIconUrl?: string;
  children: TreeNode[];
  isOpen: boolean;
  isCollapsed?: boolean;
}

function NodeItem({ node }: { node: TreeNode }) {
  const [collapsed, setCollapsed] = useState(!!node.isCollapsed);

  const focusTab = async () => {
    if (typeof chrome !== 'undefined' && chrome.windows) {
      if (node.tabId && node.windowId && node.isOpen) {
        await chrome.windows.update(node.windowId, { focused: true });
        await chrome.tabs.update(node.tabId, { active: true });
      } else if (node.url && !node.isOpen) {
        chrome.tabs.create({ url: node.url });
      }
    }
  };

  const closeTab = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof chrome !== 'undefined' && chrome.tabs && node.tabId) {
      chrome.tabs.remove(node.tabId);
    }
  };

  return (
    <div className="tree-node">
      {node.type === 'window' ? (
        <div className="window-header" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '▶ ' : '▼ '} {node.title}
        </div>
      ) : (
        <div 
          className={`node-content ${!node.isOpen ? 'closed-tab' : ''}`}
          onClick={focusTab}
        >
          {node.favIconUrl && <img src={node.favIconUrl} className="favicon" alt="icon" />}
          <div className="node-title" title={node.title}>{node.title}</div>
          <div className="node-actions">
            {node.isOpen && (
              <button className="btn-icon" onClick={closeTab} title="Close Tab">⨯</button>
            )}
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
    // Load initial data
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get('treeData', (res) => {
        if (res.treeData) setTreeData(res.treeData);
      });

      // Listen for updates from background worker
      const listener = (changes: any, areaName: string) => {
        if (areaName === 'local' && changes.treeData) {
          setTreeData(changes.treeData.newValue);
        }
      };
      
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    } else {
      // Mock data for local Vite preview unattached to extension
      setTreeData([
        {
          id: 'win-1',
          type: 'window',
          title: 'Main Window',
          isOpen: true,
          children: [
            { id: 'tab-1', type: 'tab', title: 'Google', url: 'https://google.com', isOpen: true, children: [] },
            { id: 'tab-2', type: 'tab', title: 'GitHub', url: 'https://github.com', isOpen: false, children: [] },
          ]
        }
      ]);
    }
  }, []);

  return (
    <div className="outliner-container">
      {treeData.map(node => (
        <NodeItem key={node.id} node={node} />
      ))}
    </div>
  );
}

export default App;
