import { describe, expect, it, beforeAll } from 'vitest';

import { ServiceMapGeneratorService } from './service-map-generator.service';

/**
 * SBA γ-2 — smoke-тест ServiceMapGeneratorService.
 *
 * Проверяем что:
 *   - onModuleInit() заполняет ненулевой список tools;
 *   - findTool() возвращает entry по имени;
 *   - buildToolUsePromptFragment() возвращает валидный JSON.
 */
describe('ServiceMapGeneratorService', () => {
  const svc = new ServiceMapGeneratorService();
  beforeAll(() => {
    svc.onModuleInit();
  });

  it('loads non-empty tool map', () => {
    const tools = svc.getTools();
    expect(tools.length).toBeGreaterThan(0);
  });

  it('finds known tool by name', () => {
    const t = svc.findTool('create_meeting');
    expect(t).not.toBeNull();
    expect(t?.method).toBe('POST');
  });

  it('returns null for unknown tool', () => {
    expect(svc.findTool('not_a_real_tool')).toBeNull();
  });

  it('buildToolUsePromptFragment produces valid JSON array', () => {
    const fragment = svc.buildToolUsePromptFragment();
    const parsed = JSON.parse(fragment) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  it('mutating tools (create_meeting) have undoableVia', () => {
    const t = svc.findTool('create_meeting');
    expect(t?.undoableVia).toBe('cancel_meeting');
  });
});
