import { Inject, Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { IdempotencyService } from './idempotency.service';

const IDEMPOTENCY_HEADER = 'idempotency-key';

const MIN_KEY_LENGTH = 8;
const MAX_KEY_LENGTH = 128;

@Injectable()
export class IdempotencyMiddleware implements NestMiddleware {
  private readonly logger = new Logger(IdempotencyMiddleware.name);

  constructor(@Inject(IdempotencyService) private readonly store: IdempotencyService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (req.method !== 'POST') {
      next();
      return;
    }

    const rawKey = req.header(IDEMPOTENCY_HEADER);
    const key = this.normalizeKey(rawKey);
    if (!key) {
      next();
      return;
    }

    const tenantId = this.resolveTenantId(req);

    const cached = await this.store.getCached(key, tenantId);
    if (cached) {
      this.logger.debug(
        `Idempotency HIT key=${key} tenant=${tenantId ?? 'global'} status=${cached.status}`,
      );
      if (cached.headers) {
        for (const [name, value] of Object.entries(cached.headers)) {
          res.setHeader(name, value);
        }
      }
      res.setHeader('Idempotency-Replay', 'true');
      res.status(cached.status);
      res.json(cached.body);
      return;
    }

    this.wrapResponse(req, res, key, tenantId);
    next();
  }

  private wrapResponse(_req: Request, res: Response, key: string, tenantId: string | null): void {
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    const captureAndStore = (body: unknown): void => {
      const status = res.statusCode;
      if (status < 200 || status >= 300) {
        return;
      }
      void this.store
        .setCached(key, tenantId, {
          status,
          body: this.normalizeBody(body),
        })
        .catch((err) => {
          this.logger.warn(
            `Не удалось сохранить Idempotency snapshot: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    };

    res.json = (body?: unknown): Response => {
      captureAndStore(body);
      return originalJson(body);
    };

    res.send = (body?: unknown): Response => {
      captureAndStore(body);
      return originalSend(body);
    };
  }

  private resolveTenantId(req: Request): string | null {
    const headerVal = req.header('x-org-id');
    if (headerVal && typeof headerVal === 'string' && headerVal.trim().length > 0) {
      return headerVal.trim();
    }
    const user = (req as unknown as { user?: { tenantId?: string } }).user;
    if (user?.tenantId && typeof user.tenantId === 'string') {
      return user.tenantId;
    }
    return null;
  }

  private normalizeKey(raw: string | undefined): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (trimmed.length < MIN_KEY_LENGTH || trimmed.length > MAX_KEY_LENGTH) {
      return null;
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\s]/.test(trimmed)) return null;
    return trimmed;
  }

  private normalizeBody(body: unknown): unknown {
    if (body === undefined) return null;
    return body;
  }
}
