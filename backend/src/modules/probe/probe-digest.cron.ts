import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { type DataClass } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConversationalService } from '../conversational/conversational.service';

import { PROBE_REASON_FALLBACK, PROBE_REASON_FALLBACK_DEFAULT } from './probe-reason-labels';
import { buildProbeDigestSummary, type ProbeDigestItem } from './prompts/probe-digest.prompt';

@Injectable()
export class ProbeDigestCron {
  private readonly logger = new Logger(ProbeDigestCron.name);
  private static readonly MAX_SCAN = 2_000;

  private static readonly DATACLASS_ORDER: Record<DataClass, number> = {
    public: 0,
    internal: 1,
    sensitive: 2,
    private: 3,
  };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 * * * *')
  async sweep(): Promise<void> {
    try {
      const enabled = await this.cfg.getDynamic<boolean>('probe.digestEnabled', undefined, true);
      if (!enabled) return;
      const hourUtc = await this.cfg.getDynamic<number>('probe.digestHourUtc', undefined, 9);
      if (new Date().getUTCHours() !== hourUtc) return;
      await this.collectAndSend();
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'probe-digest: ошибка прохода — пропускаю',
      );
    }
  }

  async collectAndSend(): Promise<void> {
    const touchCap = await this.cfg.getDynamic<number>('probe.digestTouchCap', undefined, 5);

    const queued = await this.prisma.probeEvent.findMany({
      where: {
        status: { in: ['queued_digest', 'routed_to_digest'] },
        OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: ProbeDigestCron.MAX_SCAN,
      select: {
        id: true,
        tenantId: true,
        reason: true,
        priority: true,
        selectedRecipientId: true,
        recipientCandidates: true,
        payload: true,
      },
    });
    if (queued.length === 0) return;

    type Row = (typeof queued)[number];
    const groups = new Map<string, { tenantId: string; recipientUserId: string; rows: Row[] }>();
    for (const row of queued) {
      const recipient = row.selectedRecipientId ?? row.recipientCandidates[0];
      if (!recipient) continue;
      const key = `${row.tenantId}::${recipient}`;
      const g = groups.get(key);
      if (g) {
        g.rows.push(row);
      } else {
        groups.set(key, {
          tenantId: row.tenantId,
          recipientUserId: recipient,
          rows: [row],
        });
      }
    }

    let sentDigests = 0;
    for (const group of groups.values()) {
      const chosen = group.rows.slice(0, Math.max(1, touchCap));
      const items: ProbeDigestItem[] = chosen.map((row) => ({
        question: this.deriveQuestion(row),
        objectTitle: this.contextTitle(row),
        probeEventId: row.id,
      }));
      const summary = buildProbeDigestSummary(items);
      const dataClass = this.maxDataClass(chosen);

      try {
        const notif = await this.conversational.sendNotification({
          tenantId: group.tenantId,
          recipientUserId: group.recipientUserId,
          eventType: 'probe.digest',
          payload: {
            items: items.map((it) => ({
              question: it.question,
              ...(it.objectTitle ? { objectTitle: it.objectTitle } : {}),
              probeEventId: it.probeEventId,
            })),
            total: group.rows.length,
            summary,
          },
          dataClass,
        });

        await this.prisma.probeEvent.updateMany({
          where: {
            id: { in: chosen.map((r) => r.id) },
            status: { in: ['queued_digest', 'routed_to_digest'] },
          },
          data: {
            status: 'dispatched',
            dispatchedAt: new Date(),
            selectedRecipientId: group.recipientUserId,
            dispatchedNotificationId: notif.id,
          },
        });
        for (const row of chosen) {
          this.metrics.incProbeEvent({
            emittedByService: 'probe-digest',
            reason: row.reason,
            status: 'dispatched',
          });
        }
        this.metrics.incProbeDispatched({ kind: 'digest' });
        sentDigests += 1;
      } catch (err) {
        this.logger.warn(
          {
            tenantId: group.tenantId,
            recipientUserId: group.recipientUserId,
            err: err instanceof Error ? err.message : String(err),
          },
          'probe-digest: sendNotification упал — оставляю queued_digest',
        );
      }
    }

    this.logger.debug(
      { digests: sentDigests, groups: groups.size },
      'probe-digest: проход завершён',
    );
  }

  private deriveQuestion(row: { reason: string; payload: unknown }): string {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const formulated = this.str(payload.formulatedQuestion);
    const suggested = this.str(payload.suggestedQuestion);
    return (
      formulated ?? suggested ?? PROBE_REASON_FALLBACK[row.reason] ?? PROBE_REASON_FALLBACK_DEFAULT
    );
  }

  private contextTitle(row: { payload: unknown }): string | undefined {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    return this.str(payload.contextCardTitle);
  }

  private maxDataClass(rows: Array<{ payload: unknown }>): DataClass {
    let max: DataClass = 'internal';
    for (const row of rows) {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      const dc = payload.dataClass;
      if (dc === 'public' || dc === 'internal' || dc === 'sensitive' || dc === 'private') {
        if (ProbeDigestCron.DATACLASS_ORDER[dc] > ProbeDigestCron.DATACLASS_ORDER[max]) {
          max = dc;
        }
      }
    }
    return max;
  }

  private str(v: unknown): string | undefined {
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  }
}
