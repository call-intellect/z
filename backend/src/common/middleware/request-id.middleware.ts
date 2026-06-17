import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { nanoid } from 'nanoid';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  private static readonly REQUEST_ID_LENGTH = 12;
  private static readonly HEADER_NAME = 'X-Request-Id';

  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = this.normalizeIncoming(req.header(RequestIdMiddleware.HEADER_NAME));
    const id = incoming ?? nanoid(RequestIdMiddleware.REQUEST_ID_LENGTH);

    req.id = id;
    res.setHeader(RequestIdMiddleware.HEADER_NAME, id);

    next();
  }

  private normalizeIncoming(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    if (trimmed.length > 128) return undefined;
    return trimmed;
  }
}
