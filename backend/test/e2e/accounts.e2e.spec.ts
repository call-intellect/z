import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { GlobalZodValidationPipe } from '../../src/common/pipes/zod-validation.pipe';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { MailService } from '../../src/modules/mail/mail.service';

/**
 * E2E `accounts` (standalone-product Phase 2):
 *
 *   1. register → создан user + temp-пароль попал в MailService.sendTempPassword.
 *   2. login(temp-pw) → cookie выдана, mustChangePassword=true.
 *   3. me → возвращает профиль.
 *   4. PATCH me → обновляет имя.
 *   5. change-password → новый пароль работает, mustChangePassword=false.
 *   6. logout → cookie очищена + сессия отозвана (последующий /me даёт 401).
 *   7. forgot-password → токен сгенерирован, в MailService.sendPasswordReset
 *      пришла reset-ссылка.
 *   8. reset-password → новый пароль установлен.
 *
 * MailService мокается через override provider (capture аргументов sendMail
 * вместо реальной отправки). NODE_ENV=test уже включает DRY-RUN внутри сервиса,
 * но мы заменяем сам класс — проще.
 */

interface MailCapture {
  tempPasswords: Array<{ to: string; tempPassword: string; loginUrl: string; name: string }>;
  resets: Array<{ to: string; resetUrl: string; expiresInMinutes: number; name: string }>;
}

class MockMailService {
  capture: MailCapture = { tempPasswords: [], resets: [] };

  async sendTempPassword(args: {
    to: string;
    name: string;
    tempPassword: string;
    loginUrl: string;
  }): Promise<{ ok: true }> {
    this.capture.tempPasswords.push(args);
    return { ok: true };
  }

  async sendPasswordReset(args: {
    to: string;
    name: string;
    resetUrl: string;
    expiresInMinutes: number;
  }): Promise<{ ok: true }> {
    this.capture.resets.push(args);
    return { ok: true };
  }

  // onModuleInit / send — не используются благодаря overrideProvider.
  onModuleInit(): void {
    // no-op
  }
}

