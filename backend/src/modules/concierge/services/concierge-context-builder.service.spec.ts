/**
 * ТЗ 2026-06-18 (assistant-calendar-master) Фаза 2 — unit-тесты
 * ConciergeContextBuilderService: строка «Сейчас…» (дата/время/TZ) должна
 * идти ПЕРВОЙ строкой контекста (USER-блок) и переживать сбой identity.
 *
 * `new Date()` внутри build() недетерминирован — ассертим только наличие
 * подстрок (`Сейчас:` и нужная TZ), не конкретную дату/время.
 */
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { ConciergeContextBuilderService } from './concierge-context-builder.service';

interface MockOpts {
  /** TZ пользователя; null → у пользователя нет TZ (ожидаем дефолт Moscow). */
  userTimezone?: string | null;
  /** true → prisma.user.findUnique бросает (имитация сбоя identity). */
  userFindThrows?: boolean;
}

function buildService(opts: MockOpts): ConciergeContextBuilderService {
  const userFindUnique = opts.userFindThrows
    ? vi.fn(async () => {
        throw new Error('identity lookup boom');
      })
    : vi.fn(async () => ({
        name: 'Иван',
        email: 'i@e.ru',
        timezone: opts.userTimezone ?? null,
      }));

  const prisma = {
    user: { findUnique: userFindUnique },
    org: {
      findUnique: vi.fn(async () => ({ name: 'Орг', slug: 'org' })),
    },
  } as unknown as PrismaService;

  return new ConciergeContextBuilderService(prisma);
}

const ARGS = { tenantId: 'org-1', userId: 'user-1' };

describe('ConciergeContextBuilderService.build — строка «Сейчас…»', () => {
  it('первая строка начинается с «Сейчас:» и содержит TZ пользователя', async () => {
    const svc = buildService({ userTimezone: 'Asia/Novosibirsk' });
    const result = await svc.build(ARGS);
    const firstLine = result.split('\n')[0] ?? '';
    expect(firstLine.startsWith('Сейчас:')).toBe(true);
    expect(result).toContain('(Asia/Novosibirsk)');
  });

  it('у пользователя нет TZ → дефолт Europe/Moscow', async () => {
    const svc = buildService({ userTimezone: null });
    const result = await svc.build(ARGS);
    expect(result).toContain('(Europe/Moscow)');
  });

  it('сбой identity → строка «Сейчас:» всё равно присутствует (дефолтная TZ)', async () => {
    const svc = buildService({ userFindThrows: true });
    const result = await svc.build(ARGS);
    expect(result).toContain('Сейчас:');
    expect(result).toContain('(Europe/Moscow)');
  });
});
