import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type CompanyProfile } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditLogService } from '../../audit/audit-log.service';
import type {
  CompanyProfileDto,
  UpdateCompanyProfileDto,
} from '../dto/company-profile.dto';
import type {
  IOrganizationalUnit,
  OrganizationalUnitScope,
} from '../interfaces/organizational-unit.interface';

/**
 * SBA α-9 wave 3 — CRUD + Org-level operations над CompanyProfile.
 *
 * Бизнес-правила:
 *   - 1:1 на Org: запись либо есть, либо нет (создаём lazily при первом GET).
 *   - Хранит миссию / видение / стратегию в JSON-полях (расширяемо без alter table).
 *   - completeness/maturityScore пересчитывает MaturityScorerCron — этот сервис
 *     только триггерит rebuild при ручных правках.
 */
@Injectable()
export class CompanyProfileService {
  private readonly logger = new Logger(CompanyProfileService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  /**
   * Lazy-load или создаём пустой профиль на лету.
   */
  async getOrCreate(tenantId: string): Promise<CompanyProfileDto> {
    const existing = await this.prisma.companyProfile.findUnique({
      where: { tenantId },
    });
    if (existing) return this.toDto(existing);
    const created = await this.prisma.companyProfile.create({
      data: { tenantId },
    });
    this.logger.log(
      { tenantId, companyProfileId: created.id },
      'CompanyProfile создан lazily',
    );
    return this.toDto(created);
  }

  async update(args: {
    tenantId: string;
    userId: string;
    body: UpdateCompanyProfileDto;
  }): Promise<CompanyProfileDto> {
    // Lazy-create если ещё нет.
    await this.getOrCreate(args.tenantId);

    const data: Prisma.CompanyProfileUpdateInput = {};
    if (args.body.displayName !== undefined) data.displayName = args.body.displayName;
    if (args.body.mission !== undefined) {
      data.missionJson =
        args.body.mission === null
          ? (Prisma.JsonNull as unknown as Prisma.InputJsonValue)
          : (args.body.mission as unknown as Prisma.InputJsonValue);
    }
    if (args.body.vision !== undefined) {
      data.visionJson =
        args.body.vision === null
          ? (Prisma.JsonNull as unknown as Prisma.InputJsonValue)
          : (args.body.vision as unknown as Prisma.InputJsonValue);
    }
    if (args.body.strategy !== undefined) {
      data.strategyJson =
        args.body.strategy === null
          ? (Prisma.JsonNull as unknown as Prisma.InputJsonValue)
          : (args.body.strategy as unknown as Prisma.InputJsonValue);
    }
    if (args.body.targetMarketIds !== undefined) {
      data.targetMarketIds = args.body.targetMarketIds;
    }
    if (args.body.stage !== undefined) {
      data.stage = args.body.stage ?? null;
    }
    const updated = await this.prisma.companyProfile.update({
      where: { tenantId: args.tenantId },
      data,
    });
    void this.audit.log({
      userId: args.userId,
      action: 'company_profile.updated',
      resourceId: updated.id,
      metadata: {
        tenantId: args.tenantId,
        changedFields: Object.keys(args.body),
      },
    });
    return this.toDto(updated);
  }

  /**
   * Возвращает (или null) сырой row CompanyProfile — для MaturityScorerService.
   */
  async getRaw(tenantId: string): Promise<CompanyProfile | null> {
    return this.prisma.companyProfile.findUnique({ where: { tenantId } });
  }

  /**
   * Применить обновление maturityScore + lastMaturityCalcAt (вызывается из
   * MaturityScorerService).
   */
  async applyMaturity(args: {
    tenantId: string;
    maturityScore: number;
  }): Promise<void> {
    // upsert: профиль может ещё не существовать.
    await this.prisma.companyProfile.upsert({
      where: { tenantId: args.tenantId },
      create: {
        tenantId: args.tenantId,
        maturityScore: new Prisma.Decimal(args.maturityScore),
        lastMaturityCalcAt: new Date(),
      },
      update: {
        maturityScore: new Prisma.Decimal(args.maturityScore),
        lastMaturityCalcAt: new Date(),
      },
    });
  }

  /**
   * Idempotency-marker для completeness rebuild. На MVP не дёргает воркер —
   * MaturityScorerCron перезаписывает completeness при следующем проходе.
   * Возвращает «enqueued=false, reason=…» либо «enqueued=true», когда
   * подключим отдельный воркер.
   */
  async rebuildCompleteness(args: {
    tenantId: string;
    userId: string;
  }): Promise<{ enqueued: boolean; reason: string }> {
    void this.audit.log({
      userId: args.userId,
      action: 'company_profile.rebuild_completeness_requested',
      resourceId: args.tenantId,
      metadata: { tenantId: args.tenantId },
    });
    return {
      enqueued: true,
      reason: 'Будет пересчитан при следующем проходе MaturityScorerCron',
    };
  }

  // ─────────────────────────── IOrganizationalUnit ───────────────────

  /**
   * Преобразование CompanyProfile в IOrganizationalUnit. Children — отделы
   * верхнего уровня (parentDepartmentId IS NULL).
   */
  toUnit(row: CompanyProfile, orgName: string): IOrganizationalUnit {
    const prisma = this.prisma;
    return {
      scope: 'company' as OrganizationalUnitScope,
      id: row.id,
      tenantId: row.tenantId,
      name: row.displayName ?? orgName,
      missionStatement: extractContentMd(row.missionJson),
      entityId: null,
      maturityScore: row.maturityScore ? Number(row.maturityScore) : null,
      completeness: row.maturityScore ? Number(row.maturityScore) : null,
      parentUnitId: null,
      async getChildren(): Promise<IOrganizationalUnit[]> {
        const departments = await prisma.department.findMany({
          where: {
            tenantId: row.tenantId,
            deletedAt: null,
            parentDepartmentId: null,
          },
        });
        return departments.map((d) => ({
          scope: 'department' as OrganizationalUnitScope,
          id: d.id,
          tenantId: d.tenantId,
          name: d.name,
          missionStatement: d.missionStatement,
          entityId: d.entityId,
          maturityScore: null,
          completeness: d.completeness ? Number(d.completeness) : null,
          parentUnitId: d.parentDepartmentId,
          async getChildren(): Promise<IOrganizationalUnit[]> {
            return [];
          },
        }));
      },
    };
  }

  // ─────────────────────────── helpers ──────────────────────────────

  private toDto(p: CompanyProfile): CompanyProfileDto {
    return {
      id: p.id,
      tenantId: p.tenantId,
      displayName: p.displayName,
      mission: extractMission(p.missionJson),
      vision: extractVision(p.visionJson),
      strategy: extractStrategy(p.strategyJson),
      targetMarketIds: p.targetMarketIds,
      maturityScore: p.maturityScore ? Number(p.maturityScore) : null,
      lastMaturityCalcAt: p.lastMaturityCalcAt
        ? p.lastMaturityCalcAt.toISOString()
        : null,
      stage: p.stage,
      sourceBlockIds: p.sourceBlockIds,
      confidence: p.confidence ? Number(p.confidence) : null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }
}

// ─────────────────────────── JSON helpers ──────────────────────────

function extractContentMd(json: Prisma.JsonValue | null): string | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const v = (json as Record<string, unknown>).contentMd;
  return typeof v === 'string' ? v : null;
}

function extractMission(json: Prisma.JsonValue | null):
  | CompanyProfileDto['mission']
  | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;
  const contentMd = obj.contentMd;
  if (typeof contentMd !== 'string') return null;
  return {
    contentMd,
    ...(typeof obj.horizon === 'string' ? { horizon: obj.horizon } : {}),
    ...(typeof obj.targetDate === 'string' ? { targetDate: obj.targetDate } : {}),
  };
}

function extractVision(json: Prisma.JsonValue | null):
  | CompanyProfileDto['vision']
  | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;
  const contentMd = obj.contentMd;
  if (typeof contentMd !== 'string') return null;
  return {
    contentMd,
    ...(typeof obj.horizonYears === 'number'
      ? { horizonYears: obj.horizonYears }
      : {}),
    ...(typeof obj.targetDate === 'string' ? { targetDate: obj.targetDate } : {}),
  };
}

function extractStrategy(json: Prisma.JsonValue | null):
  | CompanyProfileDto['strategy']
  | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;
  const contentMd = obj.contentMd;
  if (typeof contentMd !== 'string') return null;
  return {
    contentMd,
    ...(Array.isArray(obj.markets)
      ? { markets: obj.markets.filter((m): m is string => typeof m === 'string') }
      : {}),
    ...(Array.isArray(obj.bets)
      ? { bets: obj.bets.filter((b): b is string => typeof b === 'string') }
      : {}),
    ...(typeof obj.horizon === 'string' ? { horizon: obj.horizon } : {}),
    ...(typeof obj.targetDate === 'string' ? { targetDate: obj.targetDate } : {}),
  };
}
