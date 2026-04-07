import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../src/App';

// Mock the storage layer so getAllNodes returns a predictable tree
vi.mock('../src/storage', () => ({
  getAllNodes: vi.fn().mockResolvedValue([
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
  ]),
  removeNode: vi.fn().mockResolvedValue(undefined)
}));

describe('App React Component System Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
