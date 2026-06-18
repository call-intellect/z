/**
 * ТЗ assistant-calendar-master Ф8 — семантика `isOnline` и поле `counterparty`.
 *
 * Ключевой инвариант после Ф6/Ф8: «онлайн» (есть видеокомната) определяется
 * полем `Event.online`, а НЕ типом `kind`. Очная встреча типа `meeting`
 * (online=false) не должна считаться онлайн. `counterparty` пробрасывается.
 */
import { describe, expect, it } from 'vitest';

import type { EventApi, EventKindApi } from '@/api/calendar.api';
import { toCalendarEvent } from './calendar';

function eventApi(overrides: Partial<EventApi> = {}): EventApi {
  return {
    id: 'evt-1',
    entityId: 'ent-1',
    kind: 'meeting' as EventKindApi,
    title: 'Встреча',
    startAt: '2026-06-18T07:00:00.000Z',
    endAt: '2026-06-18T07:30:00.000Z',
    durationMin: 30,
    location: null,
    counterparty: null,
    online: false,
    relatedMeetingId: null,
    joinUrl: null,
    createdAt: '2026-06-18T06:00:00.000Z',
    updatedAt: '2026-06-18T06:00:00.000Z',
    deletedAt: null,
    participantsPersonIds: [],
    outcomeSummary: null,
    metadata: null,
    ownerId: null,
    description: null,
    allDay: false,
    timezone: 'Europe/Moscow',
    rrule: null,
    status: 'confirmed',
    visibility: 'company',
    externalProvider: null,
    externalEventId: null,
    projectId: null,
    participants: [],
    reminders: [],
    ...overrides,
  };
}

describe('toCalendarEvent — isOnline из Event.online, не из kind', () => {
  it('online=true → isOnline=true', () => {
    const dom = toCalendarEvent(eventApi({ online: true, kind: 'call' }));
    expect(dom.isOnline).toBe(true);
  });

  it('online=false, kind=meeting → isOnline=false (очная встреча)', () => {
    const dom = toCalendarEvent(eventApi({ online: false, kind: 'meeting' }));
    expect(dom.isOnline).toBe(false);
  });

  it('counterparty прокидывается в domain', () => {
    const dom = toCalendarEvent(
      eventApi({ counterparty: 'Александр, молочный завод' }),
    );
    expect(dom.counterparty).toBe('Александр, молочный завод');
  });

  it('counterparty=null остаётся null', () => {
    const dom = toCalendarEvent(eventApi({ counterparty: null }));
    expect(dom.counterparty).toBeNull();
  });
});
