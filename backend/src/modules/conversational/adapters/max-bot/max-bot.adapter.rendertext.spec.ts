import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../../common/config/index';
import type { CryptoService } from '../../../../common/crypto/crypto.service';
import type { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../../common/prisma/prisma.service';
import type { RedisService } from '../../../../common/redis/redis.service';
import type { VoxService } from '../../../ai/services/vox.service';
import type { QueryClassifierService } from '../../../dialog-layer/services/query-classifier.service';
import type { DocumentsService } from '../../../documents/documents.service';
import type { ChannelRegistry } from '../../channel-registry';
import type { ConversationalLinkCodeService } from '../../link-code.service';

import type { MaxApiClient } from './max-api-client';
import { MaxBotChannelAdapter } from './max-bot.adapter';

function makeAdapter(): MaxBotChannelAdapter {
  return new MaxBotChannelAdapter(
    { register: vi.fn() } as unknown as ChannelRegistry,
    {} as unknown as PrismaService,
    {} as unknown as RedisService,
    {} as unknown as CryptoService,
    {} as unknown as MaxApiClient,
    {} as unknown as ConversationalLinkCodeService,
    {} as unknown as BusinessMetricsService,
    {} as unknown as VoxService,
    {} as unknown as DocumentsService,
    {} as unknown as QueryClassifierService,
    {} as unknown as TypedConfigService,
  );
}

describe('MaxBotChannelAdapter.renderText — видимые брифы (Ф2 assistant-channels)', () => {
  const render = (eventType: string, payload: Record<string, unknown>): string => {
    const adapter = makeAdapter();
    return (
      adapter as unknown as {
        renderText: (n: { eventType: string; payload: Record<string, unknown> }) => string;
      }
    ).renderText({ eventType, payload });
  };

  const cases: Array<[string, Record<string, unknown>, string[]]> = [
    [
      'checkin.prompt',
      {
        kind: 'checkin',
        checkInKind: 'morning',
        personId: 'p-1',
        dateLocal: '2026-06-12',
        question: 'Какие 1-3 задачи у вас в фокусе сегодня?',
      },
      ['Какие 1-3 задачи у вас в фокусе сегодня?', 'Ответьте текстом или голосом — Кора запишет.'],
    ],
    [
      'operations.weekly_digest',
      {
        digestId: 'd-1',
        weekStart: '2026-06-08',
        weekEnd: '2026-06-14',
        title: 'Итоги недели',
        body: 'Закрыто 12 задач, 3 риска требуют внимания.',
        actionUrl: 'https://app.kora.test/digest/d-1',
      },
      ['Итоги недели', 'Закрыто 12 задач', 'https://app.kora.test/digest/d-1'],
    ],
    [
      'goals.pulse',
      {
        digestId: 'd-2',
        isoWeek: '2026-W24',
        title: 'Пульс целей',
        body: 'Цель «Выручка» — 80% к плану.',
        actionUrl: 'https://app.kora.test/goals',
      },
      ['Пульс целей', 'Выручка', 'https://app.kora.test/goals'],
    ],
    [
      'operations.monthly_recap',
      {
        snapshotId: 's-1',
        periodYm: '2026-05',
        title: 'Итоги мая',
        body: 'Главное за месяц: запуск брифов.',
        actionUrl: 'https://app.kora.test/recap',
      },
      ['Итоги мая', 'запуск брифов'],
    ],
    [
      'proactive.notification',
      {
        proactiveNotificationId: 'pn-1',
        ruleType: 'stale_goal',
        severity: 'warning',
        title: 'Цель без движения',
        body: 'Цель «Найм» не обновлялась 14 дней.',
      },
      ['Цель без движения', 'Найм'],
    ],
    [
      'event.reminder',
      {
        eventId: 'e-1',
        eventTitle: 'Планёрка отдела',
        startAtIso: '2026-06-12T09:30:00.000Z',
        offsetMin: 15,
        location: 'Переговорка 2',
        actionUrl: 'https://app.kora.test/calendar',
      },
      ['Планёрка отдела', '09:30 12.06', '(UTC)', 'Переговорка 2'],
    ],
    [
      'issue.mention',
      {
        issueId: 'i-1',
        commentId: 'c-1',
        byUserId: 'u-1',
        snippet: 'Посмотри, пожалуйста, оценку по этой задаче',
        issueIdentifier: 'KOR-42',
      },
      ['Вас упомянули в задаче', 'KOR-42', 'Посмотри, пожалуйста, оценку'],
    ],
    [
      'idea.status_changed',
      {
        ideaId: 'id-1',
        statement: 'Перейти на единый стек',
        oldStatus: 'captured',
        newStatus: 'shipped',
        reason: 'внедрено в спринте',
      },
      [
        'Идея сменила статус',
        'Перейти на единый стек',
        'captured',
        'shipped',
        'внедрено в спринте',
      ],
    ],
    [
      'support.ticket_created',
      {
        ticketId: 't-1',
        ticketNumber: '124',
        subject: 'Не открывается отчёт',
        actionUrl: 'https://app.kora.test/support/124',
      },
      ['Обращение №124', 'Не открывается отчёт'],
    ],
    [
      'support.ticket_reply',
      {
        ticketId: 't-1',
        ticketNumber: '124',
        subject: 'Не открывается отчёт',
        snippet: 'Мы починили, проверьте ещё раз',
        actionUrl: 'https://app.kora.test/support/124',
      },
      ['Ответ по обращению №124', 'Мы починили, проверьте ещё раз'],
    ],
  ];

  it.each(cases)(
    '%s — человекочитаемый бриф, не «Уведомление: …»',
    (eventType, payload, expectedParts) => {
      const text = render(eventType, payload);
      for (const part of expectedParts) {
        expect(text).toContain(part);
      }
      expect(text.startsWith('Уведомление:')).toBe(false);
    },
  );

  it('note.ack — возвращает payload.text как есть', () => {
    const text = render('note.ack', {
      text: 'Записал: договорённость с подрядчиком.',
    });
    expect(text).toBe('Записал: договорённость с подрядчиком.');
    expect(text.startsWith('Уведомление:')).toBe(false);
  });

  it('note.ack — fallback при пустом text', () => {
    const text = render('note.ack', { text: '' });
    expect(text).toBe('Записал в память Коры 🧠');
  });

  it('неизвестный eventType без title/body — прежний default-fallback', () => {
    const text = render('foo.bar', {});
    expect(text.startsWith('Уведомление:')).toBe(true);
    expect(text).toContain('foo.bar');
  });

  it('MAX — plain text: универсальная ветка title+body без HTML-тегов', () => {
    const text = render('operations.weekly_digest', {
      title: 'Итоги недели',
      body: 'Закрыто 12 задач.',
      actionUrl: 'https://app.kora.test/digest/d-1',
    });
    expect(text).not.toContain('<b>');
    expect(text).not.toContain('</b>');
    expect(text.startsWith('Итоги недели')).toBe(true);
  });
});
