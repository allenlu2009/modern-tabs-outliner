import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Global strictly mocked Chrome Extension API
const chromeMock = {
  runtime: {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  tabs: {
    remove: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue(true),
    update: vi.fn().mockResolvedValue(true),
  },
  windows: {
    update: vi.fn().mockResolvedValue(true),
  }
};

(global as any).chrome = chromeMock;
