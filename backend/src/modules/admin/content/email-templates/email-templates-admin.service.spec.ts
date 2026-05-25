/**
 * Admin-redesign Фаза 5 — unit-тесты `EmailTemplatesAdminService`.
 *
 * Покрываем:
 *   1) list(): на пустой БД bootstrap-sync из static-констант.
 *   2) getDetail(): возвращает шаблон + preview с placeholder-подстановкой.
 *   3) update(): валидный Handlebars сохраняется, невалидный → 400.
 *   4) testSend(): успешный send, rate-limit 5/мин блокирует 6-й запрос.
 *   5) renderOrNull(): из БД, иначе static fallback, иначе null.
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../../common/prisma/prisma.service';
import type { MailService } from '../../../mail/mail.service';

import { EmailTemplatesAdminService } from './email-templates-admin.service';

interface TplRow {
  key: string;
  subject: string;
  body: string;
  htmlBody: string | null;
  variables: Record<string, string>;
  category: string;
  updatedBy: string | null;
  updatedAt: Date;
}

function buildPrisma(state: { rows: TplRow[] }): PrismaService {
  const count = vi.fn(async () => state.rows.length);
  const findUnique = vi.fn(async ({ where }: { where: { key: string } }) => {
    return state.rows.find((r) => r.key === where.key) ?? null;
  });
  const findMany = vi.fn(async () => {
    return [...state.rows].sort(
      (a, b) =>
        a.category.localeCompare(b.category) || a.key.localeCompare(b.key),
    );
  });
  const create = vi.fn(async ({ data }: { data: Partial<TplRow> & { key: string } }) => {
    const row: TplRow = {
      key: data.key,
      subject: data.subject ?? '',
      body: data.body ?? '',
      htmlBody: data.htmlBody ?? null,
      variables: (data.variables as Record<string, string> | undefined) ?? {},
      category: data.category ?? 'transactional',
      updatedBy: data.updatedBy ?? null,
      updatedAt: new Date(),
    };
    state.rows.push(row);
    return row;
  });
  const update = vi.fn(
    async ({
      where,
      data,
    }: {
      where: { key: string };
      data: Partial<TplRow>;
    }) => {
      const r = state.rows.find((x) => x.key === where.key);
      if (!r) throw new Error('not found');
      Object.assign(r, data, { updatedAt: new Date() });
      return r;
    },
  );
  const upsert = vi.fn(
    async ({
      where,
      create: createData,
    }: {
      where: { key: string };
      create: Partial<TplRow> & { key: string };
      update: Partial<TplRow>;
    }) => {
      let r = state.rows.find((x) => x.key === where.key);
      if (!r) {
        r = {
          key: createData.key,
          subject: createData.subject ?? '',
          body: createData.body ?? '',
          htmlBody: createData.htmlBody ?? null,
          variables:
            (createData.variables as Record<string, string> | undefined) ?? {},
          category: createData.category ?? 'transactional',
          updatedBy: createData.updatedBy ?? null,
          updatedAt: new Date(),
        };
        state.rows.push(r);
      }
      return r;
    },
  );

  return {
    emailTemplate: { count, findUnique, findMany, create, update, upsert },
  } as unknown as PrismaService;
}

function buildMail(): { mail: MailService; sendPlain: ReturnType<typeof vi.fn> } {
  const sendPlain = vi.fn(async () => ({ ok: true as const }));
  return {
    mail: { sendPlain } as unknown as MailService,
    sendPlain,
  };
}

function makeRow(over: Partial<TplRow>): TplRow {
  return {
    key: over.key ?? 'demo',
    subject: over.subject ?? 'Subject {{name}}',
    body: over.body ?? 'Hello {{name}}',
    htmlBody: over.htmlBody ?? null,
    variables: over.variables ?? { name: 'имя получателя' },
    category: over.category ?? 'transactional',
    updatedBy: over.updatedBy ?? null,
    updatedAt: over.updatedAt ?? new Date(),
  };
}

describe('EmailTemplatesAdminService', () => {
  it('list(): на пустой БД bootstrap-sync из static-констант', async () => {
    const state = { rows: [] as TplRow[] };
    const { mail } = buildMail();
    const svc = new EmailTemplatesAdminService(buildPrisma(state), mail);
    const res = await svc.list();
    // Минимум 5 статических шаблонов: register/reset/invite-github/reminder/timeout.
    expect(res.items.length).toBeGreaterThanOrEqual(5);
    const keys = res.items.map((i) => i.key);
    expect(keys).toContain('register-temp-password');
    expect(keys).toContain('password-reset');
    expect(keys).toContain('invite-github-style');
  });

  it('getDetail(): возвращает шаблон + preview с placeholder-подстановкой', async () => {
    const state = {
      rows: [
        makeRow({
          key: 'demo',
          subject: 'Привет, {{name}}!',
          body: 'Код: {{code}}',
          variables: { name: 'имя', code: 'одноразовый код' },
        }),
      ],
    };
    const { mail } = buildMail();
    const svc = new EmailTemplatesAdminService(buildPrisma(state), mail);
    const detail = await svc.getDetail('demo');
    expect(detail.preview.subject).toContain('{name}');
    expect(detail.preview.body).toContain('{code}');
  });

  it('update(): валидный Handlebars сохраняется, невалидный → 400', async () => {
    const state = { rows: [makeRow({ key: 'demo' })] };
    const { mail } = buildMail();
    const svc = new EmailTemplatesAdminService(buildPrisma(state), mail);

    const upd = await svc.update(
      'demo',
      { body: 'Hello {{name}}, code is {{code}}' },
      'user-1',
    );
    expect(upd.body).toContain('{{code}}');

    await expect(
      svc.update('demo', { body: 'Hello {{name' }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Update несуществующего — 404.
    await expect(
      svc.update('missing', { body: 'x' }, 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('testSend(): успешный send + rate-limit блокирует 6-й запрос', async () => {
    const state = { rows: [makeRow({ key: 'demo' })] };
    const { mail, sendPlain } = buildMail();
    const svc = new EmailTemplatesAdminService(buildPrisma(state), mail);

    for (let i = 0; i < 5; i++) {
      const res = await svc.testSend('demo', 'to@example.com', 'user-1');
      expect(res.ok).toBe(true);
    }
    expect(sendPlain).toHaveBeenCalledTimes(5);

    await expect(
      svc.testSend('demo', 'to@example.com', 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Тот же шаблон с другим user-id — отдельная корзина.
    const other = await svc.testSend('demo', 'to@example.com', 'user-2');
    expect(other.ok).toBe(true);
  });

  it('renderOrNull(): из БД, иначе static fallback, иначе null', async () => {
    const state = {
      rows: [
        makeRow({
          key: 'demo',
          subject: 'Hi {{name}}',
          body: 'Body {{name}}',
          variables: { name: 'имя' },
        }),
      ],
    };
    const { mail } = buildMail();
    const svc = new EmailTemplatesAdminService(buildPrisma(state), mail);

    const fromDb = await svc.renderOrNull('demo', { name: 'Сергей' });
    expect(fromDb?.subject).toBe('Hi Сергей');
    expect(fromDb?.body).toBe('Body Сергей');

    const staticFallback = await svc.renderOrNull('password-reset', {
      name: 'Сергей',
      resetUrl: 'https://example.com/reset',
      expiresInMinutes: 30,
    });
    expect(staticFallback?.body).toContain('Сергей');
    expect(staticFallback?.body).toContain('https://example.com/reset');

    const nothing = await svc.renderOrNull('unknown-key', {});
    expect(nothing).toBeNull();
  });
});
