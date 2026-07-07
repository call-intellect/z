import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Optional,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Prisma, ThemeBranch } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { RequireEntitlement } from '../../entitlements/require-entitlement.decorator';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import { BranchDerivationService } from '../services/branch-derivation.service';
import { THEME_BRANCH_VALUES } from '../services/theme-classification.service';

import type { BranchDetailDto, BranchesMapDto, BranchTileDto } from './dto/branches.dto';
import type { ThemeItemDto } from './dto/theme.dto';

const BRANCH_LABELS: Record<string, string> = {
  strategy: 'Стратегия',
  clients: 'Клиенты',
  sales: 'Продажи',
  marketing: 'Маркетинг',
  product: 'Продукт',
  operations: 'Операции',
  team: 'Команда',
  finance: 'Финансы',
  technology: 'Технологии',
  production: 'Производство',
  partnerships: 'Партнёрства',
  legal: 'Юридическое',
  unassigned: 'Не отнесено',
};

const KNOWN_BRANCHES = new Set<string>([...THEME_BRANCH_VALUES, 'unassigned']);

const BRANCH_DETAIL_SECTION_LIMIT = 100;
const BRANCH_SUMMARY_MAX_CHARS = 300;

@ApiTags('knowledge-core')
@Controller('api/v1/knowledge/branches')
@UseGuards(CookieAuthGuard, TenantGuard)
@RequireEntitlement('feature.theme')
export class KnowledgeBranchesController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(BranchDerivationService)
    private readonly branchDerivation: BranchDerivationService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService | null = null,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Карта 12 областей знаний Org (плитки со счётчиками и сигналом)' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<BranchesMapDto> {
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    const allowed = await this.rbac.canRead(user.id, tenantId, 'theme');
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав' },
      });
    }

    this.metrics?.incBranchesMapRequest();
    const startedAt = Date.now();
    const entries = await this.branchDerivation.aggregateBranchMap(tenantId, user.id);
    this.metrics?.observeBranchesMapMs(Date.now() - startedAt);

    const tiles: BranchTileDto[] = entries.map((e) => ({
      branch: e.branch,
      label: BRANCH_LABELS[e.branch] ?? e.branch,
      counts: e.counts,
      signal: e.signal,
    }));

    return { tiles };
  }

  @Get(':branch')
  @ApiOperation({ summary: 'Деталь области: темы + регламенты + процессы + документы + решения' })
  async detail(
    @Param('branch') branchParam: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<BranchDetailDto> {
    if (!KNOWN_BRANCHES.has(branchParam)) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'unknown_branch', message: 'Неизвестная область' },
      });
    }
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    const allowed = await this.rbac.canRead(user.id, tenantId, 'theme');
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав' },
      });
    }

    const isUnassigned = branchParam === 'unassigned';
    const branchValue = isUnassigned ? null : (branchParam as ThemeBranch);

    const themeWhere: Prisma.ThemeWhereInput = {
      tenantId,
      branch: branchValue,
      status: 'active',
      OR: [{ visibility: 'team' }, { createdByUserId: user.id }],
    };
    const themeRows = await this.prisma.theme.findMany({
      where: themeWhere,
      include: { _count: { select: { blocks: true, entities: true } } },
      orderBy: [{ weight: 'desc' }],
      take: BRANCH_DETAIL_SECTION_LIMIT,
    });
    const themes: ThemeItemDto[] = themeRows.map((t) =>
      this.mapTheme(t, t._count.blocks, t._count.entities, t.createdByUserId === user.id),
    );

    const regulations = await this.buildRegulations(tenantId, user.id, branchValue, isUnassigned);
    const processes = await this.buildProcesses(tenantId, user.id, branchValue, isUnassigned);
    const documents = await this.buildDocuments(tenantId, user.id, branchValue, isUnassigned);
    const decisions = await this.buildDecisions(tenantId, user.id, branchValue, isUnassigned);

    const summary = this.buildSummary(themeRows);

    return {
      branch: branchParam,
      label: BRANCH_LABELS[branchParam] ?? branchParam,
      summary,
      themes,
      regulations,
      processes,
      documents,
      decisions,
    };
  }

  private async buildRegulations(
    tenantId: string,
    viewerUserId: string,
    branchValue: ThemeBranch | null,
    isUnassigned: boolean,
  ): Promise<BranchDetailDto['regulations']> {
    const rows = await this.prisma.regulation.findMany({
      where: { tenantId },
      select: { id: true, name: true, category: true, entityId: true },
    });
    const entityIds = rows
      .map((r) => r.entityId)
      .filter((id): id is string => id != null);
    const derived = await this.branchDerivation.deriveBranchForEntityIds(
      tenantId,
      entityIds,
      viewerUserId,
    );
    const matched = rows.filter((r) => {
      const branch = r.entityId != null ? derived.get(r.entityId) ?? null : null;
      return isUnassigned ? branch == null : branch === branchValue;
    });
    return matched.slice(0, BRANCH_DETAIL_SECTION_LIMIT).map((r) => ({
      id: r.id,
      title: r.name,
      category: String(r.category),
      href: `/regulations/${r.id}`,
    }));
  }

  private async buildProcesses(
    tenantId: string,
    viewerUserId: string,
    branchValue: ThemeBranch | null,
    isUnassigned: boolean,
  ): Promise<BranchDetailDto['processes']> {
    const rows = await this.prisma.process.findMany({
      where: { tenantId },
      select: { id: true, name: true, entityId: true },
    });
    const entityIds = rows
      .map((p) => p.entityId)
      .filter((id): id is string => id != null);
    const derived = await this.branchDerivation.deriveBranchForEntityIds(
      tenantId,
      entityIds,
      viewerUserId,
    );
    const matched = rows.filter((p) => {
      const branch = p.entityId != null ? derived.get(p.entityId) ?? null : null;
      return isUnassigned ? branch == null : branch === branchValue;
    });
    return matched.slice(0, BRANCH_DETAIL_SECTION_LIMIT).map((p) => ({
      id: p.id,
      name: p.name,
      href: `/processes/${p.id}`,
    }));
  }

  private async buildDocuments(
    tenantId: string,
    viewerUserId: string,
    branchValue: ThemeBranch | null,
    isUnassigned: boolean,
  ): Promise<BranchDetailDto['documents']> {
    const rows = await this.prisma.document.findMany({
      where: { tenantId, attachedThemeId: { not: null } },
      select: { id: true, name: true, attachedThemeId: true },
    });
    const themeIds = rows
      .map((d) => d.attachedThemeId)
      .filter((id): id is string => id != null);
    const derived = await this.branchDerivation.deriveBranchForThemeIds(
      tenantId,
      themeIds,
      viewerUserId,
    );
    const matched = rows.filter((d) => {
      const branch = d.attachedThemeId != null ? derived.get(d.attachedThemeId) ?? null : null;
      return isUnassigned ? branch == null : branch === branchValue;
    });
    return matched.slice(0, BRANCH_DETAIL_SECTION_LIMIT).map((d) => ({
      id: d.id,
      title: d.name,
      href: `/documents/${d.id}`,
    }));
  }

  private async buildDecisions(
    tenantId: string,
    viewerUserId: string,
    branchValue: ThemeBranch | null,
    isUnassigned: boolean,
  ): Promise<BranchDetailDto['decisions']> {
    const rows = await this.prisma.decision.findMany({
      where: { tenantId },
      select: { id: true, statement: true, entityId: true, affectsEntityIds: true },
    });
    const entityIds = new Set<string>();
    for (const d of rows) {
      if (d.entityId != null) entityIds.add(d.entityId);
      for (const id of d.affectsEntityIds) entityIds.add(id);
    }
    const derived = await this.branchDerivation.deriveBranchForEntityIds(
      tenantId,
      [...entityIds],
      viewerUserId,
    );
    const branchOf = (d: {
      entityId: string | null;
      affectsEntityIds: string[];
    }): ThemeBranch | null => {
      let branch = d.entityId != null ? derived.get(d.entityId) ?? null : null;
      if (branch == null) {
        for (const id of d.affectsEntityIds) {
          const candidate = derived.get(id) ?? null;
          if (candidate != null) {
            branch = candidate;
            break;
          }
        }
      }
      return branch;
    };
    const matched = rows.filter((d) => {
      const branch = branchOf(d);
      return isUnassigned ? branch == null : branch === branchValue;
    });
    return matched.slice(0, BRANCH_DETAIL_SECTION_LIMIT).map((d) => ({
      id: d.id,
      statement: d.statement,
      reversibility: null,
      href: `/decisions/${d.id}`,
    }));
  }

  private buildSummary(themeRows: { summary: string | null }[]): string {
    const parts: string[] = [];
    for (const t of themeRows) {
      const s = t.summary?.trim();
      if (s) parts.push(s);
      if (parts.length >= 2) break;
    }
    return parts.join(' ').slice(0, BRANCH_SUMMARY_MAX_CHARS);
  }

  private mapTheme(
    t: {
      id: string;
      name: string;
      description: string;
      branch: string | null;
      status: string;
      origin: string;
      visibility: string;
      weight: unknown;
      confidence: unknown;
      dynamic: string;
      lastSignalAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    },
    blocksCount: number,
    entitiesCount: number,
    isMine: boolean,
  ): ThemeItemDto {
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      branch: t.branch,
      status: t.status,
      origin: t.origin,
      visibility: t.visibility,
      isMine,
      weight: this.decimalToNumber(t.weight),
      confidence: this.decimalToNumber(t.confidence),
      dynamic: t.dynamic,
      lastSignalAt: t.lastSignalAt ? t.lastSignalAt.toISOString() : null,
      blocksCount,
      entitiesCount,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  private decimalToNumber(v: unknown): number {
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
}
