import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type EntityLink, type EntityLinkType, type LinkCreatedBy, Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

import { TemporalConflictService } from './temporal-conflict.service';

@Injectable()
export class EntityLinkService {
  private readonly logger = new Logger(EntityLinkService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(TemporalConflictService)
    private readonly temporalConflict?: TemporalConflictService,
  ) {}

  async upsertRichEdge(args: {
    tenantId: string;
    fromEntityId: string;
    toEntityId: string;
    fromType?: string | null;
    toType?: string | null;
    relationType: EntityLinkType;
    confidence: number;
    explanation: string;
    createdBy: LinkCreatedBy;
    attributes?: Record<string, string | number | boolean | null> | null;
    sourceBlockIds?: ReadonlyArray<string>;
    validFrom?: Date | null;
    validUntil?: Date | null;
  }): Promise<EntityLink> {
    const fromType = args.fromType ?? 'entity';
    const toType = args.toType ?? 'entity';
    const newConfDec = new Prisma.Decimal(args.confidence.toFixed(3));
    const newAttributes = sanitizeAttributes(args.attributes);
    const newSources = uniqueStrings(args.sourceBlockIds ?? []);

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.entityLink.findUnique({
        where: {
          fromEntityId_fromType_toEntityId_toType_relationType: {
            fromEntityId: args.fromEntityId,
            fromType,
            toEntityId: args.toEntityId,
            toType,
            relationType: args.relationType,
          },
        },
      });

      if (!existing) {
        return tx.entityLink.create({
          data: {
            tenantId: args.tenantId,
            fromEntityId: args.fromEntityId,
            fromType,
            toEntityId: args.toEntityId,
            toType,
            relationType: args.relationType,
            confidence: newConfDec,
            explanation: args.explanation,
            createdBy: args.createdBy,
            status: 'active',
            attributes: newAttributes ?? Prisma.JsonNull,
            sourceBlockIds: newSources,
            ...(args.validFrom !== undefined && args.validFrom !== null
              ? { validFrom: args.validFrom }
              : {}),
            ...(args.validUntil !== undefined ? { validUntil: args.validUntil } : {}),
          },
        });
      }

      const existingConf = numberFromDecimal(existing.confidence);
      const mergedConf = Math.max(existingConf, args.confidence);
      const mergedConfDec = new Prisma.Decimal(mergedConf.toFixed(3));

      const mergedSources = uniqueStrings([...existing.sourceBlockIds, ...newSources]);

      const mergedAttributes = mergeAttributes(existing.attributes as unknown, newAttributes);

      return tx.entityLink.update({
        where: { id: existing.id },
        data: {
          confidence: mergedConfDec,
          explanation: args.explanation,
          sourceBlockIds: mergedSources,
          attributes:
            mergedAttributes === null
              ? Prisma.JsonNull
              : (mergedAttributes as Prisma.InputJsonValue),
          status: 'active',
          ...(args.validFrom !== undefined && args.validFrom !== null
            ? { validFrom: args.validFrom }
            : {}),
          ...(args.validUntil !== undefined ? { validUntil: args.validUntil } : {}),
        },
      });
    });

    if (this.temporalConflict) {
      try {
        await this.temporalConflict.onNewEntityLink(result);
      } catch (err) {
        this.logger.warn(
          {
            linkId: result.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'entity-link: TemporalConflictService.onNewEntityLink упал — продолжаю',
        );
      }
    }

    return result;
  }
}

function sanitizeAttributes(
  attrs: Record<string, string | number | boolean | null> | null | undefined,
): Record<string, string | number | boolean | null> | null {
  if (!attrs || typeof attrs !== 'object') return null;
  const out: Record<string, string | number | boolean | null> = {};
  let count = 0;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
      count += 1;
    }
  }
  if (count === 0) return null;
  return out;
}

function mergeAttributes(
  existing: unknown,
  incoming: Record<string, string | number | boolean | null> | null,
): Record<string, string | number | boolean | null> | null {
  if (!incoming) {
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      return existing as Record<string, string | number | boolean | null>;
    }
    return null;
  }
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    return incoming;
  }
  return {
    ...(existing as Record<string, string | number | boolean | null>),
    ...incoming,
  };
}

function uniqueStrings(arr: ReadonlyArray<string>): string[] {
  return [...new Set(arr)];
}

function numberFromDecimal(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (v && typeof (v as { toString?: () => string }).toString === 'function') {
    const n = Number((v as { toString: () => string }).toString());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
