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
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function NodeItem({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: node.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
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
          <span className="drag-handle" {...attributes} {...listeners}>⣿</span>
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
          {/* No nested SortableContext — one flat context in App for cross-container support */}
          {node.children.map(child => (
            <NodeItem key={child.id} node={child} depth={depth + 1} />
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

    try {
      const nodes = await getAllNodes();
      // Deep-copy childIds arrays so we can mutate safely
      const nodeMap = new Map<string, BaseNode>(
        nodes.map(n => [n.id, { ...n, childIds: [...n.childIds] }])
      );

      const activeNode = nodeMap.get(active.id as string);
      const overNode = nodeMap.get(over.id as string);
      if (!activeNode || !overNode) return;

      const oldParentId = activeNode.parentId || 'root';
      const oldParent = nodeMap.get(oldParentId);

      // --- Determine new parent and insert index BEFORE any mutations ---
      let newParentId: string;
      let insertIndex: number;

      if (overNode.type === 'window' || overNode.type === 'group') {
        // Dropping ON a container → prepend as first child
        newParentId = overNode.id;
        insertIndex = 0;
      } else {
        // Dropping ON a sibling → insert AT that sibling's current position
        newParentId = overNode.parentId || 'root';
        const overParent = nodeMap.get(newParentId);
        const idx = overParent ? overParent.childIds.indexOf(overNode.id) : 0;
        insertIndex = idx < 0 ? 0 : idx;
      }

      // --- Step 1: Remove active from old parent ---
      if (oldParent) {
        oldParent.childIds = oldParent.childIds.filter(id => id !== activeNode.id);
      }

      // --- Step 2: If same parent, recalculate insert index after removal ---
      const newParent = nodeMap.get(newParentId);
      if (!newParent) return;

      if (oldParentId === newParentId) {
        // After removal the target may have shifted; find it again
        const idx = newParent.childIds.indexOf(overNode.id);
        insertIndex = idx < 0 ? 0 : idx;
      }

      // --- Step 3: Insert at correct position ---
      newParent.childIds.splice(insertIndex, 0, activeNode.id);
      activeNode.parentId = newParentId;

      // --- Step 4: Persist changed nodes ---
      const toPersist: BaseNode[] = [activeNode, newParent];
      if (oldParentId !== newParentId && oldParent) {
        toPersist.push(oldParent);
      }
      await putNodes(toPersist);

      // --- Step 5: Chrome tab sync for live open tabs ---
      if (activeNode.type === 'tab' && activeNode.status === 'open' && activeNode.browserTabId) {
        if (newParent.type === 'window' && newParent.browserWindowId) {
          // Count how many open tabs precede insertIndex to get physical browser index
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
          // Dragging a live tab into a group saves & closes it in Chrome
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
        {/* Single flat SortableContext with ALL node IDs enables cross-window drag */}
        <SortableContext items={allNodeIds} strategy={verticalListSortingStrategy}>
          {treeData.map(node => (
            <NodeItem key={node.id} node={node} />
          ))}
        </SortableContext>

        <DragOverlay adjustScale={false}>
          {activeNode ? (
            <div className="drag-overlay-item">
              {activeNode.favIconUrl && <img src={activeNode.favIconUrl} className="favicon" alt="" />}
              <span>{activeNode.title}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

export default App;
