import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ProbeService } from '../../probe/probe.service';
import { CompanyProfileService } from '../services/company-profile.service';

interface ProfileGap {
  reason: string;
  question: string;
}

@Injectable()
export class CompanyProfileCompletenessCron {
  private readonly logger = new Logger(CompanyProfileCompletenessCron.name);
  static readonly EMITTED_BY = 'company-profile-completeness';

  private static readonly GAPS: readonly {
    field: 'missionJson' | 'visionJson' | 'strategyJson';
    reason: string;
    question: string;
  }[] = [
    {
      field: 'missionJson',
      reason: 'companyprofile.missing_mission',
      question:
        'Какая у компании миссия? Кора набросала черновик из ваших решений — проверьте и поправьте.',
    },
    {
      field: 'visionJson',
      reason: 'companyprofile.missing_vision',
      question:
        'Каким вы видите будущее компании? Кора набросала черновик из ваших решений — проверьте и поправьте.',
    },
    {
      field: 'strategyJson',
      reason: 'companyprofile.missing_strategy',
      question:
        'Какая у компании стратегия? Кора набросала черновик из ваших решений — проверьте и поправьте.',
    },
  ];

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CompanyProfileService)
    private readonly companyProfile: CompanyProfileService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(ProbeService)
    private readonly probeService?: ProbeService,
  ) {}

  @Cron('0 4 * * *')
  async run(): Promise<void> {
    if (!this.cfg.companyProfile.completenessProbeEnabled) {
      this.logger.debug(
        'company-profile-completeness.cron: выключен (companyProfile.completenessProbeEnabled=false)',
      );
      return;
    }
    if (!this.probeService) return;
    try {
      const orgs = await this.prisma.org.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      for (const org of orgs) {
        try {
          await this.scanOrg(org.id);
        } catch (err) {
          this.logger.warn(
            {
              tenantId: org.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'company-profile-completeness.cron: org пропущен (fail-open)',
          );
        }
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'company-profile-completeness.cron: непойманная ошибка',
      );
    }
  }

  private async scanOrg(tenantId: string): Promise<void> {
    const profile = await this.companyProfile.getRaw(tenantId);
    const gaps: ProfileGap[] = CompanyProfileCompletenessCron.GAPS.filter(
      (g) => isEmptyField(profile?.[g.field] ?? null),
    ).map((g) => ({ reason: g.reason, question: g.question }));
    if (gaps.length === 0) return;

    const ownerUserId = await this.resolveOwner(tenantId);
    if (!ownerUserId) return;

    const contextCardId = profile?.id ?? tenantId;
    for (const gap of gaps) {
      await this.emit({
        tenantId,
        reason: gap.reason,
        question: gap.question,
        recipientUserId: ownerUserId,
        contextCardId,
      });
    }
  }

  private async emit(args: {
    tenantId: string;
    reason: string;
    question: string;
    recipientUserId: string;
    contextCardId: string;
  }): Promise<void> {
    if (!this.probeService) return;
    await this.probeService.suggest({
      tenantId: args.tenantId,
      emittedByService: CompanyProfileCompletenessCron.EMITTED_BY,
      reason: args.reason,
      payload: {
        message: args.question,
        contextCardId: args.contextCardId,
        contextCardKind: 'company_profile',
        objectName: 'Компания',
        objectKindRu: 'профиль компании',
        actionUrl: '/company',
        dataClass: 'internal',
      },
      recipientCandidates: [args.recipientUserId],
      priorityHint: 0.4,
      dataClass: 'internal',
    });
    this.metrics.incCoreSpecialistProbeEvent({
      type: CompanyProfileCompletenessCron.EMITTED_BY,
      reason: args.reason,
    });
  }

  private async resolveOwner(tenantId: string): Promise<string | null> {
    const owner = await this.prisma.membership.findFirst({
      where: { orgId: tenantId, role: 'owner' },
      select: { userId: true },
    });
    return owner?.userId ?? null;
  }
}

function isEmptyField(json: unknown): boolean {
  if (json == null) return true;
  if (typeof json === 'object' && !Array.isArray(json)) {
    const v = (json as Record<string, unknown>).contentMd;
    return typeof v !== 'string' || v.trim().length === 0;
  }
  return true;
}
