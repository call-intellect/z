/**
 * ТЗ 2026-06-04 (meeting-identity) Фаза 3.3 — мини-e2e для схемы payload
 * `meeting.invite` в registry. Проверяем, что `ConversationalService.sendNotification`
 * (через `validateEventPayload`) принимает валидный payload и отвергает мусор.
 */

import { describe, expect, it } from 'vitest';

import { validateEventPayload } from './event-payload.registry';

describe('event-payload registry — meeting.invite (Фаза 3.3)', () => {
  it('валидный payload {joinUrl, meetingTitle, hostName} проходит', () => {
    const out = validateEventPayload('meeting.invite', {
      joinUrl: 'https://app.kora.test/m/m-1?inv=tok123',
      meetingTitle: 'Планёрка',
      hostName: 'Сергей',
    });
    expect(out['joinUrl']).toBe('https://app.kora.test/m/m-1?inv=tok123');
    expect(out['meetingTitle']).toBe('Планёрка');
    expect(out['hostName']).toBe('Сергей');
  });

  it('отвергает payload без обязательных полей', () => {
    expect(() =>
      validateEventPayload('meeting.invite', { joinUrl: 'x' }),
    ).toThrow();
  });

  it('strict: отвергает лишние поля', () => {
    expect(() =>
      validateEventPayload('meeting.invite', {
        joinUrl: 'https://app.kora.test/m/m-1?inv=tok',
        meetingTitle: 'X',
        hostName: 'Y',
        extra: 'нельзя',
      }),
    ).toThrow();
  });
});
