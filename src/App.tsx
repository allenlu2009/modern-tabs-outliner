import { useEffect, useState, useMemo } from 'react';
import './App.css';
import type { TreeNode, BaseNode } from './types';
import { getAllNodes, removeNode, putNode, putNodes } from './storage';
import { generateId } from './utils';

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import type { SortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// A no-op sorting strategy: items do NOT visually shift when dragging.
// This eliminates phantom cramping in adjacent window groups.
// Position is resolved only on drop via onDragEnd logic.
const noopSortingStrategy: SortingStrategy = () => null;

/**
 * Renders the correct icon for a tab:
 * - Real favicon image (with error fallback)
 * - Red PDF badge when URL ends in .pdf and no favicon exists
 * - Nothing otherwise
 */
function TabIcon({ url, favIconUrl }: { url?: string; favIconUrl?: string }) {
  const validFavicon =
    favIconUrl &&
    !favIconUrl.startsWith('chrome://') &&
    !favIconUrl.startsWith('chrome-extension://');

  if (validFavicon) {
    return (
      <img
        src={favIconUrl}
        className="favicon"
        alt=""
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }

  const lowerUrl = url?.toLowerCase() ?? '';
  const isPdf =
    lowerUrl.endsWith('.pdf') ||
    lowerUrl.includes('.pdf?') ||
    lowerUrl.includes('.pdf#') ||
    lowerUrl.includes('/pdf') && lowerUrl.includes('file://');

  if (isPdf) {
    return <span className="file-type-icon pdf-icon" title="PDF file">PDF</span>;
  }

  return null;
}

function NodeItem({ node, depth = 0, isDragActive = false }: { node: TreeNode; depth?: number; isDragActive?: boolean }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useSortable({ id: node.id });

  const style = {
    // When any drag is active, freeze all items except the one being dragged.
    // Disabling transition entirely prevents the rubber-band spring-back on drop.
    transform: isDragging ? undefined : (isDragActive ? 'none' : CSS.Transform.toString(transform)),
    transition: 'none', // No CSS transition at all — eliminates rubber-band bounce on drop
    opacity: isDragging ? 0 : 1,
  };

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

  // Close entire window (saves tabs, closes in Chrome, keeps nodes as "saved")
  const closeWindow = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!node.browserWindowId || typeof chrome === 'undefined') return;
    if (node.children) {
      for (const child of node.children) {
        if (child.status === 'open' && child.browserTabId) {
          chrome.runtime.sendMessage({ type: "INTENTIONAL_SAVE", nodeId: child.id }).catch(() => {});
        }
      }
    }
    chrome.windows.remove(node.browserWindowId).catch(() => {});
  };

  // Remove entire window node + all children from DB (and close in Chrome)
  const removeWindowNodeBtn = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (node.children) {
        for (const child of node.children) {
          await removeNode(child.id);
          if (child.status === 'open' && child.browserTabId && typeof chrome !== 'undefined' && chrome.tabs) {
            chrome.tabs.remove(child.browserTabId).catch(() => {});
          }
        }
      }
      await removeNode(node.id);
      if (node.status === 'open' && node.browserWindowId && typeof chrome !== 'undefined' && chrome.windows) {
        chrome.windows.remove(node.browserWindowId).catch(() => {});
      }
      window.dispatchEvent(new CustomEvent('REFRESH_TREE'));
    } catch (err) { console.error(err); }
  };

  const removeNodeBtn = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (node.status === 'open' && node.browserTabId && typeof chrome !== 'undefined' && chrome.tabs) {
        chrome.tabs.remove(node.browserTabId).catch(() => {});
      }
      // Load all nodes to check if parent window becomes empty after removal
      const allNodes = await getAllNodes();
      const parentNode = node.parentId ? allNodes.find(n => n.id === node.parentId) : null;

      await removeNode(node.id);

      // If parent window/group now has no more valid children, remove it too
      if (parentNode && parentNode.type === 'window') {
        const remainingValid = parentNode.childIds
          .filter(cid => cid !== node.id)
          .filter(cid => allNodes.some(n => n.id === cid));
        if (remainingValid.length === 0) {
          await removeNode(parentNode.id);
          if (parentNode.status === 'open' && parentNode.browserWindowId
              && typeof chrome !== 'undefined' && chrome.windows) {
            chrome.windows.remove(parentNode.browserWindowId).catch(() => {});
          }
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
            {node.type === 'window' && node.status === 'open' && (
              <button className="btn-icon" onClick={closeWindow} title="Save & Close Window">⨯</button>
            )}
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
          {/* No nested SortableContext — one flat context in App for cross-container support */}
          {node.children.map(child => (
            <NodeItem key={child.id} node={child} depth={depth + 1} isDragActive={isDragActive} />
          ))}
        </div>
      )}
    </div>
  );
}

