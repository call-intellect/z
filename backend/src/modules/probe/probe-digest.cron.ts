import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { type DataClass, type ProbeEvent } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConversationalService } from '../conversational/conversational.service';

import { ProbeFormulationService } from './probe-formulation.service';
import { PROBE_REASON_FALLBACK, PROBE_REASON_FALLBACK_DEFAULT } from './probe-reason-labels';
import { deriveDigestQuestion } from './probe-text.util';
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
    @Inject(ProbeFormulationService)
    private readonly formulation: ProbeFormulationService,
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
    let formulateEnabled: boolean;
    try {
      formulateEnabled = await this.cfg.getDynamic<boolean>(
        'probe.digestFormulateEnabled',
        undefined,
        true,
      );
    } catch {
      formulateEnabled = true;
    }

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
      const candidateRows = group.rows.slice(0, Math.max(1, touchCap));

      const surviving: Array<{ row: Row; item: ProbeDigestItem }> = [];
      for (const row of candidateRows) {
        const built = await this.buildItem(row, formulateEnabled);
        if (built) surviving.push({ row, item: built });
      }
      if (surviving.length === 0) continue;

      const survivingRows = surviving.map((s) => s.row);
      const items = surviving.map((s) => s.item);
      const summary = buildProbeDigestSummary(items);
      const dataClass = this.maxDataClass(survivingRows);

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
            id: { in: survivingRows.map((r) => r.id) },
            status: { in: ['queued_digest', 'routed_to_digest'] },
          },
          data: {
            status: 'dispatched',
            dispatchedAt: new Date(),
            selectedRecipientId: group.recipientUserId,
            dispatchedNotificationId: notif.id,
          },
        });
        for (const row of survivingRows) {
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
    return deriveDigestQuestion(
      row.reason,
      payload,
      PROBE_REASON_FALLBACK,
      PROBE_REASON_FALLBACK_DEFAULT,
    );
  }

  private async buildItem(
    row: {
      id: string;
      reason: string;
      payload: unknown;
    },
    formulateEnabled: boolean,
  ): Promise<ProbeDigestItem | null> {
    const objectTitle = this.contextTitle(row);
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const alreadyFormulated =
      typeof payload.formulatedQuestion === 'string' &&
      payload.formulatedQuestion.length > 0;

    if (!formulateEnabled || alreadyFormulated) {
      return {
        question: this.deriveQuestion(row),
        objectTitle,
        probeEventId: row.id,
      };
    }

    const probe = row as unknown as ProbeEvent;
    try {
      const verdict = await this.formulation.gate(probe);
      if (verdict.ask === false) {
        await this.prisma.probeEvent.update({
          where: { id: row.id },
          data: { status: 'dropped_low_value' },
        });
        this.metrics.incProbeValueGate({ verdict: 'skip' });
        this.metrics.incProbeEvent({
          emittedByService: 'probe-digest',
          reason: row.reason,
          status: 'dropped_low_value',
        });
        return null;
      }
      this.metrics.incProbeValueGate({ verdict: 'ask' });

      const formulated = await this.formulation.formulate(probe);
      const question = await this.formulation.judgeQuality(
        probe,
        formulated.question,
      );

      await this.prisma.probeEvent.update({
        where: { id: row.id },
        data: { payload: { ...payload, formulatedQuestion: question } },
      });

      return {
        question,
        objectTitle,
        probeEventId: row.id,
      };
    } catch (err) {
      this.logger.warn(
        {
          probeEventId: row.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'probe-digest: формулировка через LLM упала — детерминированный фолбэк (best-effort)',
      );
      return {
        question: this.deriveQuestion(row),
        objectTitle,
        probeEventId: row.id,
      };
    }
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
