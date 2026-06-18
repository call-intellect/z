import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type BillingEventLog, type BillingProviderName } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

export interface LogEventInput {
  eventType: string;
  tenantId?: string | null;
  subscriptionId?: string | null;
  invoiceId?: string | null;
  providerName?: BillingProviderName | null;
  externalEventId?: string | null;
  jti?: string | null;
  payload: Prisma.InputJsonValue;
  markProcessed?: boolean;
  tx?: Prisma.TransactionClient;
}

@Injectable()
export class BillingEventService {
  private readonly logger = new Logger(BillingEventService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async log(input: LogEventInput): Promise<{ event: BillingEventLog; duplicate: boolean }> {
    const runner = input.tx ?? this.prisma;

    try {
      const event = await runner.billingEventLog.create({
        data: {
          eventType: input.eventType,
          tenantId: input.tenantId ?? null,
          subscriptionId: input.subscriptionId ?? null,
          invoiceId: input.invoiceId ?? null,
          providerName: input.providerName ?? null,
          externalEventId: input.externalEventId ?? null,
          jti: input.jti ?? null,
          payload: input.payload,
          status: input.markProcessed ? 'processed' : 'received',
          processedAt: input.markProcessed ? new Date() : null,
        },
      });
      return { event, duplicate: false };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const lookup = input.jti
          ? { jti: input.jti }
          : input.externalEventId
            ? {
                externalEventId: input.externalEventId,
                providerName: input.providerName ?? undefined,
              }
            : null;
        if (lookup) {
          const existing = await runner.billingEventLog.findFirst({
            where: lookup,
            orderBy: { createdAt: 'desc' },
          });
          if (existing) {
            this.logger.warn(
              `Webhook duplicate detected (jti=${input.jti ?? '-'}, externalEventId=${input.externalEventId ?? '-'}) — skip`,
            );
            return { event: existing, duplicate: true };
          }
        }
      }
      throw err;
    }
  }

  async markProcessed(eventId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const runner = tx ?? this.prisma;
    await runner.billingEventLog.update({
      where: { id: eventId },
      data: { status: 'processed', processedAt: new Date() },
    });
  }

  async markFailed(eventId: string, error: unknown, tx?: Prisma.TransactionClient): Promise<void> {
    const runner = tx ?? this.prisma;
    const errorMessage = error instanceof Error ? error.message : String(error);
    await runner.billingEventLog.update({
      where: { id: eventId },
      data: { status: 'failed', payload: { error: errorMessage } },
    });
  }
}
