import { beforeEach, describe, expect, it } from 'vitest';

import {
  isChunkLoadError,
  shouldReloadOnChunkError,
} from '../chunk-reload';

function installMemorySessionStorage() {
  const store = new Map<string, string>();
  const mock = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
  Object.defineProperty(window, 'sessionStorage', {
    value: mock,
    writable: true,
    configurable: true,
  });
}

describe('isChunkLoadError', () => {
  it('ловит ошибку по имени ChunkLoadError', () => {
    expect(isChunkLoadError({ name: 'ChunkLoadError' })).toBe(true);
  });

  it('ловит ошибку по тексту "Loading chunk ... failed"', () => {
    expect(isChunkLoadError({ message: 'Loading chunk 964 failed' })).toBe(true);
  });

  it('ловит ошибку по тексту "Failed to load chunk"', () => {
    expect(isChunkLoadError({ message: 'Failed to load chunk app/page' })).toBe(
      true,
    );
  });

  it('не ловит обычную ошибку', () => {
    expect(isChunkLoadError({ name: 'Error', message: 'boom' })).toBe(false);
  });

  it('не ловит null', () => {
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe('shouldReloadOnChunkError', () => {
  beforeEach(() => {
    installMemorySessionStorage();
  });

  it('первый вызов разрешает reload и фиксирует время', () => {
    expect(shouldReloadOnChunkError(1_000_000)).toBe(true);
  });

  it('повторный вызов в пределах окна блокирует reload (анти-цикл)', () => {
    expect(shouldReloadOnChunkError(1_000_000)).toBe(true);
    expect(shouldReloadOnChunkError(1_000_500)).toBe(false);
  });

  it('после истечения окна reload снова разрешён', () => {
    expect(shouldReloadOnChunkError(1_000_000)).toBe(true);
    expect(shouldReloadOnChunkError(1_000_500)).toBe(false);
    expect(shouldReloadOnChunkError(1_020_000)).toBe(true);
  });
});
