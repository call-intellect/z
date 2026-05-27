import nodemailer from 'nodemailer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';

import { MailService } from './mail.service';

vi.mock('nodemailer', () => {
  return {
    default: {
      createTransport: vi.fn(),
    },
  };
});

/**
 * Юнит-тесты MailService.
 *
 * Стратегия:
 *   - nodemailer.createTransport — мок (vi.mock), возвращаем фейковый
 *     transporter с sendMail = vi.fn().
 *   - В DRY-RUN режиме — sendMail НЕ должен вызываться, шаблон рендерится
 *     корректно.
 *   - В обычном режиме — sendMail вызывается с правильными from/to/subject/text.
 */

interface MockTransporter {
  sendMail: ReturnType<typeof vi.fn>;
}

function makeCfg(opts: {
  dryRun?: boolean;
  isTest?: boolean;
  username?: string;
  password?: string;
}): TypedConfigService {
  return {
    runtime: {
      nodeEnv: opts.isTest ? 'test' : 'development',
      isTest: opts.isTest ?? false,
      isProduction: false,
      isDevelopment: !opts.isTest,
    },
    mail: {
      host: 'mail.example.com',
      port: 465,
      ssl: true,
      username: opts.username,
      password: opts.password,
      from: 'noreply@z.app',
      fromName: 'Кора',
      dryRun: opts.dryRun ?? false,
    },
  } as unknown as TypedConfigService;
}

describe('MailService', () => {
  let mockTransporter: MockTransporter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTransporter = {
      sendMail: vi.fn(async () => ({ messageId: 'msg-123' })),
    };
    (nodemailer.createTransport as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      mockTransporter,
    );
  });

  describe('DRY-RUN режим', () => {
    it('в DRY-RUN не создаёт transport и не вызывает sendMail', async () => {
      const svc = new MailService(makeCfg({ dryRun: true }));
      svc.onModuleInit();

      const result = await svc.sendTempPassword({
        to: 'a@b.c',
        name: 'Alice',
        tempPassword: 'temp-pw',
        loginUrl: 'https://z.app/login',
      });

      expect(result.ok).toBe(true);
      expect(nodemailer.createTransport).not.toHaveBeenCalled();
      expect(mockTransporter.sendMail).not.toHaveBeenCalled();
    });

    it('в NODE_ENV=test тоже DRY-RUN', async () => {
      const svc = new MailService(makeCfg({ isTest: true }));
      svc.onModuleInit();

      await svc.sendPasswordReset({
        to: 'a@b.c',
        name: 'Bob',
        resetUrl: 'https://z.app/reset?token=xyz',
        expiresInMinutes: 60,
      });

      expect(nodemailer.createTransport).not.toHaveBeenCalled();
      expect(mockTransporter.sendMail).not.toHaveBeenCalled();
    });
  });

  describe('реальная отправка', () => {
    it('создаёт transport с auth когда заданы username/password', () => {
      const svc = new MailService(makeCfg({ username: 'u', password: 'p' }));
      svc.onModuleInit();

      expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: 'mail.example.com',
        port: 465,
        secure: true,
        auth: { user: 'u', pass: 'p' },
      });
    });

    it('создаёт transport без auth когда username/password пустые', () => {
      const svc = new MailService(makeCfg({}));
      svc.onModuleInit();

      expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: 'mail.example.com',
        port: 465,
        secure: true,
        auth: undefined,
      });
    });

    it('sendTempPassword: рендерит шаблон с переменными и шлёт через transport', async () => {
      const svc = new MailService(makeCfg({ username: 'u', password: 'p' }));
      svc.onModuleInit();

      const result = await svc.sendTempPassword({
        to: 'alice@example.com',
        name: 'Alice',
        tempPassword: 'TempPw_123',
        loginUrl: 'https://z.app/login',
      });

      expect(result.ok).toBe(true);
      expect(mockTransporter.sendMail).toHaveBeenCalledTimes(1);
      const arg = mockTransporter.sendMail.mock.calls[0]?.[0] as {
        from: string;
        to: string;
        subject: string;
        text: string;
      };
      expect(arg.from).toBe('"Кора" <noreply@z.app>');
      expect(arg.to).toBe('alice@example.com');
      expect(arg.subject).toBe('Доступ в Кору');
      expect(arg.text).toContain('Alice');
      expect(arg.text).toContain('alice@example.com');
      expect(arg.text).toContain('TempPw_123');
      expect(arg.text).toContain('https://z.app/login');
    });

    it('sendPasswordReset: рендерит шаблон со ссылкой и TTL', async () => {
      const svc = new MailService(makeCfg({ username: 'u', password: 'p' }));
      svc.onModuleInit();

      await svc.sendPasswordReset({
        to: 'bob@example.com',
        name: 'Bob',
        resetUrl: 'https://z.app/reset?token=abc',
        expiresInMinutes: 60,
      });

      const arg = mockTransporter.sendMail.mock.calls[0]?.[0] as {
        subject: string;
        text: string;
      };
      expect(arg.subject).toBe('Сброс пароля Кора');
      expect(arg.text).toContain('Bob');
      expect(arg.text).toContain('https://z.app/reset?token=abc');
      expect(arg.text).toContain('60');
    });

    it('возвращает ok=false с error при ошибке SMTP', async () => {
      const svc = new MailService(makeCfg({ username: 'u', password: 'p' }));
      svc.onModuleInit();

      mockTransporter.sendMail.mockRejectedValueOnce(new Error('connection refused'));

      const result = await svc.sendTempPassword({
        to: 'alice@example.com',
        name: 'Alice',
        tempPassword: 'temp',
        loginUrl: 'https://z.app/login',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('connection refused');
    });
  });
});
