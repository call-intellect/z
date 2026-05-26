/**
 * Spec для PublicShareController (Phase F.6).
 *
 * Покрытие:
 *   - happy: getPublicMeetingShare/getPublicHighlightShare делегируются с
 *     корректными visitor-параметрами (ip / userAgent / referrer).
 *   - revoke / expire: пробрасывают исключения SharesService.
 *   - extractIp: X-Forwarded-For (string / array), fallback на req.ip.
 *   - Sanity: на контроллере и методах стоит @Throttle (anti-brute-force).
 *   - Referrer header пробрасывается в SharesService (для аудита) — но через
 *     PublicShareHeadersInterceptor ответ всегда `Referrer-Policy: no-referrer`,
 *     поэтому исходящие ответы не утекают referrer.
 */
import type * as fsModule from 'node:fs';
import type * as pathModule from 'node:path';

import { GoneException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { PublicShareController } from './public-share.controller';
import type { SharesService } from './shares.service';

function build(opts: { meetingFails?: 'revoked' | 'expired' | 'not_found' } = {}) {
  const svc = {
    getPublicMeetingShare: vi.fn(async () => {
      if (opts.meetingFails === 'revoked') {
        throw new GoneException({
          ok: false,
          error: { code: 'share_revoked' },
        });
      }
      if (opts.meetingFails === 'expired') {
        throw new GoneException({
          ok: false,
          error: { code: 'share_expired' },
        });
      }
      if (opts.meetingFails === 'not_found') {
        throw new NotFoundException('share_not_found');
      }
      return {
        meeting: { id: 'm-1', title: 't', type: 'sales', startedAt: null, endedAt: null, durationMs: null },
        permissions: {
          allowVideo: false,
          allowTranscript: false,
          allowTasks: false,
          allowChapters: false,
          allowChat: false,
        },
        expiresAt: '2099-01-01T00:00:00.000Z',
      } as never;
    }),
    getPublicHighlightShare: vi.fn(async () => ({
      title: 'clip',
      description: null,
      presignedMp4Url: 'https://s3/clip.mp4?sig=x',
      expiresAt: '2099-01-01T00:00:00.000Z',
    })),
  } as unknown as SharesService;

  return { ctrl: new PublicShareController(svc), svc };
}

function makeReq(over: {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
} = {}): {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
} {
  return {
    headers: over.headers ?? {},
    ip: over.ip,
  };
}

describe('PublicShareController', () => {
  it('happy: getMeeting делегируется с visitor.ip / userAgent / referrer', async () => {
    const { ctrl, svc } = build();
    const req = makeReq({
      headers: {
        'x-forwarded-for': '192.0.2.1, 198.51.100.10',
        'user-agent': 'TestBot/1.0',
        referer: 'https://partner.example/landing',
      },
      ip: '127.0.0.1',
    });
    const out = await ctrl.getMeeting('tok-1', req as never);
    expect(out.meeting.id).toBe('m-1');
    expect(svc.getPublicMeetingShare).toHaveBeenCalledWith('tok-1', {
      ip: '192.0.2.1',
      userAgent: 'TestBot/1.0',
      referrer: 'https://partner.example/landing',
    });
  });

  it('extractIp: array X-Forwarded-For берёт первый элемент', async () => {
    const { ctrl, svc } = build();
    const req = makeReq({
      headers: { 'x-forwarded-for': ['10.0.0.1', '10.0.0.2'] },
    });
    await ctrl.getMeeting('tok-1', req as never);
    const arg = (svc.getPublicMeetingShare as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(arg.ip).toBe('10.0.0.1');
  });

  it('extractIp: fallback на req.ip если X-Forwarded-For нет', async () => {
    const { ctrl, svc } = build();
    const req = makeReq({ headers: {}, ip: '203.0.113.5' });
    await ctrl.getMeeting('tok-1', req as never);
    const arg = (svc.getPublicMeetingShare as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(arg.ip).toBe('203.0.113.5');
  });

  it('referrer/referer оба читаются (canonical "referer" приоритетнее)', async () => {
    const { ctrl, svc } = build();
    const req = makeReq({
      headers: { referer: 'https://a.example', referrer: 'https://b.example' },
    });
    await ctrl.getMeeting('tok-1', req as never);
    const arg = (svc.getPublicMeetingShare as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(arg.referrer).toBe('https://a.example');
  });

  it('410 share_revoked если SharesService бросает GoneException', async () => {
    const { ctrl } = build({ meetingFails: 'revoked' });
    await expect(
      ctrl.getMeeting('tok-1', makeReq() as never),
    ).rejects.toBeInstanceOf(GoneException);
  });

  it('410 share_expired если время вышло', async () => {
    const { ctrl } = build({ meetingFails: 'expired' });
    await expect(
      ctrl.getMeeting('tok-1', makeReq() as never),
    ).rejects.toBeInstanceOf(GoneException);
  });

  it('404 share_not_found на неизвестный токен', async () => {
    const { ctrl } = build({ meetingFails: 'not_found' });
    await expect(
      ctrl.getMeeting('not-a-token', makeReq() as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('happy: getClip делегируется в getPublicHighlightShare', async () => {
    const { ctrl, svc } = build();
    const res = await ctrl.getClip('clip-token-1');
    expect(svc.getPublicHighlightShare).toHaveBeenCalledWith('clip-token-1');
    expect(res.presignedMp4Url).toContain('https://');
  });

  // ─────────────────────────── @Throttle статическая проверка ────────────
  // Vitest-runtime (через bun + esbuild) НЕ применяет class-decorators так же,
  // как `tsc --emitDecoratorMetadata` в Nest-рантайме, поэтому
  // `Reflect.getMetadata(THROTTLER_LIMIT+'default', ctor)` пуст.
  // Вместо этого делаем статическую проверку файла: убеждаемся, что @Throttle
  // присутствует на классе + на каждом GET-методе с разумным лимитом.
  // Если кто-то удалит декоратор — этот тест упадёт.
  describe('@Throttle декоратор для anti-brute-force (статическая проверка)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof fsModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof pathModule;
    const src = fs.readFileSync(
      path.join(__dirname, 'public-share.controller.ts'),
      'utf8',
    );

    it('импорт Throttle из @nestjs/throttler', () => {
      expect(src).toContain("from '@nestjs/throttler'");
      expect(src).toContain('Throttle');
    });

    it('@Throttle на классе с разумным лимитом (≤60 req/min)', () => {
      // Класс-уровневая директива: @Throttle({ default: { limit: N, ttl: M } })
      // непосредственно перед `export class PublicShareController`.
      const classMatch = src.match(
        /@Throttle\(\{[^}]*default:[^}]*limit:\s*(\d+)[\s\S]*?\}\s*\}\)\s*\nexport class PublicShareController/,
      );
      expect(classMatch).not.toBeNull();
      const limit = Number(classMatch?.[1]);
      expect(limit).toBeGreaterThan(0);
      expect(limit).toBeLessThanOrEqual(60);
    });

    it('@Throttle на методе getMeeting', () => {
      expect(src).toMatch(/@Throttle\([^)]*\)\s*\n\s*getMeeting/);
    });

    it('@Throttle на методе getClip', () => {
      expect(src).toMatch(/@Throttle\([^)]*\)\s*\n\s*getClip/);
    });
  });
});
