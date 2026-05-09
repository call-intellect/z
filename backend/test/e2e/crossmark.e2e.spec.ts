import { createHmac } from 'node:crypto';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { GlobalZodValidationPipe } from '../../src/common/pipes/zod-validation.pipe';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { HmacService } from '../../src/modules/auth/services/hmac.service';

/**
 * E2E-тест Crossmark интеграции.
 *
 * ❶ Поднимаем тестовое NestApp идентично `main.ts` — с `bodyParser:false`,
 *    собственным `express.json({verify})` для `req.rawBody` (HMAC-проверка),
 *    `cookieParser`, `GlobalZodValidationPipe`.
 * ❷ Создаём `IntegrationKey` программно: генерим plain-key, кладём `keyHash`
 *    в БД через `HmacService.hashKey`. Plain-key используем для подписи запросов.
 * ❸ Перед каждым тестом — truncate всех таблиц, на которые мы пишем.
 *
 * Для запуска нужен Postgres на `DATABASE_URL` (`docker-compose` на 127.0.0.1:55435).
 */
describe('Crossmark E2E (POST/GET/DELETE /integrations/crossmark/v1/meetings)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let hmacService: HmacService;
  let plainKey: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    app.use(
      express.json({
        limit: '1mb',
        verify: (req, _res, buf) => {
          (req as unknown as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
        },
      }),
    );
    app.use(cookieParser());
    app.useGlobalPipes(new GlobalZodValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    hmacService = app.get(HmacService);

    plainKey = hmacService.generateKey();
    await prisma.integrationKey.create({
      data: {
        partnerName: 'crossmark-e2e',
        keyHash: hmacService.hashKey(plainKey),
      },
    });
  });

  afterEach(async () => {
    // Очищаем «бизнес» таблицы. IntegrationKey не трогаем — он живёт всю сессию.
    // Порядок важен: сначала зависимые, потом владельцы.
    await prisma.$transaction([
      prisma.crossmarkIdempotency.deleteMany(),
      prisma.meetingEvent.deleteMany(),
      prisma.participant.deleteMany(),
      prisma.meeting.deleteMany(),
      prisma.user.deleteMany(),
    ]);
  });

  afterAll(async () => {
    await prisma.integrationKey.deleteMany();
    await app.close();
  });

  // ─────────────────────────── helpers ───────────────────────────

  function sign(body: string, ts: number): string {
    return createHmac('sha256', plainKey).update(`${ts}.${body}`).digest('hex');
  }

  function authHeaders(body: string, opts?: { tsOffsetSec?: number; sigOverride?: string }) {
    const ts = Math.floor(Date.now() / 1000) + (opts?.tsOffsetSec ?? 0);
    const sig = opts?.sigOverride ?? sign(body, ts);
    return {
      Authorization: `Bearer ${plainKey}`,
      'X-Crossmark-Signature': sig,
      'X-Crossmark-Timestamp': String(ts),
    };
  }

  function bodyA(): string {
    return JSON.stringify({
      host: { external_id: 'u-1', email: 'u1@x.com', name: 'User One' },
      type: 'sales',
      title: 'Test Meeting',
    });
  }

  // ─────────────────────────── сценарии ───────────────────────────

  it('создать-получить-отменить', async () => {
    const body = bodyA();
    const createRes = await request(app.getHttpServer())
      .post('/integrations/crossmark/v1/meetings')
      .set(authHeaders(body))
      .set('Content-Type', 'application/json')
      .send(body);

    expect(createRes.status).toBe(201);
    expect(createRes.body).toMatchObject({
      meeting_id: expect.any(String),
      deep_link: expect.any(String),
      expires_at: expect.any(String),
    });
    const meetingId = createRes.body.meeting_id;
    expect(createRes.body.deep_link).toContain(`/m/${meetingId}?t=`);

    // GET
    const emptyBody = '';
    const getRes = await request(app.getHttpServer())
      .get(`/integrations/crossmark/v1/meetings/${meetingId}`)
      .set(authHeaders(emptyBody))
      .send();
    expect(getRes.status).toBe(200);
    expect(getRes.body.id).toBe(meetingId);
    expect(getRes.body.status).toBe('scheduled');
    expect(getRes.body.title).toBe('Test Meeting');
    expect(getRes.body.owner.email).toBe('u1@x.com');
    expect(getRes.body.owner.external_id).toBe('u-1');

    // DELETE
    const delRes = await request(app.getHttpServer())
      .delete(`/integrations/crossmark/v1/meetings/${meetingId}`)
      .set(authHeaders(emptyBody))
      .send();
    expect(delRes.status).toBe(200);
    expect(delRes.body).toEqual({ ok: true });

    // В БД статус failed/cancelled_by_partner.
    const persisted = await prisma.meeting.findUnique({ where: { id: meetingId } });
    expect(persisted?.status).toBe('failed');
    expect(persisted?.failureReason).toBe('cancelled_by_partner');
  });

  it('идемпотентность: тот же ключ + то же тело → тот же meeting_id', async () => {
    const body = bodyA();

    const r1 = await request(app.getHttpServer())
      .post('/integrations/crossmark/v1/meetings')
      .set(authHeaders(body))
      .set('Content-Type', 'application/json')
      .set('X-Idempotency-Key', 'idem-abc')
      .send(body);
    expect(r1.status).toBe(201);
    const m1 = r1.body.meeting_id;

    // ВАЖНО: между запросами idempotency-таблица записывается асинхронно
    // через `IdempotencyInterceptor` (fire-and-forget). Делаем «retry-loop»
    // полл-ожидание, чтобы исключить flake.
    let saved: unknown = null;
    for (let i = 0; i < 20 && !saved; i++) {
      saved = await prisma.crossmarkIdempotency.findUnique({ where: { key: 'idem-abc' } });
      if (!saved) await new Promise((r) => setTimeout(r, 50));
    }
    expect(saved).not.toBeNull();

    // Повтор с тем же ключом и телом — не создаст вторую встречу.
    const r2 = await request(app.getHttpServer())
      .post('/integrations/crossmark/v1/meetings')
      .set(authHeaders(body))
      .set('Content-Type', 'application/json')
      .set('X-Idempotency-Key', 'idem-abc')
      .send(body);
    expect(r2.status).toBe(201);
    expect(r2.body.meeting_id).toBe(m1);

    // В БД встреча ровно одна.
    const count = await prisma.meeting.count();
    expect(count).toBe(1);
  });

  it('идемпотентность: тот же ключ + другое тело → 409 idempotency_conflict', async () => {
    const body1 = bodyA();
    const body2 = JSON.stringify({
      host: { external_id: 'u-2', email: 'u2@x.com', name: 'User Two' },
      type: 'sales',
      title: 'Different',
    });

    const r1 = await request(app.getHttpServer())
      .post('/integrations/crossmark/v1/meetings')
      .set(authHeaders(body1))
      .set('Content-Type', 'application/json')
      .set('X-Idempotency-Key', 'idem-conflict')
      .send(body1);
    expect(r1.status).toBe(201);

    // Polling до появления записи в idempotency.
    let saved: unknown = null;
    for (let i = 0; i < 20 && !saved; i++) {
      saved = await prisma.crossmarkIdempotency.findUnique({
        where: { key: 'idem-conflict' },
      });
      if (!saved) await new Promise((r) => setTimeout(r, 50));
    }
    expect(saved).not.toBeNull();

    const r2 = await request(app.getHttpServer())
      .post('/integrations/crossmark/v1/meetings')
      .set(authHeaders(body2))
      .set('Content-Type', 'application/json')
      .set('X-Idempotency-Key', 'idem-conflict')
      .send(body2);
    expect(r2.status).toBe(409);
    expect(r2.body.error.code).toBe('idempotency_conflict');
  });

  it('невалидная подпись → 401', async () => {
    const body = bodyA();
    const res = await request(app.getHttpServer())
      .post('/integrations/crossmark/v1/meetings')
      .set(authHeaders(body, { sigOverride: 'a'.repeat(64) }))
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('integration_key_invalid');
  });

  it('просроченный timestamp (-1h) → 401', async () => {
    const body = bodyA();
    const res = await request(app.getHttpServer())
      .post('/integrations/crossmark/v1/meetings')
      .set(authHeaders(body, { tsOffsetSec: -3600 }))
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('integration_key_invalid');
  });
});
