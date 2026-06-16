import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type BrandVoiceProfile, type Document } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditLogService } from '../../audit/audit-log.service';
import {
  type BrandVoiceArtifactDto,
  type BrandVoiceProfileDto,
  type BrandVoiceTabooItem,
  type BrandVoiceTone,
  type BrandVoiceValueItem,
  type UpdateBrandVoiceProfileDto,
} from '../dto/brand-voice.dto';
import { brandVoiceTenantTop } from '../utils/tenant-top';

@Injectable()
export class BrandVoiceService {
  private readonly logger = new Logger(BrandVoiceService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async getOrCreate(tenantId: string): Promise<BrandVoiceProfileDto> {
    const existing = await this.prisma.brandVoiceProfile.findUnique({
      where: { tenantId },
    });
    let row: BrandVoiceProfile;
    if (existing) {
      row = existing;
    } else {
      row = await this.prisma.brandVoiceProfile.create({
        data: { tenantId },
      });
      this.logger.log({ tenantId, brandVoiceProfileId: row.id }, 'BrandVoiceProfile создан lazily');
    }
    const corpusSize = await this.corpusSize(tenantId);
    return this.toDto(row, corpusSize);
  }

  async getRaw(tenantId: string): Promise<BrandVoiceProfile | null> {
    return this.prisma.brandVoiceProfile.findUnique({ where: { tenantId } });
  }

  async update(args: {
    tenantId: string;
    userId: string;
    body: UpdateBrandVoiceProfileDto;
  }): Promise<BrandVoiceProfileDto> {
    await this.getOrCreate(args.tenantId);

    const data: Prisma.BrandVoiceProfileUpdateInput = {};
    if (args.body.tone !== undefined) {
      data.toneJson =
        args.body.tone === null
          ? (Prisma.JsonNull as unknown as Prisma.InputJsonValue)
          : (args.body.tone as unknown as Prisma.InputJsonValue);
    }
    if (args.body.values !== undefined) {
      data.valuesJson =
        args.body.values === null
          ? (Prisma.JsonNull as unknown as Prisma.InputJsonValue)
          : (args.body.values as unknown as Prisma.InputJsonValue);
    }
    if (args.body.taboos !== undefined) {
      data.taboosJson =
        args.body.taboos === null
          ? (Prisma.JsonNull as unknown as Prisma.InputJsonValue)
          : (args.body.taboos as unknown as Prisma.InputJsonValue);
    }
    if (args.body.exampleArtifactIds !== undefined) {
      data.exampleArtifactIds = args.body.exampleArtifactIds;
    }

    const updated = await this.prisma.brandVoiceProfile.update({
      where: { tenantId: args.tenantId },
      data,
    });
    void this.audit.log({
      userId: args.userId,
      action: 'brand_voice.updated',
      resourceId: updated.id,
      metadata: {
        tenantId: args.tenantId,
        changedFields: Object.keys(args.body),
      },
    });
    const corpusSize = await this.corpusSize(args.tenantId);
    this.updateMetrics({ tenantId: args.tenantId, row: updated, corpusSize });
    return this.toDto(updated, corpusSize);
  }

  async applyExtracted(args: {
    tenantId: string;
    tone: BrandVoiceTone | null;
    values: BrandVoiceValueItem[] | null;
    taboos: BrandVoiceTabooItem[] | null;
    exampleArtifactIds: string[];
    builderAgentVersion: string;
  }): Promise<BrandVoiceProfile> {
    const existing = await this.prisma.brandVoiceProfile.findUnique({
      where: { tenantId: args.tenantId },
    });
    const nextVersion = (existing?.version ?? 0) + 1;
    const data: Prisma.BrandVoiceProfileUpdateInput = {
      toneJson:
        args.tone === null
          ? (Prisma.JsonNull as unknown as Prisma.InputJsonValue)
          : (args.tone as unknown as Prisma.InputJsonValue),
      valuesJson:
        args.values === null
          ? (Prisma.JsonNull as unknown as Prisma.InputJsonValue)
          : (args.values as unknown as Prisma.InputJsonValue),
      taboosJson:
        args.taboos === null
          ? (Prisma.JsonNull as unknown as Prisma.InputJsonValue)
          : (args.taboos as unknown as Prisma.InputJsonValue),
      exampleArtifactIds: args.exampleArtifactIds,
      version: nextVersion,
      lastBuiltAt: new Date(),
      builderAgentVersion: args.builderAgentVersion,
    };
    const upserted = await this.prisma.brandVoiceProfile.upsert({
      where: { tenantId: args.tenantId },
      create: {
        tenantId: args.tenantId,
        toneJson:
          args.tone === null
            ? (Prisma.JsonNull as unknown as Prisma.InputJsonValue)
            : (args.tone as unknown as Prisma.InputJsonValue),
        valuesJson:
          args.values === null
            ? (Prisma.JsonNull as unknown as Prisma.InputJsonValue)
            : (args.values as unknown as Prisma.InputJsonValue),
        taboosJson:
          args.taboos === null
            ? (Prisma.JsonNull as unknown as Prisma.InputJsonValue)
            : (args.taboos as unknown as Prisma.InputJsonValue),
        exampleArtifactIds: args.exampleArtifactIds,
        version: 1,
        lastBuiltAt: new Date(),
        builderAgentVersion: args.builderAgentVersion,
        completeness: new Prisma.Decimal(0),
      },
      update: data,
    });

    const completeness = computeCompleteness(upserted);
    const finalRow = await this.prisma.brandVoiceProfile.update({
      where: { tenantId: args.tenantId },
      data: { completeness: new Prisma.Decimal(completeness) },
    });
    const corpusSize = await this.corpusSize(args.tenantId);
    this.updateMetrics({
      tenantId: args.tenantId,
      row: finalRow,
      corpusSize,
    });
    return finalRow;
  }

  async corpusSize(tenantId: string): Promise<number> {
    return this.prisma.document.count({
      where: {
        tenantId,
        deletedAt: null,
        useCases: { has: 'brand_corpus' },
      },
    });
  }

  async listArtifacts(tenantId: string): Promise<BrandVoiceArtifactDto[]> {
    const rows = await this.prisma.document.findMany({
      where: {
        tenantId,
        deletedAt: null,
        useCases: { has: 'brand_corpus' },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        name: true,
        mimeType: true,
        status: true,
        useCases: true,
        createdAt: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      mimeType: r.mimeType,
      status: r.status,
      useCases: r.useCases,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async updateDocumentUseCases(args: {
    tenantId: string;
    userId: string;
    documentId: string;
    useCases: string[];
  }): Promise<Document> {
    const doc = await this.prisma.document.findUnique({
      where: { id: args.documentId },
      select: { id: true, tenantId: true, deletedAt: true },
    });
    if (!doc || doc.deletedAt) {
      throw new Error('Документ не найден');
    }
    if (doc.tenantId !== args.tenantId) {
      throw new Error('Документ принадлежит другой Org');
    }
    const updated = await this.prisma.document.update({
      where: { id: args.documentId },
      data: { useCases: args.useCases },
    });
    void this.audit.log({
      userId: args.userId,
      action: 'document.use_cases_updated',
      resourceId: args.documentId,
      metadata: {
        tenantId: args.tenantId,
        useCases: args.useCases,
      },
    });
    const corpusSize = await this.corpusSize(args.tenantId);
    this.metrics.setBrandVoiceCorpusSize({
      tenantTop: brandVoiceTenantTop(args.tenantId),
      value: corpusSize,
    });
    return updated;
  }

  private updateMetrics(args: {
    tenantId: string;
    row: BrandVoiceProfile;
    corpusSize: number;
  }): void {
    const tenantTop = brandVoiceTenantTop(args.tenantId);
    this.metrics.setBrandVoiceProfileCompleteness({
      tenantTop,
      value: Number(args.row.completeness),
    });
    this.metrics.setBrandVoiceCorpusSize({
      tenantTop,
      value: args.corpusSize,
    });
  }

  private toDto(row: BrandVoiceProfile, corpusSize: number): BrandVoiceProfileDto {
    const minCorpusSize = this.cfg.brandVoice.minCorpusSize;
    return {
      id: row.id,
      tenantId: row.tenantId,
      tone: extractTone(row.toneJson),
      values: extractValues(row.valuesJson),
      taboos: extractTaboos(row.taboosJson),
      exampleArtifactIds: row.exampleArtifactIds,
      version: row.version,
      lastBuiltAt: row.lastBuiltAt ? row.lastBuiltAt.toISOString() : null,
      builderAgentVersion: row.builderAgentVersion,
      completeness: Number(row.completeness),
      corpusSize,
      belowCorpusThreshold: corpusSize < minCorpusSize,
      minCorpusSize,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

function extractTone(json: Prisma.JsonValue | null): BrandVoiceTone | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;
  const out: BrandVoiceTone = {};
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      (out as Record<string, number>)[key] = Math.max(0, Math.min(1, v));
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function extractValues(json: Prisma.JsonValue | null): BrandVoiceValueItem[] | null {
  if (!Array.isArray(json)) return null;
  const out: BrandVoiceValueItem[] = [];
  for (const it of json) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
    const obj = it as Record<string, unknown>;
    if (typeof obj.value !== 'string') continue;
    const weight =
      typeof obj.weight === 'number' && Number.isFinite(obj.weight)
        ? Math.max(0, Math.min(1, obj.weight))
        : 0.5;
    const exampleBlockIds = Array.isArray(obj.exampleBlockIds)
      ? obj.exampleBlockIds.filter((x): x is string => typeof x === 'string' && x.length > 0)
      : [];
    out.push({ value: obj.value.slice(0, 120), weight, exampleBlockIds });
  }
  return out.length > 0 ? out : null;
}

function extractTaboos(json: Prisma.JsonValue | null): BrandVoiceTabooItem[] | null {
  if (!Array.isArray(json)) return null;
  const out: BrandVoiceTabooItem[] = [];
  for (const it of json) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
    const obj = it as Record<string, unknown>;
    if (typeof obj.phrase !== 'string') continue;
    if (typeof obj.reason !== 'string') continue;
    out.push({
      phrase: obj.phrase.slice(0, 200),
      reason: obj.reason.slice(0, 500),
      ...(typeof obj.alternative === 'string'
        ? { alternative: obj.alternative.slice(0, 200) }
        : {}),
    });
  }
  return out.length > 0 ? out : null;
}

function computeCompleteness(row: BrandVoiceProfile): number {
  let score = 0;
  if (extractTone(row.toneJson) !== null) score += 0.25;
  const values = extractValues(row.valuesJson);
  if (values && values.length > 0) score += 0.25;
  const taboos = extractTaboos(row.taboosJson);
  if (taboos && taboos.length > 0) score += 0.25;
  if (row.exampleArtifactIds.length > 0) score += 0.25;
  return Math.max(0, Math.min(1, score));
}
