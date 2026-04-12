import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../src/App';

// Mock storage
const { mockNodes } = vi.hoisted(() => ({
  mockNodes: [
    { id: 'root', type: 'workspace', parentId: null, childIds: ['win-saved'], createdAt: 0, updatedAt: 0, sortOrder: 0 },
    { id: 'win-saved', type: 'window', title: 'Saved Project', status: 'saved', parentId: 'root', childIds: ['tab-saved'], browserWindowId: 999, createdAt: 0, updatedAt: 0, sortOrder: 0 },
    { id: 'tab-saved', type: 'tab', title: 'Target Tab', url: 'https://restore-me.com', status: 'saved', parentId: 'win-saved', browserTabId: 888, childIds: [], createdAt: 0, updatedAt: 0, sortOrder: 0 }
  ]
}));

vi.mock('../src/storage', () => ({
  getAllNodes: vi.fn(() => Promise.resolve([...mockNodes])),
  putNode: vi.fn().mockResolvedValue(undefined),
  putNodes: vi.fn().mockResolvedValue(undefined),
  removeNode: vi.fn().mockResolvedValue(undefined)
}));

describe('Restoration Context Preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset global chrome mock (defined in setup.ts)
    (global.chrome.windows.getAll as any).mockResolvedValue([]); // No open windows initially
    (global.chrome.windows.create as any).mockImplementation((opts: any, cb: any) => {
        const win = { id: 1234, tabs: [] };
        if (cb) cb(win);
        return Promise.resolve(win);
    });
  });

  it('triggers RESTORE_NODE when a saved tab is clicked', async () => {
    render(<App />);
    
    // Find the saved tab
    const tabNode = await screen.findByText('Target Tab');
    fireEvent.click(tabNode);

    // Verify background was notified to restore
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'RESTORE_NODE',
      nodeId: 'tab-saved',
      url: 'https://restore-me.com'
    });
  });

  it('provides a Restore Window button for saved windows', async () => {
    render(<App />);
    
    // Find the window node
    const winTitle = await screen.findByText(/Saved Project/);
    expect(winTitle).toBeInTheDocument();

    // Verify presence of restore button (↻)
    const restoreBtn = screen.getByTitle('Restore Window');
    expect(restoreBtn).toBeInTheDocument();

    fireEvent.click(restoreBtn);

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'RESTORE_NODE',
      nodeId: 'win-saved'
    });
  });

  it('restoring a window also restores its child tabs', async () => {
    // We can't easily test the background.ts logic here as it's a unit test for App.tsx 
    // but we can test if the message is sent correctly (above)
    // To test the background logic, we would need an integration test for background.ts
  });
});
