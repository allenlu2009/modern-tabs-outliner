import type { BaseNode } from "./types";

const DB_NAME = "tab-session-manager";
const DB_VERSION = 1;
const STORE_NAME = "nodes";

// Cache the connection promise so we don't open a new IDB handle per call.
let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => { dbPromise = null; reject(request.error); };
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("parentId", "parentId", { unique: false });
          store.createIndex("type", "type", { unique: false });
          store.createIndex("status", "status", { unique: false });
        }
      };
    });
  }
  return dbPromise;
}

export async function putNode(node: BaseNode): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(node);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function putNodes(nodes: BaseNode[]): Promise<void> {
  if (nodes.length === 0) return;
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    nodes.forEach(node => store.put(node));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllNodes(): Promise<BaseNode[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function removeNode(id: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Recursively removes a node and all of its descendants from storage.
 * Use this instead of removeNode whenever deleting containers (windows, groups).
 */
export async function removeSubtree(rootId: string): Promise<void> {
  const allNodes = await getAllNodes();
  const nodeMap = new Map(allNodes.map(n => [n.id, n]));

  const idsToDelete: string[] = [];
  const collect = (id: string) => {
    const node = nodeMap.get(id);
    if (!node) return;
    idsToDelete.push(id);
    for (const childId of node.childIds || []) {
      collect(childId);
    }
  };
  collect(rootId);

  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    idsToDelete.forEach(id => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllNodes(): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => { dbPromise = null; resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}
