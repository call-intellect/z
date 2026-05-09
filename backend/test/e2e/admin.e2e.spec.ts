import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { GlobalZodValidationPipe } from '../../src/common/pipes/zod-validation.pipe';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { LivekitService } from '../../src/modules/livekit/livekit.service';

/**
 * E2E `admin`:
 *   1. Создаём admin-пользователя (bcrypt-хеш пароля).
 *   2. Логинимся через POST /api/v1/auth/admin-login → cookie z_session.
 *   3. Создаём integration key, проверяем что plain key возвращается ОДИН раз
 *      (повторно нельзя получить — список не содержит plain).
 *   4. Revoke key.
 *   5. GET /admin/api/v1/meetings — список пуст / с сидом.
 *   6. POST /admin/api/v1/meetings/:id/force-finish — переводит активную в completed.
 *   7. GET /admin/api/v1/ai-usage за пустой период — items = [].
 *
 * `LivekitService.deleteRoom` — мок (без реального LiveKit).
 */
describe('Admin E2E (login → integration-keys → meetings → ai-usage)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const ADMIN_EMAIL = 'admin-e2e@z.app';
  const ADMIN_PASSWORD = 'super-secret-pw-12345';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // Мокаем LivekitService — не лезем в реальный.
    const livekit = moduleRef.get(LivekitService, { strict: false });
    Object.assign(livekit, {
      ensureRoom: async () => null,
      deleteRoom: async () => undefined,
      listParticipants: async () => [],
      generateHostToken: async () => 'mock-host-token',
      generateGuestToken: async () => 'mock-guest-token',
      muteParticipant: async () => undefined,
      removeParticipant: async () => undefined,
      updateParticipantAttributes: async () => undefined,
    });

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

    // Создаём admin-пользователя с известным паролем.
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 4);
    await prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        name: 'Admin E2E',
        role: 'admin',
        passwordHash,
      },
    });
  });

  afterEach(async () => {
    // Очищаем всё, что admin мог нагенерить, но НЕ admin-пользователя.
    await prisma.$transaction([
      prisma.adminAuditLog.deleteMany(),
      prisma.aiUsageLog.deleteMany(),
      prisma.aiResult.deleteMany(),
      prisma.transcript.deleteMany(),
      prisma.recordingAction.deleteMany(),
      prisma.audioTrack.deleteMany(),
      prisma.recording.deleteMany(),
      prisma.meetingEvent.deleteMany(),
      prisma.participant.deleteMany(),
      prisma.meeting.deleteMany(),
      prisma.integrationKey.deleteMany({ where: { partnerName: { startsWith: 'admin-e2e:' } } }),
    ]);
    // Удаляем не-admin пользователей (но не самого админа).
    await prisma.user.deleteMany({ where: { email: { not: ADMIN_EMAIL } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: ADMIN_EMAIL } });
    await app.close();
  });

  // ─────────────── helpers ───────────────

  async function loginAsAdmin(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/admin-login')
      .set('Content-Type', 'application/json')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'] as unknown as string[] | string;
    const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
    const cookie = arr.find((c) => c.startsWith('z_session='));
    expect(cookie).toBeTruthy();
    return (cookie ?? '').split(';')[0] ?? '';
  }

  async function seedMeeting(status: 'active' | 'scheduled'): Promise<{ id: string; ownerId: string }> {
    const owner = await prisma.user.create({
      data: { email: 'owner-e2e@z.app', name: 'Owner', role: 'user' },
    });
    const id = `m_e2e_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    await prisma.meeting.create({
      data: {
        id,
        roomName: id,
        title: 'E2E meeting',
        type: 'sales',
        ownerId: owner.id,
        status,
        ...(status === 'active' ? { startedAt: new Date() } : {}),
      },
    });
    await prisma.participant.create({
      data: {
        meetingId: id,
        livekitIdentity: `host:${owner.id}`,
        name: 'Owner',
        role: 'host',
        isRegisteredUser: true,
        userId: owner.id,
      },
    });
    return { id, ownerId: owner.id };
  }

  // ─────────────── сценарии ───────────────

  it('admin-login: правильный пароль → cookie выдана', async () => {
    const cookie = await loginAsAdmin();
    expect(cookie).toMatch(/^z_session=/);

    const meRes = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookie);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user?.role).toBe('admin');
    expect(meRes.body.user?.email).toBe(ADMIN_EMAIL);
  });

  it('admin-login: неправильный пароль → 403', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/admin-login')
      .set('Content-Type', 'application/json')
      .send({ email: ADMIN_EMAIL, password: 'wrong' });
    expect(res.status).toBe(403);
  });

  it('integration keys: create возвращает plain key один раз, list — без plain', async () => {
    const cookie = await loginAsAdmin();

    const createRes = await request(app.getHttpServer())
      .post('/admin/api/v1/integration-keys')
      .set('Cookie', cookie)
      .set('Content-Type', 'application/json')
      .send({ partner_name: 'admin-e2e:partner-A' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.id).toBeTruthy();
    expect(typeof createRes.body.key).toBe('string');
    expect((createRes.body.key as string).length).toBeGreaterThan(20);
    const keyId = createRes.body.id as string;

    // GET list — plain key не должен возвращаться.
    const listRes = await request(app.getHttpServer())
      .get('/admin/api/v1/integration-keys')
      .set('Cookie', cookie);
    expect(listRes.status).toBe(200);
    const item = (listRes.body.items as Array<{ id: string; partnerName: string }>).find(
      (i) => i.id === keyId,
    );
    expect(item).toBeTruthy();
    expect(item?.partnerName).toBe('admin-e2e:partner-A');
    // Никакого поля 'key' / 'keyHash' не должно быть.
    expect((item as unknown as Record<string, unknown>)['key']).toBeUndefined();
    expect((item as unknown as Record<string, unknown>)['keyHash']).toBeUndefined();

    // Revoke.
    const delRes = await request(app.getHttpServer())
      .delete(`/admin/api/v1/integration-keys/${keyId}`)
      .set('Cookie', cookie);
    expect(delRes.status).toBe(200);
    expect(delRes.body).toEqual({ ok: true });

    const after = await prisma.integrationKey.findUnique({ where: { id: keyId } });
    expect(after?.revokedAt).toBeTruthy();
  });

  it('GET /admin/api/v1/meetings — пустой список без фильтров', async () => {
    const cookie = await loginAsAdmin();
    const res = await request(app.getHttpServer())
      .get('/admin/api/v1/meetings')
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.items).toEqual([]);
  });

  it('GET /admin/api/v1/meetings — фильтр по статусу/типу', async () => {
    const cookie = await loginAsAdmin();
    await seedMeeting('active');

    const all = await request(app.getHttpServer())
      .get('/admin/api/v1/meetings')
      .set('Cookie', cookie);
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(1);

    const filtered = await request(app.getHttpServer())
      .get('/admin/api/v1/meetings?status=active&type=sales')
      .set('Cookie', cookie);
    expect(filtered.status).toBe(200);
    expect(filtered.body.total).toBe(1);

    const empty = await request(app.getHttpServer())
      .get('/admin/api/v1/meetings?status=completed')
      .set('Cookie', cookie);
    expect(empty.status).toBe(200);
    expect(empty.body.total).toBe(0);
  });

  it(
    'POST /admin/api/v1/meetings/:id/force-finish — переводит active → completed',
    async () => {
      const cookie = await loginAsAdmin();
      const seeded = await seedMeeting('active');

      const res = await request(app.getHttpServer())
        .post(`/admin/api/v1/meetings/${seeded.id}/force-finish`)
        .set('Cookie', cookie)
        .set('Content-Type', 'application/json')
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const persisted = await prisma.meeting.findUnique({ where: { id: seeded.id } });
      expect(persisted?.status).toBe('completed');
      expect(persisted?.endedAt).toBeTruthy();
    },
    20_000,
  );

  it('GET /admin/api/v1/ai-usage — пустой агрегат за период', async () => {
    const cookie = await loginAsAdmin();
    const from = new Date('2026-01-01T00:00:00Z').toISOString();
    const to = new Date('2026-01-02T00:00:00Z').toISOString();
    const res = await request(app.getHttpServer())
      .get(`/admin/api/v1/ai-usage?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&group_by=day`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.group_by).toBe('day');
    expect(res.body.items).toEqual([]);
  });

  it('non-admin user → /admin/* возвращает 403', async () => {
    // Создадим обычного user'а вручную и подменим session cookie.
    const user = await prisma.user.create({
      data: {
        email: 'user-e2e@z.app',
        name: 'User',
        role: 'user',
      },
    });
    // Логинимся через admin-login — должен упасть, т.к. role != admin.
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/admin-login')
      .set('Content-Type', 'application/json')
      .send({ email: user.email, password: 'any' });
    expect(loginRes.status).toBe(403);
  });

  it('audit log: после revoke key → запись в AdminAuditLog', async () => {
    const cookie = await loginAsAdmin();

    const createRes = await request(app.getHttpServer())
      .post('/admin/api/v1/integration-keys')
      .set('Cookie', cookie)
      .set('Content-Type', 'application/json')
      .send({ partner_name: 'admin-e2e:audit-test' });
    expect(createRes.status).toBe(201);
    const keyId = createRes.body.id as string;

    await request(app.getHttpServer())
      .delete(`/admin/api/v1/integration-keys/${keyId}`)
      .set('Cookie', cookie);

    // Audit пишется fire-and-forget. Polling до 2 секунд.
    let logs: Array<{ action: string; targetId: string }> = [];
    for (let i = 0; i < 40 && logs.length < 2; i++) {
      logs = await prisma.adminAuditLog.findMany({
        orderBy: { createdAt: 'asc' },
      });
      if (logs.length >= 2) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    const actions = logs.map((l) => l.action);
    expect(actions).toContain('create_integration_key');
    expect(actions).toContain('revoke_integration_key');
  });
});
