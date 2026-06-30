import { describe, expect, it } from 'vitest';

import { SIGNAL_TYPE_VALUES } from './block-ingest.prompt';
import {
  SIGNAL_TYPE_REGISTRY,
  renderSignalTypeRegistry,
} from './signal-type-registry';

describe('signal-type-registry — реестр определений 57 типов', () => {
  it('каждый код enum имеет запись в реестре (нет пропусков)', () => {
    const missing = SIGNAL_TYPE_VALUES.filter(
      (code) => !SIGNAL_TYPE_REGISTRY[code],
    );
    expect(missing).toEqual([]);
  });

  it('в реестре нет лишних типов сверх enum', () => {
    const allowed = new Set<string>(SIGNAL_TYPE_VALUES);
    const extra = Object.keys(SIGNAL_TYPE_REGISTRY).filter(
      (code) => !allowed.has(code),
    );
    expect(extra).toEqual([]);
  });

  it('запись.type совпадает с ключом и непустые определение/пример/анти-паттерн', () => {
    for (const [code, entry] of Object.entries(SIGNAL_TYPE_REGISTRY)) {
      expect(entry.type).toBe(code);
      expect(entry.definition.trim().length).toBeGreaterThan(0);
      expect(entry.example.trim().length).toBeGreaterThan(0);
      expect(entry.antiPattern.trim().length).toBeGreaterThan(0);
    }
  });

  it('renderSignalTypeRegistry возвращает непустую строку со всеми 57 кодами', () => {
    const rendered = renderSignalTypeRegistry();
    expect(rendered.trim().length).toBeGreaterThan(0);
    for (const code of SIGNAL_TYPE_VALUES) {
      expect(rendered, `нет кода ${code} в выводе реестра`).toContain(code);
    }
  });
});
