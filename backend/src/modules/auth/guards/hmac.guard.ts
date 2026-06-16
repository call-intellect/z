import { createHash } from 'node:crypto';

import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';

import {
  IdempotencyConflictError,
  IntegrationKeyInvalidError,
} from '../../../common/errors/domain-errors';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { HmacService } from '../services/hmac.service';

@Injectable()
export class HmacGuard implements CanActivate {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(HmacService) private readonly hmac: HmacService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest<Request>();
    const response = ctx.switchToHttp().getResponse<Response>();

    const plainKey = this.extractBearer(request.headers['authorization']);
    if (!plainKey) {
      throw new IntegrationKeyInvalidError('authorization_missing');
    }

    const keyHash = this.hmac.hashKey(plainKey);
    const integrationKey = await this.prisma.integrationKey.findFirst({
      where: { keyHash, revokedAt: null },
    });
    if (!integrationKey) {
      throw new IntegrationKeyInvalidError('not_found_or_revoked');
    }

    const rawBody = request.rawBody ?? Buffer.alloc(0);
    const signature = this.headerString(request.headers['x-crossmark-signature']);
    const timestamp = this.headerString(request.headers['x-crossmark-timestamp']);
    if (!signature || !timestamp) {
      throw new IntegrationKeyInvalidError('signature_or_timestamp_missing');
    }

    const ok = this.hmac.verify({
      body: rawBody,
      signature,
      timestamp,
      key: plainKey,
    });
    if (!ok) {
      throw new IntegrationKeyInvalidError('signature_mismatch');
    }

    request.partner = {
      id: integrationKey.id,
      partnerName: integrationKey.partnerName,
    };

    const idempKey = this.headerString(request.headers['x-idempotency-key']);
    if (idempKey && request.method !== 'GET') {
      const requestHash = this.bodyHash(rawBody);
      const existing = await this.prisma.crossmarkIdempotency.findUnique({
        where: { key: idempKey },
      });
      if (existing) {
        if (existing.responseHash !== requestHash) {
          throw new IdempotencyConflictError(idempKey);
        }
        response.status(existing.httpStatus).json(existing.responseBody);
        return false;
      }
      request.idempotencyKey = idempKey;
    }

    return true;
  }

  private extractBearer(header: string | string[] | undefined): string | undefined {
    const value = this.headerString(header);
    if (!value) return undefined;
    const match = /^Bearer\s+(.+)$/.exec(value);
    return match?.[1]?.trim();
  }

  private headerString(header: string | string[] | undefined): string | undefined {
    if (header === undefined) return undefined;
    if (Array.isArray(header)) return header[0];
    return header;
  }

  private bodyHash(body: Buffer): string {
    return createHash('sha256').update(body).digest('hex');
  }
}
