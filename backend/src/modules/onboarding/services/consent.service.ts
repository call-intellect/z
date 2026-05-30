import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * Pulse Wave 4 §4.1 — журнал согласий 152-ФЗ. Append-only лог `ConsentLog`
 * + денормализованное «полное согласие» в `Person.analyticsOptIn`.
 *
 * Логика «полного согласия» (`analyticsOptIn = true`):
 *   - `checkin_processing` = true (последняя запись)
 *   - `risk_analysis`      = true (последняя запись)
 *
 * `card_visible_to_manager` отдельный — отказ от него НЕ выключает
 * аналитику, только скрывает карточку у руководителя.
 *
 * Endpoint'ы — `OnboardingController` (POST/GET `/api/v1/me/consents`).
 */
@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Записывает событие согласия / отзыва. Идёт в `ConsentLog` (append-only).
   * Если `dataType ∈ {checkin_processing, risk_analysis}` — пересчитывает
   * флаг `Person.analyticsOptIn` по последним записям этих двух типов.
   */
  async recordConsent(args: {
    tenantId: string;
    personId: string;
    dataType: ConsentDataType;
    consented: boolean;
    policyVersion?: string;
    ipHash?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.prisma.consentLog.create({
      data: {
        tenantId: args.tenantId,
        personId: args.personId,
        dataType: args.dataType,
        consented: args.consented,
        policyVersion: args.policyVersion ?? 'v1',
        ipHash: args.ipHash ?? null,
        userAgent: args.userAgent ?? null,
      },
    });

    if (args.dataType === 'checkin_processing' || args.dataType === 'risk_analysis') {
      await this.recomputeAnalyticsOptIn({
        tenantId: args.tenantId,
        personId: args.personId,
      });
    }
  }

  /**
   * Возвращает текущее состояние согласий по каждому типу — последняя
   * запись `ConsentLog` per `dataType` для пары (tenantId, personId).
   */
  async getActiveConsents(args: {
    tenantId: string;
    personId: string;
  }): Promise<ConsentRecordDto[]> {
    const logs = await this.prisma.consentLog.findMany({
      where: { tenantId: args.tenantId, personId: args.personId },
      orderBy: { createdAt: 'desc' },
    });
    const latestByType = new Map<string, (typeof logs)[number]>();
    for (const l of logs) {
      if (!latestByType.has(l.dataType)) latestByType.set(l.dataType, l);
    }
    return Array.from(latestByType.values()).map((l) => ({
      id: l.id,
      dataType: l.dataType,
      consented: l.consented,
      policyVersion: l.policyVersion,
      createdAt: l.createdAt.toISOString(),
    }));
  }

  private async recomputeAnalyticsOptIn(args: {
    tenantId: string;
    personId: string;
  }): Promise<void> {
    const logs = await this.prisma.consentLog.findMany({
      where: {
        tenantId: args.tenantId,
        personId: args.personId,
        dataType: { in: ['checkin_processing', 'risk_analysis'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const latestByType = new Map<string, boolean>();
    for (const c of logs) {
      if (!latestByType.has(c.dataType)) latestByType.set(c.dataType, c.consented);
    }
    const allConsented =
      latestByType.get('checkin_processing') === true &&
      latestByType.get('risk_analysis') === true;

    try {
      await this.prisma.person.update({
        where: { id: args.personId },
        data: {
          analyticsOptIn: allConsented,
          analyticsOptInAt: allConsented ? new Date() : null,
        },
      });
    } catch (err) {
      // Person мог быть удалён между findMany и update — это не критично
      // для аудита: ConsentLog уже записан.
      this.logger.warn(
        `recomputeAnalyticsOptIn: не удалось обновить Person ${args.personId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

export interface ConsentRecordDto {
  id: string;
  dataType: string;
  consented: boolean;
  policyVersion: string;
  createdAt: string;
}

const KNOWN_DATA_TYPES = [
  'checkin_processing',
  'risk_analysis',
  'card_visible_to_manager',
] as const;
export type ConsentDataType = (typeof KNOWN_DATA_TYPES)[number];

export const CONSENT_DATA_TYPES: readonly ConsentDataType[] = KNOWN_DATA_TYPES;
