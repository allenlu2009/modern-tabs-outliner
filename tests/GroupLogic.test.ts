import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleMessage } from '../src/background-logic';
import * as storage from '../src/storage';

vi.mock('../src/storage', () => ({
  getAllNodes: vi.fn(),
  putNode: vi.fn(),
  putNodes: vi.fn(),
  clearAllNodes: vi.fn(),
  removeNode: vi.fn()
}));

describe('Group Logic & Restoration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('RESTORE_NODE finds parent window browser ID even if tab is inside a group', async () => {
    const mockNodes = [
      { id: 'win-1', type: 'window', browserWindowId: 100, status: 'open', childIds: ['group-1'] },
      { id: 'group-1', type: 'group', parentId: 'win-1', childIds: ['tab-1'] },
      { id: 'tab-1', type: 'tab', parentId: 'group-1', url: 'https://site.com', status: 'saved' }
    ];

    (storage.getAllNodes as any).mockResolvedValue(mockNodes);
    (global.chrome.windows.getAll as any).mockResolvedValue([{ id: 100, type: 'normal' }]);

    await handleMessage({ type: 'RESTORE_NODE', nodeId: 'tab-1', url: 'https://site.com' });

    // Verify it targeted window 100 (from win-1)
    expect(chrome.tabs.create).toHaveBeenCalledWith(expect.objectContaining({
      windowId: 100,
      url: 'https://site.com'
    }));
  });

  it('Batch Restore Window includes tabs nested inside groups', async () => {
    const mockNodes = [
      { id: 'win-1', type: 'window', childIds: ['group-1', 'tab-top'], status: 'saved' },
      { id: 'group-1', type: 'group', parentId: 'win-1', childIds: ['tab-nested'], status: 'saved' },
      { id: 'tab-top', type: 'tab', parentId: 'win-1', url: 'https://top.com', status: 'saved' },
      { id: 'tab-nested', type: 'tab', parentId: 'group-1', url: 'https://nested.com', status: 'saved' }
    ];

    (storage.getAllNodes as any).mockResolvedValue(mockNodes);
    const mockWin = { id: 500, tabs: [{ id: 1 }, { id: 2 }] };
    (global.chrome.windows.create as any).mockResolvedValue(mockWin);

    await handleMessage({ type: 'RESTORE_NODE', nodeId: 'win-1' });

    // Verify it gathered BOTH nested and top tabs
    expect(chrome.windows.create).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.arrayContaining(['https://nested.com', 'https://top.com'])
    }));
  });
});
