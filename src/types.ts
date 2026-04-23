export type NodeType = "workspace" | "window" | "tab" | "group" | "separator";
export type NodeStatus = "open" | "saved" | "restoring" | "crashed" | "missing";

// Flat representation for storage
export interface BaseNode {
  id: string;
  type: NodeType;
  parentId: string | null;
  childIds: string[];
  title?: string;
  createdAt: number;
  updatedAt: number;
  sortOrder: number;
  collapsed?: boolean;
  color?: string;
  tags?: string[];
  
  // type-specific fields
  status?: NodeStatus;
  url?: string;
  favIconUrl?: string;
  browserTabId?: number;
  browserWindowId?: number;
  openerTabNodeId?: string;
  pinned?: boolean;
  audible?: boolean;
  muted?: boolean;
  incognito?: boolean;
  active?: boolean;
}

// Hydrated tree node for UI rendering — children is always populated during loadTree.
export type TreeNode = BaseNode & {
  children: TreeNode[];
};
