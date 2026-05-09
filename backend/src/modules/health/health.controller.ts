import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RoomServiceClient } from 'livekit-server-sdk';

import { TypedConfigService } from '../../common/config/index';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

/**
 * Версия читается из package.json один раз на старте.
 * Резолвится через `process.cwd()` — оба режима (`bun run dev`,
 * `node dist/main.js`) запускаются из корня backend-а.
 * При неудаче (например, тесты из другой директории) — fallback `'0.0.0'`.
 */
const APP_VERSION: string = (() => {
  try {
    const pkgPath = resolve(process.cwd(), 'package.json');
    const raw = readFileSync(pkgPath, 'utf-8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

type CheckResult = 'ok' | `fail:${string}`;

interface ReadyChecks {
  postgres: CheckResult;
  redis: CheckResult;
  livekit: CheckResult;
}

interface HealthResponse {
  status: 'ok';
  version: string;
}

interface ReadyResponse {
  ok: boolean;
  checks: ReadyChecks;
}

const LIVEKIT_TIMEOUT_MS = 2000;

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly cfg: TypedConfigService,
  ) {}

  /**
   * Простой liveness — возвращает `status: ok` и версию из package.json.
   * Не делает никаких внешних проверок.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness — версия и статус приложения' })
  health(): HealthResponse {
    return { status: 'ok', version: APP_VERSION };
  }

  /**
   * Чистый liveness — без зависимостей, для k8s liveness-probe в будущем.
   */
  @Get('live')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness probe (без проверок)' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Readiness — проверяет Postgres, Redis и LiveKit.
   * Если хоть одна проверка упала — отвечаем 503 + `{ ok:false, checks }`.
   */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness — проверка Postgres / Redis / LiveKit' })
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadyResponse> {
    const [postgres, redis, livekit] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
      this.checkLiveKit(),
    ]);

    const checks: ReadyChecks = { postgres, redis, livekit };
    const allOk = postgres === 'ok' && redis === 'ok' && livekit === 'ok';

    if (!allOk) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return { ok: allOk, checks };
  }

  // ────────────────────── checks ───────────────────────────────────────

  private async checkPostgres(): Promise<CheckResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'ok';
    } catch (err) {
      return `fail:${this.errMessage(err)}`;
    }
  }

  private async checkRedis(): Promise<CheckResult> {
    try {
      const pong = await this.redis.ping();
      return pong === 'PONG' ? 'ok' : `fail:unexpected_response:${pong}`;
    } catch (err) {
      return `fail:${this.errMessage(err)}`;
    }
  }

  private async checkLiveKit(): Promise<CheckResult> {
    try {
      const lk = this.cfg.livekit;
      const client = new RoomServiceClient(lk.apiUrl, lk.apiKey, lk.apiSecret);
      await this.withTimeout(client.listRooms(), LIVEKIT_TIMEOUT_MS, 'livekit_timeout');
      return 'ok';
    } catch (err) {
      return `fail:${this.errMessage(err)}`;
    }
  }

  private withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(label)), ms);
      p.then(
        (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        (err: unknown) => {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });
  }

  private errMessage(err: unknown): string {
    if (err instanceof Error) {
      // Не пускаем переводы строк / кавычки в ответ — оставляем компактно.
      return err.message.replace(/[\r\n"]/g, ' ').slice(0, 200);
    }
    return String(err).slice(0, 200);
  }
}