function App() {
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 }, // Prevent accidental drags on clicks
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Collect ALL node IDs in flat DFS order for a single SortableContext.
  // This is the key fix for cross-container (cross-window) drag-and-drop.
  const allNodeIds = useMemo(() => {
    const ids: string[] = [];
    const collect = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        ids.push(n.id);
        if (n.children && n.children.length > 0) {
          collect(n.children);
        }
      }
    };
    collect(treeData);
    return ids;
  }, [treeData]);

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
          if (parent && parent.children) {
            parent.children.push(hydratedNode);
          } else {
            rootNodes.push(hydratedNode);
          }
        }
      });

      nodeMap.forEach(node => {
        if (node.children && node.childIds) {
          node.children.sort((a, b) => {
            const idxA = node.childIds.indexOf(a.id);
            const idxB = node.childIds.indexOf(b.id);
            return (idxA === -1 ? 9999 : idxA) - (idxB === -1 ? 9999 : idxB);
          });
        }
      });

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

  useEffect(() => {
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
      return () => window.removeEventListener('REFRESH_TREE', refreshListener);
    }
  }, []);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over || active.id === over.id) return;

    // Use flat sortable indices to determine drag direction
    // activeIndex < overIndex means dragging DOWN
    const activeIndex = (active.data.current as any)?.sortable?.index ?? -1;
    const overIndex = (over.data.current as any)?.sortable?.index ?? -1;
    const draggingDown = activeIndex !== -1 && overIndex !== -1 && activeIndex < overIndex;

    try {
      const nodes = await getAllNodes();
      // Deep-copy childIds so all mutations are safe
      const nodeMap = new Map<string, BaseNode>(
        nodes.map(n => [n.id, { ...n, childIds: [...n.childIds] }])
      );

      const activeNode = nodeMap.get(active.id as string);
      const overNode = nodeMap.get(over.id as string);
      if (!activeNode || !overNode) return;

      const oldParentId = activeNode.parentId || 'root';
      const oldParent = nodeMap.get(oldParentId);

      // Only drop INTO a group (not a window) to keep windows flat at root level
      const dropIntoContainer = overNode.type === 'group';
      const newParentId = dropIntoContainer ? overNode.id : (overNode.parentId || 'root');
      const newParent = nodeMap.get(newParentId);
      if (!newParent) return;

      const isSameParent = oldParentId === newParentId;
      let insertIndex = 0;

      if (dropIntoContainer) {
        // Dropping ON a group header → insert as first child
        if (oldParent) oldParent.childIds = oldParent.childIds.filter(id => id !== activeNode.id);
        insertIndex = 0;
      } else if (isSameParent) {
        // Same parent: capture over's position BEFORE removing active,
        // then re-find after removal to handle shifted indices.
        // Direction matters: dragging DOWN → insert after over; UP → insert before (at) over.
        const overIdxBefore = newParent.childIds.indexOf(overNode.id);
        oldParent!.childIds = oldParent!.childIds.filter(id => id !== activeNode.id);
        const overIdxAfter = newParent.childIds.indexOf(overNode.id);
        // If over's index didn't change, active was above it (dragging down)
        // If over's index shifted back by 1, active was above it too — same formula
        insertIndex = draggingDown
          ? (overIdxAfter < 0 ? newParent.childIds.length : overIdxAfter + 1)
          : (overIdxAfter < 0 ? 0 : overIdxAfter);
        // Ensure overIdxBefore reference used to avoid unused-var lint
        void overIdxBefore;
      } else {
        // Cross-parent: remove from old parent, insert AT over's position in new parent
        if (oldParent) oldParent.childIds = oldParent.childIds.filter(id => id !== activeNode.id);
        const idx = newParent.childIds.indexOf(overNode.id);
        insertIndex = idx < 0 ? newParent.childIds.length : idx;
      }

      newParent.childIds.splice(insertIndex, 0, activeNode.id);
      activeNode.parentId = newParentId;

      // Persist: deduplicate nodes (same-parent means oldParent === newParent)
      const seen = new Set<string>();
      const toPersist: BaseNode[] = [];
      for (const n of [activeNode, newParent, ...(oldParent ? [oldParent] : [])]) {
        if (!seen.has(n.id)) { seen.add(n.id); toPersist.push(n); }
      }
      await putNodes(toPersist);

      // Auto-remove old window if it's now empty after cross-parent move
      if (!isSameParent && oldParent && oldParent.type === 'window' && oldParent.childIds.length === 0) {
        await removeNode(oldParent.id);
        if (oldParent.status === 'open' && oldParent.browserWindowId
            && typeof chrome !== 'undefined' && chrome.windows) {
          chrome.windows.remove(oldParent.browserWindowId).catch(() => {});
        }
      }

      // Chrome tab sync for live open tabs
      if (activeNode.type === 'tab' && activeNode.status === 'open' && activeNode.browserTabId) {
        if (newParent.type === 'window' && newParent.browserWindowId) {
          let physicalIndex = 0;
          for (let i = 0; i < insertIndex; i++) {
            const sibling = nodeMap.get(newParent.childIds[i]);
            if (sibling && sibling.status === 'open' && sibling.browserTabId) physicalIndex++;
          }
          chrome.runtime.sendMessage({
            type: "TAB_MOVED_UI",
            tabId: activeNode.browserTabId,
            windowId: newParent.browserWindowId,
            index: physicalIndex
          });
        } else if (newParent.type === 'group') {
          activeNode.status = 'saved';
          activeNode.active = false;
          const tabIdToClose = activeNode.browserTabId;
          activeNode.browserTabId = undefined;
          await putNode(activeNode);
          chrome.tabs.remove(tabIdToClose).catch(() => {});
        }
      }

      window.dispatchEvent(new CustomEvent('REFRESH_TREE'));
    } catch (e) {
      console.error('DND error:', e);
    }
  };

  const activeNode = useMemo(() => {
    const findNode = (nodes: TreeNode[], id: string): TreeNode | undefined => {
      for (const n of nodes) {
        if (n.id === id) return n;
        if (n.children) {
          const found = findNode(n.children, id);
          if (found) return found;
        }
      }
      return undefined;
    };
    return activeId ? findNode(treeData, activeId) : undefined;
  }, [activeId, treeData]);

  return (
    <div className="outliner-container">
      <div className="session-root">
        <span className="root-icon">🌐</span> Current Session
        <button className="btn-icon add-group-btn" onClick={addGroup} title="Add Group">📁+</button>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        // Single flat SortableContext — noopSortingStrategy stops phantom visual shifts
        <SortableContext items={allNodeIds} strategy={noopSortingStrategy}>
          {treeData.map(node => (
            <NodeItem key={node.id} node={node} isDragActive={activeId !== null} />
          ))}
        </SortableContext>

        <DragOverlay
          adjustScale={false}
          dropAnimation={null}  // Prevents the rubber-band snap-back animation on drop
        >
          {activeNode ? (
            <div className="drag-overlay-item">
              <TabIcon url={activeNode.url} favIconUrl={activeNode.favIconUrl} />
              <span>{activeNode.title}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

export default App;
