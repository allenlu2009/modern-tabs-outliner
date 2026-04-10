import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../src/App';

const { mockNodes } = vi.hoisted(() => ({
  mockNodes: [
    {
      id: 'root',
      type: 'workspace',
      parentId: null,
      childIds: ['win-1'],
      createdAt: 0,
      updatedAt: 0,
      sortOrder: 0
    },
    {
      id: 'win-1',
      type: 'window',
      title: 'Main Window',
      status: 'open',
      parentId: 'root',
      childIds: ['tab-1'],
      createdAt: 0,
      updatedAt: 0,
      sortOrder: 0
    },
    {
      id: 'tab-1',
      type: 'tab',
      title: 'Hanging Test Tab',
      url: 'https://test.com',
      status: 'open',
      parentId: 'win-1',
      browserTabId: 999,
      childIds: [],
      createdAt: 0,
      updatedAt: 0,
      sortOrder: 0
    }
  ]
}));

vi.mock('../src/storage', () => ({
  getAllNodes: vi.fn(() => Promise.resolve([...mockNodes])),
  removeNode: vi.fn((id) => {
    const idx = mockNodes.findIndex(n => n.id === id);
    if (idx !== -1) mockNodes.splice(idx, 1);
    return Promise.resolve();
  }),
  putNode: vi.fn().mockResolvedValue(undefined),
  putNodes: vi.fn().mockResolvedValue(undefined),
}));

describe('App React Component System Integration', () => {
  const INITIAL_NODES = [
    { id: 'root', type: 'workspace', parentId: null, childIds: ['win-1'], createdAt: 0, updatedAt: 0, sortOrder: 0 },
    { id: 'win-1', type: 'window', title: 'Main Window', status: 'open', parentId: 'root', childIds: ['tab-1'], createdAt: 0, updatedAt: 0, sortOrder: 0 },
    { id: 'tab-1', type: 'tab', title: 'Hanging Test Tab', url: 'https://test.com', status: 'open', parentId: 'win-1', browserTabId: 999, childIds: [], createdAt: 0, updatedAt: 0, sortOrder: 0 }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockNodes.length = 0;
    mockNodes.push(...INITIAL_NODES);
  });

  it('securely processes intentional closes without hanging promises', async () => {
    // We mock chrome.runtime.sendMessage to instantly resolve to simulate a well-behaved background worker (no hanging 'return true')
    (global as any).chrome.runtime.sendMessage.mockResolvedValue(true);
    
    render(<App />);

    // Wait for async tree hydration
    const tabTitle = await screen.findByText('Hanging Test Tab');
    expect(tabTitle).toBeInTheDocument();

    // Find the Close (X) button natively injected for open tabs
    const closeBtn = screen.getByTitle('Close Tab');
    
    // Fire the close click
    fireEvent.click(closeBtn);

    // Because the mocked sendMessage securely evaluates, the sequential browser remove string should successfully trigger.
    expect((global as any).chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "INTENTIONAL_SAVE", nodeId: 'tab-1' });

    // Validate the remove function physically executes across Chrome without freezing
    // Need a tiny flush delay since the click is async
    await new Promise(resolve => setTimeout(resolve, 0));
    expect((global as any).chrome.tabs.remove).toHaveBeenCalledWith(999);
  });

  it('automatically removes empty window when last tab is deleted', async () => {
    // Mock chrome APIs as needed
    (global as any).chrome.tabs.remove.mockResolvedValue(undefined);
    
    render(<App />);

    // Wait for async tree hydration
    const tabTitle = await screen.findByText('Hanging Test Tab');
    expect(tabTitle).toBeInTheDocument();

    // Find the Remove button for the tab (Trash can icon)
    const removeBtn = screen.getByTitle('Remove Node');
    
    // Fire the remove click
    fireEvent.click(removeBtn);

    // Give some time for async cleanup logic
    await new Promise(resolve => setTimeout(resolve, 10));

    // The storage removeNode should be called for BOTH the tab and the window
    const storage = await import('../src/storage');
    expect(storage.removeNode).toHaveBeenCalledWith('tab-1');
    expect(storage.removeNode).toHaveBeenCalledWith('win-1');
  });
});
