import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';

import { LivekitService } from './livekit.service';

/**
 * Юнит-тесты `LivekitService`.
 *
 * Проверяем токены: декодируем JWT, проверяем grants (видеограрант LiveKit
 * лежит в claim'е `video`), идентичность, имя, TTL.
 *
 * Реальные вызовы `RoomServiceClient` мы не тестируем — это интеграционно.
 */

const API_KEY = 'devkey';
const API_SECRET = 'devsecret-must-be-32-chars-min-xxxxxx';
const API_URL = 'http://localhost:7880';

function makeCfg(): TypedConfigService {
  return {
    livekit: {
      apiUrl: API_URL,
      apiKey: API_KEY,
      apiSecret: API_SECRET,
    },
  } as unknown as TypedConfigService;
}

interface DecodedClaims {
  iss: string;
  sub: string;
  exp: number;
  iat?: number;
  nbf?: number;
  name?: string;
  video?: {
    roomJoin?: boolean;
    room?: string;
    canPublish?: boolean;
    canSubscribe?: boolean;
    canPublishData?: boolean;
    roomAdmin?: boolean;
  };
}

/**
 * `livekit-server-sdk` v2 (через `jose`) НЕ кладёт в payload `iat`,
 * а пишет `nbf` (== время выпуска) и `exp`. Используем `nbf` либо текущий
 * `Date.now()` как точку отсчёта при подсчёте TTL.
 */
function ttlSec(claims: DecodedClaims): number {
  const start = claims.nbf ?? claims.iat ?? Math.floor(Date.now() / 1000);
  return claims.exp - start;
}

function decode(token: string): DecodedClaims {
  const decoded = jwt.verify(token, API_SECRET, { algorithms: ['HS256'] });
  if (typeof decoded !== 'object' || decoded === null) {
    throw new Error('JWT decode failed');
  }
  return decoded as unknown as DecodedClaims;
}

describe('LivekitService — токены', () => {
  it('generateHostToken: roomJoin, roomAdmin=true, identity, room, canPublish/Subscribe', async () => {
    const svc = new LivekitService(makeCfg());
    const token = await svc.generateHostToken(
      { id: 'meeting-1' },
      'host:user-1',
      'Иван',
    );

    const claims = decode(token);
    expect(claims.iss).toBe(API_KEY);
    expect(claims.sub).toBe('host:user-1');
    expect(claims.name).toBe('Иван');
    expect(claims.video?.roomJoin).toBe(true);
    expect(claims.video?.room).toBe('meeting-1');
    expect(claims.video?.canPublish).toBe(true);
    expect(claims.video?.canSubscribe).toBe(true);
    expect(claims.video?.canPublishData).toBe(true);
    expect(claims.video?.roomAdmin).toBe(true);
  });

  it('generateGuestToken: roomAdmin=false, остальные grants выставлены', async () => {
    const svc = new LivekitService(makeCfg());
    const token = await svc.generateGuestToken(
      { id: 'meeting-2' },
      'guest:abc',
      'Гость',
    );

    const claims = decode(token);
    expect(claims.sub).toBe('guest:abc');
    expect(claims.name).toBe('Гость');
    expect(claims.video?.roomJoin).toBe(true);
    expect(claims.video?.room).toBe('meeting-2');
    expect(claims.video?.canPublish).toBe(true);
    expect(claims.video?.canSubscribe).toBe(true);
    expect(claims.video?.canPublishData).toBe(true);
    // roomAdmin может быть либо false, либо отсутствовать (LiveKit опускает false-значения).
    expect(Boolean(claims.video?.roomAdmin)).toBe(false);
  });

  it('TTL по умолчанию = 4 часа (если endedAt отсутствует)', async () => {
    const svc = new LivekitService(makeCfg());
    const before = Math.floor(Date.now() / 1000);
    const token = await svc.generateGuestToken(
      { id: 'meeting-3' },
      'guest:x',
      'Г',
    );
    const claims = decode(token);

    const ttl = ttlSec(claims);
    expect(ttl).toBeGreaterThanOrEqual(4 * 60 * 60 - 5);
    expect(ttl).toBeLessThanOrEqual(4 * 60 * 60 + 5);
    // sanity: токен валиден сейчас.
    expect(claims.exp).toBeGreaterThan(before);
  });

  it('TTL ограничен endedAt + 5 минут', async () => {
    const svc = new LivekitService(makeCfg());
    // endedAt через 10 минут → expected TTL ≈ 15 минут.
    const endedAt = new Date(Date.now() + 10 * 60 * 1000);
    const token = await svc.generateHostToken(
      { id: 'meeting-4', endedAt },
      'host:u',
      'H',
    );
    const claims = decode(token);
    const ttl = ttlSec(claims);

    // 10 мин + 5 мин грации = 15 мин. Допустим окно ±5 секунд.
    expect(ttl).toBeGreaterThanOrEqual(15 * 60 - 5);
    expect(ttl).toBeLessThanOrEqual(15 * 60 + 5);
  });

  it('TTL ограничен потолком 8 часов даже если endedAt далеко в будущем', async () => {
    const svc = new LivekitService(makeCfg());
    const endedAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const token = await svc.generateHostToken(
      { id: 'meeting-5', endedAt },
      'host:u',
      'H',
    );
    const claims = decode(token);
    const ttl = ttlSec(claims);

    expect(ttl).toBeLessThanOrEqual(8 * 60 * 60 + 5);
    // И не сильно меньше 8h.
    expect(ttl).toBeGreaterThanOrEqual(8 * 60 * 60 - 5);
  });

  it('endedAt в прошлом → минимальный TTL 60 секунд', async () => {
    const svc = new LivekitService(makeCfg());
    const endedAt = new Date(Date.now() - 60 * 60 * 1000);
    const token = await svc.generateHostToken(
      { id: 'meeting-6', endedAt },
      'host:u',
      'H',
    );
    const claims = decode(token);
    const ttl = ttlSec(claims);

    expect(ttl).toBeGreaterThanOrEqual(50);
    expect(ttl).toBeLessThanOrEqual(70);
  });
});
