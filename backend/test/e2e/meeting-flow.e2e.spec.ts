import { createHash, createHmac } from 'node:crypto';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { TypedConfigService } from '../../src/common/config/index';
import { GlobalZodValidationPipe } from '../../src/common/pipes/zod-validation.pipe';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { HmacService } from '../../src/modules/auth/services/hmac.service';
import { LivekitService } from '../../src/modules/livekit/livekit.service';

/**
 * E2E `meeting-flow`:
 *
 *   1. Создаём встречу через Crossmark API (HMAC).
 *   2. Хост обменивает deep-link на cookie.
 *   3. Хост дёргает `/join` — получает реальный LiveKit-токен (не null).
 *   4. Симулируем webhook `room_started` → meeting.status = active.
 *   5. Симулируем webhook `room_finished` → meeting.status = completed.
 *
 * `LivekitService` мокаем (override provider) — реальный LiveKit нам тут не нужен.
 * Webhook'и подписываем JWT'ом по `LIVEKIT_WEBHOOK_API_SECRET`.
 */
describe('Meeting Flow E2E (Crossmark → join → webhook → completed)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let hmacService: HmacService;
  let cfg: TypedConfigService;
  let plainKey: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    // Подменяем LivekitService на «бесшумный» mock — не лезем в реальный LiveKit.
    // overrideProvider в этом сетапе ломает DI в @UseGuards (Reflector становится
    // undefined), поэтому подменяем уже после compile через ручную замену методов.
    const livekit = moduleRef.get(LivekitService, { strict: false });
    Object.assign(livekit, buildLivekitMock());

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
    cfg = app.get(TypedConfigService);

    plainKey = hmacService.generateKey();
    await prisma.integrationKey.create({
      data: {
        partnerName: 'meeting-flow-e2e',
        keyHash: hmacService.hashKey(plainKey),
      },
    });
  });

  afterEach(async () => {
    await prisma.$transaction([
      prisma.crossmarkIdempotency.deleteMany(),
      prisma.webhookSeenEvent.deleteMany(),
      prisma.meetingEvent.deleteMany(),
      prisma.participant.deleteMany(),
      prisma.meeting.deleteMany(),
      prisma.user.deleteMany(),
    ]);
  });

  afterAll(async () => {
    // Удаляем ТОЛЬКО свой integration key — иначе при параллельном запуске
    // других e2e-тестов (общая БД) у них пропадёт ключ.
    await prisma.integrationKey.deleteMany({
      where: { partnerName: 'meeting-flow-e2e' },
    });
    await prisma.webhookSeenEvent.deleteMany();
    await app.close();
  });

  // ────────────────────────── helpers ────────────────────────────

  function signCrossmark(body: string, ts: number): string {
    return createHmac('sha256', plainKey).update(`${ts}.${body}`).digest('hex');
  }

  function crossmarkAuth(body: string): Record<string, string> {
    const ts = Math.floor(Date.now() / 1000);
    return {
      Authorization: `Bearer ${plainKey}`,
      'X-Crossmark-Signature': signCrossmark(body, ts),
      'X-Crossmark-Timestamp': String(ts),
    };
  }

  function signLivekitWebhook(body: string): string {
    const sha256 = createHash('sha256').update(body).digest('base64');
    // Используем тот же секрет, что и в `LivekitSignatureVerifier`.
    return jwt.sign({ sha256 }, cfg.livekit.webhookApiSecret, {
      algorithm: 'HS256',
      expiresIn: 60,
    });
  }

  // ────────────────────────── сценарий ────────────────────────────

  it('полный happy-path: create → join → room_started → room_finished', async () => {
    // 1. Создаём встречу через Crossmark.
    const createBody = JSON.stringify({
      host: { external_id: 'u-flow', email: 'flow@x.com', name: 'Flow Host' },
      type: 'sales',
      title: 'Meeting Flow E2E',
    });
    const createRes = await request(app.getHttpServer())
      .post('/integrations/crossmark/v1/meetings')
      .set(crossmarkAuth(createBody))
      .set('Content-Type', 'application/json')
      .send(createBody);
    expect(createRes.status).toBe(201);
    const meetingId = createRes.body.meeting_id;
    const deepLinkUrl = createRes.body.deep_link as string;

    // Парсим JWT из deep-link.
    const tokenMatch = /\?t=([^&]+)/.exec(deepLinkUrl);
    expect(tokenMatch).not.toBeNull();
    const deepLinkToken = decodeURIComponent(tokenMatch?.[1] ?? '');
    expect(deepLinkToken.length).toBeGreaterThan(0);

    // 2. Обмениваем deep-link на session cookie.
    const exchangeRes = await request(app.getHttpServer())
      .get('/api/v1/auth/exchange')
      .query({ token: deepLinkToken, meeting_id: meetingId });
    expect(exchangeRes.status).toBe(200);
    const setCookie = exchangeRes.headers['set-cookie'] as unknown as string[] | string;
    expect(setCookie).toBeTruthy();
    const fullCookie = (Array.isArray(setCookie) ? setCookie : [setCookie])
      .find((c: string) => c.startsWith('z_session='));
    expect(fullCookie).toBeTruthy();
    // Берём только пару `name=value` без атрибутов (Domain, Path и т.д.) —
    // supertest шлёт их в Cookie-заголовке как есть, и атрибуты ему не нужны.
    const sessionCookie = (fullCookie ?? '').split(';')[0] ?? '';

    // 3. Хост дёргает /join с cookie — должен получить реальный LiveKit-токен.
    const joinRes = await request(app.getHttpServer())
      .post(`/api/v1/meetings/${meetingId}/join`)
      .set('Cookie', sessionCookie)
      .set('Content-Type', 'application/json')
      .send({});
    expect(joinRes.status).toBe(201);
    expect(joinRes.body.role).toBe('host');
    expect(joinRes.body.livekit.token).toBeTruthy();
    // Токен — не placeholder, не null/empty. В нашем mock'е это `mock-host-token`.
    expect(typeof joinRes.body.livekit.token).toBe('string');
    expect(joinRes.body.livekit.token).not.toBeNull();
    expect(joinRes.body.livekit.identity).toBe(joinRes.body.livekit_identity);

    // 4. Симулируем webhook room_started.
    // ВАЖНО: supertest при Buffer-теле и Content-Type:application/json
    // вызывает Buffer.toJSON() и шлёт `{"type":"Buffer","data":[..]}`, ломая
    // sha. Если шлём string — supertest применяет JSON.parse+stringify, тоже
    // меняя байты. Решение: канонизируем body через JSON.parse+stringify ДО
    // подписи, и шлём как string — тогда supertest пере-сериализует в те же
    // байты.
    const canonicalize = (obj: unknown): string =>
      JSON.stringify(JSON.parse(JSON.stringify(obj)));
    const startedPayloadStr = canonicalize({
      event: 'room_started',
      id: 'EV_started_1',
      room: { name: meetingId },
    });
    const startedAuth = signLivekitWebhook(startedPayloadStr);
    const startedRes = await request(app.getHttpServer())
      .post('/webhooks/livekit')
      .set('Content-Type', 'application/json')
      .set('Authorization', startedAuth)
      .send(startedPayloadStr);
    expect(startedRes.status).toBe(200);

    let updated = await prisma.meeting.findUnique({ where: { id: meetingId } });
    expect(updated?.status).toBe('active');
    expect(updated?.startedAt).toBeTruthy();

    // 5. Симулируем webhook room_finished.
    const finishedPayloadStr = canonicalize({
      event: 'room_finished',
      id: 'EV_finished_1',
      room: { name: meetingId },
    });
    const finishedAuth = signLivekitWebhook(finishedPayloadStr);
    const finishedRes = await request(app.getHttpServer())
      .post('/webhooks/livekit')
      .set('Content-Type', 'application/json')
      .set('Authorization', finishedAuth)
      .send(finishedPayloadStr);
    expect(finishedRes.status).toBe(200);

    updated = await prisma.meeting.findUnique({ where: { id: meetingId } });
    expect(updated?.status).toBe('completed');
    expect(updated?.endedAt).toBeTruthy();
  });
});

/**
 * LiveKit-mock: ничего не делает, только возвращает фейковые токены.
 * Этого достаточно: нас интересует, что `participants.service` дёргает
 * правильный метод и в ответе — реальная строка-токен.
 */
function buildLivekitMock(): {
  ensureRoom: (...args: unknown[]) => Promise<null>;
  deleteRoom: (...args: unknown[]) => Promise<void>;
  listParticipants: (...args: unknown[]) => Promise<unknown[]>;
  generateHostToken: (...args: unknown[]) => Promise<string>;
  generateGuestToken: (...args: unknown[]) => Promise<string>;
  muteParticipant: (...args: unknown[]) => Promise<void>;
  removeParticipant: (...args: unknown[]) => Promise<void>;
  updateParticipantAttributes: (...args: unknown[]) => Promise<void>;
} {
  return {
    ensureRoom: async () => null,
    deleteRoom: async () => undefined,
    listParticipants: async () => [],
    generateHostToken: async () => 'mock-host-token',
    generateGuestToken: async () => 'mock-guest-token',
    muteParticipant: async () => undefined,
    removeParticipant: async () => undefined,
    updateParticipantAttributes: async () => undefined,
  };
}
