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

  it('exposes calendar MVP tools (Фаза 1.3)', () => {
    const tools = svc.getTools();
    expect(tools.find((t) => t.name === 'create_event')).toBeDefined();
    expect(tools.find((t) => t.name === 'list_my_events')).toBeDefined();
    expect(tools.find((t) => t.name === 'list_user_events')).toBeDefined();
    expect(tools.find((t) => t.name === 'find_free_slot')).toBeDefined();
    expect(tools.find((t) => t.name === 'delete_event')).toBeDefined();
  });

  it('create_event is undoable via delete_event', () => {
    const t = svc.findTool('create_event');
    expect(t?.method).toBe('POST');
    expect(t?.path).toBe('/api/v1/events');
    expect(t?.undoableVia).toBe('delete_event');
    expect(t?.rbacResource).toBe('event_card');
    expect(t?.rbacAction).toBe('write');
    expect(t?.parameters.required).toEqual(['title', 'startAt']);
  });

  it('list_my_events is a read tool on /me/calendar', () => {
    const t = svc.findTool('list_my_events');
    expect(t?.method).toBe('GET');
    expect(t?.path).toBe('/api/v1/me/calendar');
    expect(t?.rbacAction).toBe('read');
  });

  it('list_user_events requires userId param', () => {
    const t = svc.findTool('list_user_events');
    expect(t?.method).toBe('GET');
    expect(t?.path).toBe('/api/v1/users/:userId/calendar');
    expect(t?.parameters.required).toEqual(['userId']);
  });

  it('find_free_slot requires participantUserIds and durationMin', () => {
    const t = svc.findTool('find_free_slot');
    expect(t?.method).toBe('POST');
    expect(t?.path).toBe('/api/v1/events/find-free-slot');
    expect(t?.parameters.required).toEqual([
      'participantUserIds',
      'durationMin',
    ]);
  });

  it('delete_event uses DELETE method and event_card.delete RBAC', () => {
    const t = svc.findTool('delete_event');
    expect(t?.method).toBe('DELETE');
    expect(t?.path).toBe('/api/v1/events/:id');
    expect(t?.rbacResource).toBe('event_card');
    expect(t?.rbacAction).toBe('delete');
    expect(t?.parameters.required).toEqual(['id']);
  });

  // ───────────────────── Pulse Wave 5 §5.5 — Concierge tools ─────────────────────

  it('exposes Pulse Wave 5 director tools', () => {
    const tools = svc.getTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('get_person_pulse');
    expect(names).toContain('list_overdue_promises');
    expect(names).toContain('get_sprint_status');
    expect(names).toContain('get_team_health');
    expect(names).toContain('list_ignored_probe_questions');
  });

  it('Pulse Wave 5 tools все имеют rbacResource + rbacAction', () => {
    const names = [
      'get_person_pulse',
      'list_overdue_promises',
      'get_sprint_status',
      'get_team_health',
      'list_ignored_probe_questions',
    ];
    for (const name of names) {
      const t = svc.findTool(name);
      expect(t, `tool ${name} должен быть зарегистрирован`).not.toBeNull();
      expect(t?.rbacResource, `${name} → rbacResource`).toBeTruthy();
      expect(t?.rbacAction, `${name} → rbacAction`).toBeTruthy();
    }
  });

  it('get_person_pulse — GET /persons/:personId/pulse, person.read, personId required', () => {
    const t = svc.findTool('get_person_pulse');
    expect(t).not.toBeNull();
    expect(t?.method).toBe('GET');
    expect(t?.path).toBe('/api/v1/persons/:personId/pulse');
    expect(t?.rbacResource).toBe('person');
    expect(t?.rbacAction).toBe('read');
    expect(t?.parameters.required).toEqual(['personId']);
  });

  it('list_overdue_promises — GET /dashboard/commitment-reliability, dashboard_operations.read', () => {
    const t = svc.findTool('list_overdue_promises');
    expect(t?.method).toBe('GET');
    expect(t?.path).toBe('/api/v1/dashboard/commitment-reliability');
    expect(t?.rbacResource).toBe('dashboard_operations');
    expect(t?.rbacAction).toBe('read');
    // scope/scopeId опц. — required не должен быть выставлен.
    expect(t?.parameters.required ?? []).toEqual([]);
  });

  it('get_sprint_status — GET /cycles/:cycleId/dashboard, cycle.read, cycleId required', () => {
    const t = svc.findTool('get_sprint_status');
    expect(t?.method).toBe('GET');
    expect(t?.path).toBe('/api/v1/cycles/:cycleId/dashboard');
    expect(t?.rbacResource).toBe('cycle');
    expect(t?.rbacAction).toBe('read');
    expect(t?.parameters.required).toEqual(['cycleId']);
  });

  it('get_team_health — GET /dashboard/team-health, dashboard_operations.read', () => {
    const t = svc.findTool('get_team_health');
    expect(t?.method).toBe('GET');
    expect(t?.path).toBe('/api/v1/dashboard/team-health');
    expect(t?.rbacResource).toBe('dashboard_operations');
    expect(t?.rbacAction).toBe('read');
  });

  it('list_ignored_probe_questions — GET /feed/probe_question, activity_feed_item.read', () => {
    const t = svc.findTool('list_ignored_probe_questions');
    expect(t?.method).toBe('GET');
    expect(t?.path).toBe('/api/v1/feed/probe_question');
    expect(t?.rbacResource).toBe('activity_feed_item');
    expect(t?.rbacAction).toBe('read');
  });
});
