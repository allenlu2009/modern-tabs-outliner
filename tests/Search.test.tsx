import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../src/App';

// Mock storage
const { mockNodes } = vi.hoisted(() => ({
  mockNodes: [
    { id: 'root', type: 'workspace', parentId: null, childIds: ['win-1', 'win-2'], createdAt: 0, updatedAt: 0, sortOrder: 0 },
    { id: 'win-1', type: 'window', title: 'Work Window', status: 'open', parentId: 'root', childIds: ['tab-1'], createdAt: 0, updatedAt: 0, sortOrder: 0 },
    { id: 'tab-1', type: 'tab', title: 'Google Docs', url: 'https://docs.google.com', status: 'open', parentId: 'win-1', browserTabId: 1, childIds: [], createdAt: 0, updatedAt: 0, sortOrder: 0 },
    { id: 'win-2', type: 'window', title: 'Private Window', status: 'open', parentId: 'root', childIds: ['tab-2'], createdAt: 0, updatedAt: 0, sortOrder: 0 },
    { id: 'tab-2', type: 'tab', title: 'Secret Recipe', url: 'https://recipes.com', status: 'open', parentId: 'win-2', browserTabId: 2, childIds: [], createdAt: 0, updatedAt: 0, sortOrder: 0 }
  ]
}));

vi.mock('../src/storage', () => ({
  getAllNodes: vi.fn(() => Promise.resolve([...mockNodes])),
  removeNode: vi.fn().mockResolvedValue(undefined),
  putNode: vi.fn().mockResolvedValue(undefined),
  putNodes: vi.fn().mockResolvedValue(undefined),
}));

describe('Search Functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters the tree based on tab title', async () => {
    render(<App />);

    // Wait for hydration
    expect(await screen.findByText('Google Docs')).toBeInTheDocument();
    expect(screen.getByText('Secret Recipe')).toBeInTheDocument();

    // Find search input
    const searchInput = screen.getByPlaceholderText(/Search tabs/);
    
    // Type "Google"
    fireEvent.change(searchInput, { target: { value: 'Google' } });

    // "Google Docs" should stay, "Secret Recipe" should disappear
    expect(screen.getByText('Google Docs')).toBeInTheDocument();
    expect(screen.queryByText('Secret Recipe')).not.toBeInTheDocument();
    
    // Parent "Work Window" should stay
    expect(screen.getByText('Work Window')).toBeInTheDocument();
    // Non-matching "Private Window" should disappear
    expect(screen.queryByText('Private Window')).not.toBeInTheDocument();
  });

  it('filters based on URL', async () => {
    render(<App />);
    const searchInput = await screen.findByPlaceholderText(/Search tabs/);

    fireEvent.change(searchInput, { target: { value: 'recipes.com' } });

    expect(screen.getByText('Secret Recipe')).toBeInTheDocument();
    expect(screen.queryByText('Google Docs')).not.toBeInTheDocument();
  });

  it('clears search results when X is clicked', async () => {
    render(<App />);
    const searchInput = await screen.findByPlaceholderText(/Search tabs/);

    fireEvent.change(searchInput, { target: { value: 'Google' } });
    expect(screen.queryByText('Secret Recipe')).not.toBeInTheDocument();

    const clearBtn = screen.getByTitle('Clear search');
    fireEvent.click(clearBtn);

    expect(screen.getByText('Secret Recipe')).toBeInTheDocument();
    expect(searchInput.innerHTML).toBe('');
  });
});
