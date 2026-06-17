import { describe, expect, it } from 'vitest';

import { MockAdapter } from './mock.adapter';

describe('MockAdapter', () => {
  const adapter = new MockAdapter();

  it('возвращает фикстуру Сбера для 7707083893', async () => {
    const result = await adapter.lookup('7707083893');
    expect(result).not.toBeNull();
    expect(result?.source).toBe('mock');
    expect(result?.payerType).toBe('legal_entity');
    expect(result?.inn).toBe('7707083893');
    expect(result?.kpp).toBe('773601001');
    expect(result?.ogrn).toBe('1027700132195');
    expect(result?.legalName).toContain('СБЕРБАНК');
  });

  it('возвращает фикстуру Точки с bankBik для 9721194461', async () => {
    const result = await adapter.lookup('9721194461');
    expect(result).not.toBeNull();
    expect(result?.source).toBe('mock');
    expect(result?.payerType).toBe('legal_entity');
    expect(result?.bankBik).toBe('044525104');
  });

  it('возвращает фикстуру ИП для 500100732259', async () => {
    const result = await adapter.lookup('500100732259');
    expect(result).not.toBeNull();
    expect(result?.payerType).toBe('individual_entrepreneur');
    expect(result?.kpp).toBeNull();
    expect(result?.legalName).toContain('Индивидуальный предприниматель');
  });

  it('возвращает null для несуществующего ИНН', async () => {
    expect(await adapter.lookup('9999999999')).toBeNull();
    expect(await adapter.lookup('123456789012')).toBeNull();
  });

  it("trim'ит входной ИНН", async () => {
    const result = await adapter.lookup('  7707083893  ');
    expect(result).not.toBeNull();
    expect(result?.inn).toBe('7707083893');
  });
});
