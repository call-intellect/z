import { Inject, Injectable, Logger } from '@nestjs/common';
import { type SignalType } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ProbeService } from '../../probe/probe.service';

const SUBJECT_ROLE = 'subject';

const STALE_AGE_DAYS = 90;
const FRESH_AGE_DAYS = 30;

@Injectable()
export class TemporalProbeService {
  private readonly logger = new Logger(TemporalProbeService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ProbeService) private readonly probe: ProbeService,
  ) {}

  async runAllOrgs(): Promise<{
    scannedOrgs: number;
    probesEmitted: number;
    skippedDedup: number;
  }> {
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    let probesEmitted = 0;
    let skippedDedup = 0;
    for (const org of orgs) {
      try {
        const stats = await this.runForOrg(org.id);
        probesEmitted += stats.probesEmitted;
        skippedDedup += stats.skippedDedup;
      } catch (err) {
        this.logger.warn(
          {
            tenantId: org.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'temporal-probe: ошибка обработки Org (пропускаем)',
        );
      }
    }
    return { scannedOrgs: orgs.length, probesEmitted, skippedDedup };
  }

  async runForOrg(tenantId: string): Promise<{
    probesEmitted: number;
    skippedDedup: number;
  }> {
    const factTypes = this.cfg.bitemporal.factSignalTypes as SignalType[];
    if (!factTypes || factTypes.length === 0) {
      return { probesEmitted: 0, skippedDedup: 0 };
    }
    const limit = Math.max(0, this.cfg.temporalProbe.limitPerOrg);
    if (limit === 0) return { probesEmitted: 0, skippedDedup: 0 };

    const now = new Date();
    const staleCutoff = daysAgo(now, STALE_AGE_DAYS);
    const freshCutoff = daysAgo(now, FRESH_AGE_DAYS);

    const stale = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId,
        status: 'canonical',
        validUntil: null,
        validFrom: { lt: staleCutoff, not: null },
        signalType: { in: factTypes },
      },
      select: {
        id: true,
        name: true,
        trustedAnswer: true,
        signalType: true,
        validFrom: true,
        entities: {
          where: { role: SUBJECT_ROLE },
          select: { entityId: true },
        },
      },
      take: limit * 2,
    });

    let probesEmitted = 0;
    let skippedDedup = 0;
    const ownerCandidates = await this.findOwnerCandidates(tenantId);

    for (const staleBlock of stale) {
      if (probesEmitted >= limit) break;
      const subjectEntityIds = staleBlock.entities.map((e) => e.entityId);
      if (subjectEntityIds.length === 0) {
        continue;
      }

      const freshBlock = await this.prisma.ideaBlock.findFirst({
        where: {
          tenantId,
          status: 'canonical',
          signalType: staleBlock.signalType,
          validFrom: { gt: freshCutoff },
          id: { not: staleBlock.id },
          entities: {
            some: {
              role: SUBJECT_ROLE,
              entityId: { in: subjectEntityIds },
            },
          },
        },
        select: { id: true, name: true, trustedAnswer: true, validFrom: true },
        orderBy: { validFrom: 'desc' },
      });
      if (!freshBlock) continue;
      if (normalize(freshBlock.trustedAnswer) === normalize(staleBlock.trustedAnswer)) {
        continue;
      }

      const question = this.formulateQuestion({
        subject: staleBlock.name,
        oldAnswer: staleBlock.trustedAnswer,
        newAnswer: freshBlock.trustedAnswer,
      });
      const res = await this.probe.suggest({
        tenantId,
        emittedByService: 'temporal-probe',
        reason: 'temporal.fact_stale_contradiction',
        payload: {
          message: question,
          suggestedQuestion: question,
          contextBlockId: staleBlock.id,
          contextIds: [staleBlock.id, freshBlock.id],
          dataClass: 'internal',
        },
        recipientCandidates: ownerCandidates,
        priorityHint: 0.5,
      });
      if ('dropped' in res) {
        skippedDedup++;
      } else {
        probesEmitted++;
      }
    }
    return { probesEmitted, skippedDedup };
  }

  async escalateUnanswered(): Promise<{ escalated: number }> {
    const weeks = Math.max(1, this.cfg.temporalProbe.escalateAfterWeeks);
    const cutoff = daysAgo(new Date(), weeks * 7);
    const stuck = await this.prisma.probeEvent.findMany({
      where: {
        reason: 'temporal.fact_stale_contradiction',
        status: 'pending',
        createdAt: { lt: cutoff },
      },
      select: { id: true, tenantId: true, payload: true },
      take: 100,
    });
    let escalated = 0;
    for (const p of stuck) {
      try {
        const owner = await this.findOwner(p.tenantId);
        if (!owner) continue;
        const payload = (p.payload ?? {}) as Record<string, unknown>;
        const question = String(
          payload.suggestedQuestion ??
            payload.message ??
            'Пожалуйста, подтвердите актуальность факта.',
        );
        const res = await this.probe.suggest({
          tenantId: p.tenantId,
          emittedByService: 'temporal-probe-escalation',
          reason: 'temporal.fact_stale_contradiction.escalated',
          payload: {
            message: question,
            suggestedQuestion: question,
            originalProbeEventId: p.id,
            dataClass: 'internal',
          },
          recipientCandidates: [owner],
          priorityHint: 0.7,
        });
        if (!('dropped' in res)) escalated++;
      } catch (err) {
        this.logger.warn(
          {
            tenantId: p.tenantId,
            probeId: p.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'temporal-probe: эскалация упала (best-effort)',
        );
      }
    }
    return { escalated };
  }

  private async findOwnerCandidates(tenantId: string): Promise<string[]> {
    const memberships = await this.prisma.membership.findMany({
      where: {
        orgId: tenantId,
        role: { in: ['owner', 'admin'] },
      },
      select: { userId: true },
    });
    return memberships.map((m) => m.userId);
  }

  private async findOwner(tenantId: string): Promise<string | null> {
    const org = await this.prisma.org.findUnique({
      where: { id: tenantId },
      select: { ownerId: true },
    });
    return org?.ownerId ?? null;
  }

  private formulateQuestion(args: {
    subject: string;
    oldAnswer: string;
    newAnswer: string;
  }): string {
    const old = truncate(args.oldAnswer, 200);
    const fresh = truncate(args.newAnswer, 200);
    return `«${args.subject}» — раньше было: «${old}», сейчас: «${fresh}». Что верно?`;
  }
}

function daysAgo(now: Date, days: number): Date {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

function normalize(s: string): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