describe('Accounts E2E (standalone Phase 2)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: MockMailService;
  const TEST_EMAIL = `e2e-acc-${Date.now()}@example.com`;
  const TEST_NAME = 'E2E User';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useClass(MockMailService)
      .compile();

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
    mail = app.get(MailService) as unknown as MockMailService;
  });

  afterEach(async () => {
    // Чистим всё по test-email и связанным записям.
    const users = await prisma.user.findMany({
      where: { email: { startsWith: 'e2e-acc-' } },
    });
    const ids = users.map((u) => u.id);
    if (ids.length) {
      await prisma.userVerificationToken.deleteMany({ where: { userId: { in: ids } } });
      await prisma.userSession.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    mail.capture = { tempPasswords: [], resets: [] };
  });

  afterAll(async () => {
    await app.close();
  });

  // ─────────────────────────── helpers ──────────────────────────

  function extractCookie(res: request.Response): string {
    const setCookie = res.headers['set-cookie'] as unknown as string[] | string | undefined;
    const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    const c = arr.find((x) => x.startsWith('z_session='));
    expect(c).toBeTruthy();
    return (c ?? '').split(';')[0] ?? '';
  }

  // ─────────────────────────── happy path ───────────────────────

  it('register → login (temp-pw) → me → change-password → logout', async () => {
    // 1. register
    const reg = await request(app.getHttpServer())
      .post('/api/v1/accounts/register')
      .send({ email: TEST_EMAIL, name: TEST_NAME });
    expect(reg.status).toBe(200);
    expect(reg.body).toMatchObject({ status: 'ok', email_sent: true });

    expect(mail.capture.tempPasswords.length).toBe(1);
    const tempPw = mail.capture.tempPasswords[0]?.tempPassword as string;
    expect(typeof tempPw).toBe('string');
    expect(tempPw.length).toBeGreaterThan(8);

    // user в БД присутствует, mustChangePassword=true
    const u1 = await prisma.user.findFirst({ where: { email: TEST_EMAIL.toLowerCase() } });
    expect(u1).toBeTruthy();
    expect(u1?.mustChangePassword).toBe(true);
    expect(u1?.signupSource).toBe('standalone');

    // 2. login с temp-pw
    const login = await request(app.getHttpServer())
      .post('/api/v1/accounts/login')
      .send({ email: TEST_EMAIL, password: tempPw });
    expect(login.status).toBe(200);
    expect(login.body.mustChangePassword).toBe(true);
    const cookie = extractCookie(login);

    // 3. me
    const me = await request(app.getHttpServer())
      .get('/api/v1/accounts/me')
      .set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.user?.email).toBe(TEST_EMAIL.toLowerCase());
    expect(me.body.user?.name).toBe(TEST_NAME);
    expect(me.body.user?.mustChangePassword).toBe(true);

    // 4. change-password
    const newPw = 'NewSecure123';
    const change = await request(app.getHttpServer())
      .post('/api/v1/accounts/me/change-password')
      .set('Cookie', cookie)
      .send({ currentPassword: tempPw, newPassword: newPw });
    expect(change.status).toBe(200);

    // mustChangePassword должен сбросить
    const u2 = await prisma.user.findFirst({ where: { email: TEST_EMAIL.toLowerCase() } });
    expect(u2?.mustChangePassword).toBe(false);

    // 5. login со старым паролем — fail
    const oldLogin = await request(app.getHttpServer())
      .post('/api/v1/accounts/login')
      .send({ email: TEST_EMAIL, password: tempPw });
    expect(oldLogin.status).toBe(401);

    // login с новым — ок
    const newLogin = await request(app.getHttpServer())
      .post('/api/v1/accounts/login')
      .send({ email: TEST_EMAIL, password: newPw });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.mustChangePassword).toBe(false);
    const cookie2 = extractCookie(newLogin);

    // 6. logout
    const logout = await request(app.getHttpServer())
      .post('/api/v1/accounts/logout')
      .set('Cookie', cookie2);
    expect(logout.status).toBe(200);

    // /me с этим же jti — 401
    const meAfter = await request(app.getHttpServer())
      .get('/api/v1/accounts/me')
      .set('Cookie', cookie2);
    expect(meAfter.status).toBe(401);
  }, 30_000);

  // ─────────────────────────── PATCH /me ────────────────────────

  it('PATCH /me — обновляет имя', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/accounts/register')
      .send({ email: TEST_EMAIL, name: 'Old Name' });
    const tempPw = mail.capture.tempPasswords[0]?.tempPassword as string;

    const login = await request(app.getHttpServer())
      .post('/api/v1/accounts/login')
      .send({ email: TEST_EMAIL, password: tempPw });
    const cookie = extractCookie(login);

    const patch = await request(app.getHttpServer())
      .patch('/api/v1/accounts/me')
      .set('Cookie', cookie)
      .send({ name: 'New Name' });
    expect(patch.status).toBe(200);
    expect(patch.body.user?.name).toBe('New Name');
  }, 30_000);

  // ─────────────────────────── forgot/reset ─────────────────────

  it('forgot-password → reset-password (новый пароль работает)', async () => {
    // регистрируем юзера
    await request(app.getHttpServer())
      .post('/api/v1/accounts/register')
      .send({ email: TEST_EMAIL, name: TEST_NAME });

    // forgot-password → reset URL должен прилететь в mail.capture
    const forgot = await request(app.getHttpServer())
      .post('/api/v1/accounts/password/forgot')
      .send({ email: TEST_EMAIL });
    expect(forgot.status).toBe(200);
    expect(forgot.body).toEqual({ ok: true });

    expect(mail.capture.resets.length).toBe(1);
    const url = mail.capture.resets[0]?.resetUrl as string;
    const m = /token=([^&]+)/.exec(url);
    expect(m).toBeTruthy();
    const rawToken = m?.[1] as string;

    // reset-password
    const newPw = 'BrandNew321';
    const reset = await request(app.getHttpServer())
      .post('/api/v1/accounts/password/reset')
      .send({ token: rawToken, newPassword: newPw });
    expect(reset.status).toBe(200);

    // login с новым паролем — ок
    const login = await request(app.getHttpServer())
      .post('/api/v1/accounts/login')
      .send({ email: TEST_EMAIL, password: newPw });
    expect(login.status).toBe(200);

    // повторное использование токена — 410
    const reset2 = await request(app.getHttpServer())
      .post('/api/v1/accounts/password/reset')
      .send({ token: rawToken, newPassword: 'SomethingElse9' });
    expect(reset2.status).toBe(410);
  }, 30_000);

  it('forgot-password для несуществующего email → всё равно ok (no enumeration)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/accounts/password/forgot')
      .send({ email: 'nobody-here-9999@example.com' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mail.capture.resets.length).toBe(0);
  });

  // ─────────────────────────── защита ───────────────────────────

  it('login для несуществующего email → 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/accounts/login')
      .send({ email: 'nope@example.com', password: 'anything' });
    expect(res.status).toBe(401);
  });

  it('register с disposable email → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/accounts/register')
      .send({ email: 'spam@mailinator.com', name: 'Spam' });
    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe('email_disposable');
  });

  it('register с заполненным honeypot → 200, но user не создан', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/accounts/register')
      .send({ email: TEST_EMAIL, name: TEST_NAME, honeypot: 'bot' });
    expect(res.status).toBe(200);
    const u = await prisma.user.findFirst({ where: { email: TEST_EMAIL.toLowerCase() } });
    expect(u).toBeNull();
  });
});
