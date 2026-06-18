import { createHash, randomBytes } from 'node:crypto';

import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ApiKey } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { AuditLogService } from '../audit/audit-log.service';
import { AUDIT } from '../audit/audit.types';

import { ApiKeysRepository } from './api-keys.repository';
import type { CreateApiKeyDto } from './dto/create-api-key.dto';

@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);

  constructor(
    @Inject(ApiKeysRepository) private readonly repo: ApiKeysRepository,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  async list(userId: string): Promise<
    Array<{
      id: string;
      name: string;
      prefix: string;
      scopes: ApiKey['scopes'];
      scope: string;
      tenantId: string | null;
      lastUsedAt: Date | null;
      revokedAt: Date | null;
      createdAt: Date;
    }>
  > {
    const items = await this.repo.listByUser(userId);
    return items.map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      scopes: k.scopes,
      scope: k.scope,
      tenantId: k.tenantId,
      lastUsedAt: k.lastUsedAt,
      revokedAt: k.revokedAt,
      createdAt: k.createdAt,
    }));
  }

  async create(
    userId: string,
    dto: Omit<CreateApiKeyDto, 'scope'> & { scope?: 'api' | 'ingest' },
    tenantId?: string | null,
  ): Promise<{ apiKey: ApiKey; rawKey: string }> {
    const max = this.cfg.workspace.maxApiKeysPerUser;
    const active = await this.repo.countActive(userId);
    if (active >= max) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'api_keys_limit_reached',
          message: `Достигнут лимит активных API-ключей (${max})`,
        },
      });
    }

    const scope = dto.scope ?? 'api';
    if (scope === 'ingest' && !tenantId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'ingest_key_requires_tenant',
          message: 'Ingest-ключ требует tenantId (Org-привязку)',
        },
      });
    }

    const tokenPrefix = scope === 'ingest' ? 'zik_' : 'z_';
    const rawKey = `${tokenPrefix}${randomBytes(32).toString('base64url')}`;
    const hashedKey = sha256(rawKey);
    const prefix = rawKey.slice(0, 10);

    const apiKey = await this.repo.create({
      userId,
      tenantId: tenantId ?? null,
      name: dto.name,
      hashedKey,
      prefix,
      scopes: dto.scopes,
      scope,
    });

    await this.audit.log({
      userId,
      action: AUDIT.API_KEY_CREATE,
      resourceId: apiKey.id,
      metadata: { name: dto.name, scopes: dto.scopes, scope, tenantId: tenantId ?? null },
    });

    this.logger.log({ userId, apiKeyId: apiKey.id, scope }, 'api-key создан');
    return { apiKey, rawKey };
  }

  async revoke(id: string, userId: string): Promise<{ ok: true }> {
    const key = await this.repo.findById(id);
    if (!key || key.userId !== userId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'api_key_not_found', message: 'Ключ не найден' },
      });
    }
    if (key.revokedAt) {
      return { ok: true };
    }
    await this.repo.revoke(id);
    await this.audit.log({
      userId,
      action: AUDIT.API_KEY_DELETE,
      resourceId: id,
    });
    return { ok: true };
  }

  async resolveByRawKey(rawKey: string): Promise<ApiKey | null> {
    const hashed = sha256(rawKey);
    const key = await this.repo.findByHashed(hashed);
    if (!key) return null;
    if (key.revokedAt) return null;
    return key;
  }

  async resolveIngestKey(rawKey: string): Promise<ApiKey | null> {
    const hashed = sha256(rawKey);
    const key = await this.repo.findByHashed(hashed);
    if (!key) return null;
    if (key.revokedAt) return null;
    if (key.scope !== 'ingest') return null;
    return key;
  }

  touchLastUsed(id: string): Promise<void> {
    return this.repo.touchLastUsed(id).catch((err) => {
      this.logger.debug(`touchLastUsed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
