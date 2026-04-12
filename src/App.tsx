import React, { useState, useEffect, useMemo } from 'react';
import { 
  DndContext, 
  closestCenter, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent
} from '@dnd-kit/core';
import { 
  SortableContext, 
  sortableKeyboardCoordinates 
} from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getAllNodes, putNode, putNodes, removeNode } from './storage';
import type { BaseNode } from './types';
import { generateId } from './utils';
import './App.css';

// --- Types ---
interface TreeNode extends BaseNode {
  children: TreeNode[];
}

// --- Components ---

const TabIcon = ({ url, favIconUrl }: { url?: string; favIconUrl?: string }) => {
  const [error, setError] = useState(false);
  const getDomain = (u?: string) => {
    try {
      return u ? new URL(u).hostname : '';
    } catch {
      return '';
    }
  };

  if (!favIconUrl || error) {
    return <div className="tab-icon-fallback">📄</div>;
  }

  return (
    <img 
      src={favIconUrl} 
      className="tab-icon" 
      onError={() => setError(true)} 
      alt={getDomain(url)}
      loading="lazy"
    />
  );
};

// This specialized sorting strategy tells dnd-kit NOT to do any automatic layout shifts
// during the drag. All layout updates are handled by us in handleDragEnd.
const noopSortingStrategy = () => null;

const NodeItem = ({ node, depth, isDragActive, forceExpand }: { node: TreeNode; depth: number; isDragActive: boolean; forceExpand?: boolean }) => {
  const [collapsed, setCollapsed] = useState(node.type === 'window' && node.status !== 'open');
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(node.title || '');

  // Auto-expand during search
  useEffect(() => {
    if (forceExpand) setCollapsed(false);
  }, [forceExpand]);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ 
    id: node.id,
    data: { node }
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    marginLeft: `${depth * 20}px`,
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 10 : 1
  };

  const focusTab = async () => {
    if (node.type === 'tab' && node.browserTabId) {
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        chrome.tabs.update(node.browserTabId, { active: true });
        chrome.windows.update(node.browserWindowId!, { focused: true });
      }
    }
  };

  const closeTab = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs && node.browserTabId) {
        chrome.runtime.sendMessage({ type: "INTENTIONAL_SAVE", nodeId: node.id });
        chrome.tabs.remove(node.browserTabId);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const removeNodeBtn = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await removeNode(node.id);
      window.dispatchEvent(new CustomEvent('REFRESH_TREE'));
    } catch (err) {
      console.error(err);
    }
  };

  // Improved Close Branch (Recursive)
  const closeBranch = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const allFlatNodes = await getAllNodes();
      const nodeMap = new Map(allFlatNodes.map(n => [n.id, n]));
      
      const getAllTabs = (id: string): BaseNode[] => {
        const n = nodeMap.get(id);
        if (!n) return [];
        if (n.type === 'tab') return [n];
        return (n.childIds || []).flatMap(cid => getAllTabs(cid));
      };

      const tabsToClose = getAllTabs(node.id).filter(t => t.status === 'open');
      
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        for (const t of tabsToClose) {
           if (t.browserTabId) {
             chrome.runtime.sendMessage({ type: "INTENTIONAL_SAVE", nodeId: t.id });
             chrome.tabs.remove(t.browserTabId).catch(() => {});
           }
        }
      }
      
      if (node.type === 'window') {
        chrome.runtime.sendMessage({ type: "INTENTIONAL_SAVE", nodeId: node.id });
      }
      
      window.dispatchEvent(new CustomEvent('REFRESH_TREE'));
    } catch(err) {
      console.error(err);
    }
  };

  const restoreBranch = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ type: "RESTORE_NODE", nodeId: node.id }).catch(() => {});
    }
  };

  const removeWindowNodeBtn = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (node.status === 'open' && node.browserWindowId
          && typeof chrome !== 'undefined' && chrome.windows) {
        chrome.windows.remove(node.browserWindowId).catch(() => {});
      }
      await removeNode(node.id);
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
      delete (updatedNode as any).children;
      await putNode(updatedNode);
      setIsEditing(false);
      window.dispatchEvent(new CustomEvent('REFRESH_TREE'));
    } catch(err) {
      console.error(err);
    }
  };

  return (
    <div className="tree-node" ref={setNodeRef} style={style}>
      {node.type === 'window' || node.type === 'group' ? (
        <div className="group-header" onClick={() => setCollapsed(!collapsed)}>
          <span className="drag-handle" {...attributes} {...listeners}>⣿</span>
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
              {node.title} {node.status && node.status !== 'open' && <span className="status-badge">[{node.status}]</span>}
              {collapsed && node.children && <span className="child-count">({node.children.length})</span>}
            </span>
          )}
          <div className="node-actions group-actions">
            {/* Show Close button if branch has ANY open tabs recursively */}
            {(() => {
              const hasOpenTabs = (n: TreeNode & { status?: string }): boolean => {
                if (n.type === 'tab' && n.status === 'open') return true;
                return !!(n.children && n.children.some(child => hasOpenTabs(child)));
              };
              if (hasOpenTabs(node)) {
                return <button className="btn-icon" onClick={closeBranch} title={`Close all in ${node.type}`}>⨯</button>;
              } else {
                return <button className="btn-icon" onClick={restoreBranch} title={`Restore all in ${node.type}`}>↻</button>;
              }
            })()}
            <button className="btn-icon" onClick={node.type === 'window' ? removeWindowNodeBtn : removeNodeBtn} title="Remove">🗑️</button>
          </div>
        </div>
      ) : (
        <div
          className={`node-content ${node.status !== 'open' ? 'closed-tab' : ''}`}
          onClick={focusTab}
        >
          <span className="drag-handle" {...attributes} {...listeners}>⣿</span>
          <TabIcon url={node.url} favIconUrl={node.favIconUrl} />
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
            <NodeItem key={child.id} node={child} depth={depth + 1} isDragActive={isDragActive} forceExpand={forceExpand} />
          ))}
        </div>
      )}
    </div>
  );
};

