import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const tenantId = this.resolve(req);
    if (tenantId) {
      (req as Request & { tenantId?: string }).tenantId = tenantId;
    }
    next();
  }

  private resolve(req: Request): string | null {
    const headerVal = req.headers['x-org-id'];
    if (typeof headerVal === 'string' && headerVal.trim().length > 0) {
      return headerVal.trim();
    }

    const orgIdFromUrl = this.parseOrgIdFromUrl(req.originalUrl ?? req.url ?? '');
    if (orgIdFromUrl) return orgIdFromUrl;

    const body = (req as Request & { body?: Record<string, unknown> }).body;
    if (body) {
      const t = body['tenantId'];
      const o = body['orgId'];
      if (typeof t === 'string' && t.length > 0) return t;
      if (typeof o === 'string' && o.length > 0) return o;
    }
    return null;
  }

  private parseOrgIdFromUrl(url: string): string | null {
    const path = url.split('?')[0] ?? '';
    const match = path.match(/^\/api\/v1\/orgs\/([A-Za-z0-9_-]{6,64})(?:\/|$)/);
    return match?.[1] ?? null;
  }
}
