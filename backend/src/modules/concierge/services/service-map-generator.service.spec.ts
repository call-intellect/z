import { describe, expect, it, beforeAll } from 'vitest';

import { ServiceMapGeneratorService } from './service-map-generator.service';

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

  // ───────── Ф6/Ф5 (2026-06-18) — формат online + контрагент ─────────

  it('make_event_online — POST /events/:id/make-online, event_card.write, id required', () => {
    const t = svc.findTool('make_event_online');
    expect(t).not.toBeNull();
    expect(t?.method).toBe('POST');
    expect(t?.path).toBe('/api/v1/events/:id/make-online');
    expect(t?.rbacResource).toBe('event_card');
    expect(t?.rbacAction).toBe('write');
    expect(t?.parameters.required).toEqual(['id']);
    expect(t?.undoableVia).toBe('delete_event');
  });

  it('create_event имеет параметры online и counterparty', () => {
    const t = svc.findTool('create_event');
    const props = t?.parameters.properties ?? {};
    expect(Object.keys(props)).toContain('online');
    expect(Object.keys(props)).toContain('counterparty');
  });

  // ───────── Ф4 (2026-06-18) — рабочий профиль (set_my_work_profile) ─────────

  it('set_my_work_profile — PATCH /me/work-profile, self-scoped (без RBAC), readOnly', () => {
    const t = svc.findTool('set_my_work_profile');
    expect(t).not.toBeNull();
    expect(t?.method).toBe('PATCH');
    expect(t?.path).toBe('/api/v1/me/work-profile');
    // self-scoped /me/* — без rbacResource (как ingest_note); readOnly чтобы не
    // требовать подтверждения в канале.
    expect(t?.rbacResource).toBeUndefined();
    expect(t?.readOnly).toBe(true);
    const props = t?.parameters.properties ?? {};
    expect(Object.keys(props).sort()).toEqual([
      'timezone',
      'workEndHour',
      'workStartHour',
      'workingDays',
    ]);
    // Все поля опциональны — required не выставлен.
    expect(t?.parameters.required ?? []).toEqual([]);
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
    expect(t?.parameters.required).toEqual(['participantUserIds', 'durationMin']);
  });

  it('readOnly: find_free_slot и ask_chat_v2 помечены, мутирующие — нет', () => {
    expect(svc.findTool('find_free_slot')?.readOnly).toBe(true);
    expect(svc.findTool('ask_chat_v2')?.readOnly).toBe(true);
    expect(svc.findTool('create_event')?.readOnly).toBeUndefined();
    expect(svc.findTool('infer_table_schema')?.readOnly).toBeUndefined();
  });

  it('search_knowledge УДАЛЁН из реестра помощника', () => {
    expect(svc.findTool('search_knowledge')).toBeNull();
    expect(svc.getTools().map((t) => t.name)).not.toContain('search_knowledge');
  });

  it('create_task — POST /me/tasks, issue/write, title required, без undoableVia', () => {
    const t = svc.findTool('create_task');
    expect(t).not.toBeNull();
    expect(t?.method).toBe('POST');
    expect(t?.path).toBe('/api/v1/me/tasks');
    expect(t?.rbacResource).toBe('issue');
    expect(t?.rbacAction).toBe('write');
    expect(t?.parameters.required).toEqual(['title']);
    expect(t?.undoableVia).toBeUndefined();
    expect(t?.readOnly).toBeUndefined();
    expect(t?.description).toContain('Используй');
  });

  it('search_tasks — GET /me/inbox, issue/read, readOnly', () => {
    const t = svc.findTool('search_tasks');
    expect(t).not.toBeNull();
    expect(t?.method).toBe('GET');
    expect(t?.path).toBe('/api/v1/me/inbox');
    expect(t?.rbacResource).toBe('issue');
    expect(t?.rbacAction).toBe('read');
    expect(t?.readOnly).toBe(true);
    expect(t?.description).toContain('Используй');
  });

  it('ingest_note — POST /me/notifications/free-note, БЕЗ rbacResource, readOnly, text required', () => {
    const t = svc.findTool('ingest_note');
    expect(t).not.toBeNull();
    expect(t?.method).toBe('POST');
    expect(t?.path).toBe('/api/v1/me/notifications/free-note');
    expect(t?.rbacResource).toBeUndefined();
    expect(t?.readOnly).toBe(true);
    expect(t?.parameters.required).toEqual(['text']);
    expect(t?.description).toContain('Используй');
  });

  it('list_tasks — описание отделяет действия-задачи из встреч от трекера (search_tasks)', () => {
    const t = svc.findTool('list_tasks');
    expect(t).not.toBeNull();
    expect(t?.path).toBe('/api/v1/tasks');
    expect(t?.description).toContain('Используй');
    expect(t?.description).toContain('search_tasks');
  });

  it('у create_meeting/cancel_meeting/ask_chat_v2 — внятное «Используй для…»', () => {
    expect(svc.findTool('create_meeting')?.description).toContain('Используй');
    expect(svc.findTool('cancel_meeting')?.description).toContain('Используй');
    expect(svc.findTool('ask_chat_v2')?.description).toContain('Используй');
  });

  it('delete_event uses DELETE method and event_card.delete RBAC', () => {
    const t = svc.findTool('delete_event');
    expect(t?.method).toBe('DELETE');
    expect(t?.path).toBe('/api/v1/events/:id');
    expect(t?.rbacResource).toBe('event_card');
    expect(t?.rbacAction).toBe('delete');
    expect(t?.parameters.required).toEqual(['id']);
  });

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

  it('list_overdue_promises — GET /dashboard/operations/open-commitments, dashboard_operations.read', () => {
    const t = svc.findTool('list_overdue_promises');
    expect(t?.method).toBe('GET');
    expect(t?.path).toBe('/api/v1/dashboard/operations/open-commitments');
    expect(t?.rbacResource).toBe('dashboard_operations');
    expect(t?.rbacAction).toBe('read');
    expect(t?.parameters.required ?? []).toEqual([]);
    expect(Object.keys(t?.parameters.properties ?? {}).sort()).toEqual(['days', 'limit']);
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

  it('Ф6: toLlmTools(names) сужает список до whitelist, без аргумента — все tools', () => {
    const all = svc.toLlmTools();
    expect(all).toHaveLength(svc.getTools().length);

    const narrowed = svc.toLlmTools(['list_tasks', 'ask_chat_v2']);
    expect(narrowed.map((t) => t.name).sort()).toEqual(['ask_chat_v2', 'list_tasks']);
  });

  it('Ф6: buildToolUsePromptFragment(names) сужает legacy-фрагмент; неизвестные имена игнорируются', () => {
    const fragment = svc.buildToolUsePromptFragment(['list_meetings', 'tool_kotorogo_net']);
    const parsed = JSON.parse(fragment) as Array<{ name: string }>;
    expect(parsed.map((t) => t.name)).toEqual(['list_meetings']);

    const full = JSON.parse(svc.buildToolUsePromptFragment()) as unknown[];
    expect(full.length).toBe(svc.getTools().length);
  });
});