function App() {
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const flatList = useMemo(() => {
    const list: TreeNode[] = [];
    const flatten = (nodes: TreeNode[]) => {
      nodes.forEach(n => {
        list.push(n);
        if (n.children && n.children.length > 0) flatten(n.children);
      });
    };
    flatten(treeData);
    return list;
  }, [treeData]);

  const filteredTree = useMemo(() => {
    if (!searchQuery.trim()) return treeData;
    const q = searchQuery.toLowerCase();
    
    const filterNodes = (nodes: TreeNode[]): TreeNode[] => {
      return nodes
        .map(n => ({ ...n, children: filterNodes(n.children) }))
        .filter(n => n.title?.toLowerCase().includes(q) || n.url?.toLowerCase().includes(q) || n.children.length > 0);
    };
    return filterNodes(treeData);
  }, [treeData, searchQuery]);

  const allNodeIds = useMemo(() => flatList.map(n => n.id), [flatList]);
  const isSearching = searchQuery.trim().length > 0;

  const addGroup = async () => {
    try {
      const now = Date.now();
      const newGroup: BaseNode = {
        id: `group-${generateId()}`,
        type: 'group',
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

  const loadTree = async () => {
    try {
      const flatNodes = await getAllNodes();
      const nodeMap = new Map<string, TreeNode>();

      flatNodes.forEach(node => {
        nodeMap.set(node.id, { ...node, children: [] });
      });

      let rootNodes: TreeNode[] = [];

      flatNodes.forEach(node => {
        const hydratedNode = nodeMap.get(node.id)!;
        if (node.id === "root" || node.parentId === null) {
          rootNodes.push(hydratedNode);
        } else {
          const parent = nodeMap.get(node.parentId);
          if (parent) {
            parent.children.push(hydratedNode);
          } else {
            rootNodes.push(hydratedNode);
          }
        }
      });

      nodeMap.forEach(node => {
        if (node.childIds) {
          node.children.sort((a, b) => {
            const idxA = node.childIds.indexOf(a.id);
            const idxB = node.childIds.indexOf(b.id);
            return (idxA === -1 ? 9999 : idxA) - (idxB === -1 ? 9999 : idxB);
          });
        }
      });

      const root = nodeMap.get("root");
      setTreeData(root?.children || rootNodes.filter(n => n.id !== "root"));
    } catch (e) {
      console.error("Failed to load tree", e);
    }
  };

  useEffect(() => {
    loadTree();
    const refreshListener = () => loadTree();
    window.addEventListener('REFRESH_TREE', refreshListener);
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        document.getElementById('search-input')?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    if (typeof chrome !== 'undefined' && chrome.runtime) {
      const listener = (msg: any) => {
        if (msg.type === "TREE_UPDATED") loadTree();
      };
      chrome.runtime.onMessage.addListener(listener);
      return () => {
        chrome.runtime.onMessage.removeListener(listener);
        window.removeEventListener('REFRESH_TREE', refreshListener);
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
    return () => {
      window.removeEventListener('REFRESH_TREE', refreshListener);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over || active.id === over.id) return;

    const activeIndex = (active.data.current as any)?.sortable?.index ?? -1;
    const overIndex = (over.data.current as any)?.sortable?.index ?? -1;
    const draggingDown = activeIndex !== -1 && overIndex !== -1 && activeIndex < overIndex;

    try {
      const nodes = await getAllNodes();
      const nodeMap = new Map<string, BaseNode>(nodes.map(n => [n.id, { ...n, childIds: [...n.childIds] }]));
      const activeNode = nodeMap.get(active.id as string);
      const overNode = nodeMap.get(over.id as string);
      if (!activeNode || !overNode) return;

      const oldParentId = activeNode.parentId || 'root';
      const oldParent = nodeMap.get(oldParentId);
      const dropIntoContainer = overNode.type === 'group';
      const newParentId = dropIntoContainer ? overNode.id : (overNode.parentId || 'root');
      const newParent = nodeMap.get(newParentId);
      if (!newParent) return;

      const isSameParent = oldParentId === newParentId;
      let insertIndex = 0;

      if (dropIntoContainer) {
        if (oldParent) oldParent.childIds = oldParent.childIds.filter(id => id !== activeNode.id);
        insertIndex = 0;
      } else if (isSameParent) {
        oldParent!.childIds = oldParent!.childIds.filter(id => id !== activeNode.id);
        const overIdxAfter = newParent.childIds.indexOf(overNode.id);
        insertIndex = draggingDown ? (overIdxAfter + 1) : overIdxAfter;
      } else {
        if (oldParent) oldParent.childIds = oldParent.childIds.filter(id => id !== activeNode.id);
        const idx = newParent.childIds.indexOf(overNode.id);
        insertIndex = idx < 0 ? newParent.childIds.length : idx;
      }

      newParent.childIds.splice(insertIndex, 0, activeNode.id);
      activeNode.parentId = newParentId;

      const toPersist: BaseNode[] = [activeNode, newParent];
      if (oldParent && oldParent.id !== newParent.id) toPersist.push(oldParent);
      await putNodes(toPersist);

      // Auto-remove old window if it's now empty after cross-parent move
      if (!isSameParent && oldParent?.type === 'window' && oldParent.childIds.length === 0) {
        await removeNode(oldParent.id);
        if (oldParent.status === 'open' && oldParent.browserWindowId && typeof chrome !== 'undefined') {
          chrome.windows.remove(oldParent.browserWindowId).catch(() => {});
        }
      }

      // --- Physical Chrome Tab Synchronization ---
      if (activeNode.type === 'tab' && activeNode.status === 'open' && activeNode.browserTabId) {
        // Find the "Physical" target window by searching up the tree
        let effectiveWindowId: number | undefined = undefined;
        let rootAncestorId: string | undefined = undefined;
        
        let curr: BaseNode | undefined = newParent;
        while (curr) {
          if (curr.type === 'window' && curr.browserWindowId) {
            effectiveWindowId = curr.browserWindowId;
            rootAncestorId = curr.id;
            break;
          }
          curr = curr.parentId ? nodeMap.get(curr.parentId) : undefined;
        }

        if (effectiveWindowId && rootAncestorId) {
          // We need to find the physical index of the dropped tab within this window's open tabs.
          // This requires a pre-order traversal of the window's logical branch to count open tabs before 'activeNode'.
          
          let physicalIndex = 0;
          let found = false;

          const countPrecedents = (id: string) => {
            if (found) return;
            if (id === activeNode.id) {
              found = true;
              return;
            }
            const node = nodeMap.get(id);
            if (!node) return;
            
            if (node.type === 'tab' && node.status === 'open') {
              physicalIndex++;
            }
            
            if (node.childIds) {
              for (const cid of node.childIds) {
                countPrecedents(cid);
              }
            }
          };

          const windowNode = nodeMap.get(rootAncestorId);
          if (windowNode && windowNode.childIds) {
            for (const cid of windowNode.childIds) {
              countPrecedents(cid);
            }
          }

          chrome.runtime.sendMessage({ 
            type: "TAB_MOVED_UI", 
            tabId: activeNode.browserTabId, 
            windowId: effectiveWindowId, 
            index: physicalIndex 
          });
        }
      }

      window.dispatchEvent(new CustomEvent('REFRESH_TREE'));
    } catch (e) {
      console.error('DND error:', e);
    }
  };

  const activeTreeNode = useMemo(() => {
    const findNode = (nodes: TreeNode[], id: string): TreeNode | undefined => {
      for (const n of nodes) {
        if (n.id === id) return n;
        const found = findNode(n.children, id);
        if (found) return found;
      }
      return undefined;
    };
    return activeId ? findNode(treeData, activeId) : undefined;
  }, [activeId, treeData]);

  return (
    <div className="outliner-container">
      <div className="search-container">
        <input
          id="search-input"
          type="text"
          className="search-input"
          placeholder="Search tabs, windows, groups... (Ctrl+F)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {isSearching && <button className="clear-search" onClick={() => setSearchQuery('')}>×</button>}
      </div>

      <div className="session-root">
        <span className="root-icon">📁</span> {isSearching ? `Search Results (${allNodeIds.length})` : 'Current Session'}
        <button className="btn-icon add-group-btn" onClick={addGroup} title="Add Group">📁+</button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <SortableContext items={allNodeIds} strategy={noopSortingStrategy}>
          {filteredTree.map(node => (
            <NodeItem key={node.id} node={node} depth={0} isDragActive={activeId !== null} forceExpand={isSearching} />
          ))}
        </SortableContext>

        <DragOverlay adjustScale={false} dropAnimation={null}>
          {activeTreeNode ? (
            <div className="drag-overlay-item">
              <TabIcon url={activeTreeNode.url} favIconUrl={activeTreeNode.favIconUrl} />
              <span>{activeTreeNode.title}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

export default App;
