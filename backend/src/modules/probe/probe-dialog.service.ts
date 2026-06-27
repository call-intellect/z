import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ProbeDialogPhase, ProbeDialogState } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class ProbeDialogService {
  private readonly logger = new Logger(ProbeDialogService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async ensureState(args: {
    tenantId: string;
    probeEventId: string;
    recipientUserId: string;
  }): Promise<ProbeDialogState> {
    return this.prisma.probeDialogState.upsert({
      where: { probeEventId: args.probeEventId },
      create: {
        tenantId: args.tenantId,
        probeEventId: args.probeEventId,
        recipientUserId: args.recipientUserId,
        phase: 'awaiting_answer',
      },
      update: {},
    });
  }

  async getActive(args: {
    tenantId: string;
    probeEventId: string;
  }): Promise<ProbeDialogState | null> {
    return this.prisma.probeDialogState.findFirst({
      where: {
        tenantId: args.tenantId,
        probeEventId: args.probeEventId,
        phase: { not: 'resolved' },
      },
    });
  }

  async recordTurn(args: {
    probeEventId: string;
    outcome?: string | null;
    collectedValue?: string | null;
    confidence?: number | null;
  }): Promise<ProbeDialogState> {
    return this.prisma.probeDialogState.update({
      where: { probeEventId: args.probeEventId },
      data: {
        ...(args.outcome !== undefined ? { outcome: args.outcome } : {}),
        ...(args.collectedValue !== undefined
          ? { collectedValue: args.collectedValue }
          : {}),
        ...(args.confidence !== undefined ? { confidence: args.confidence } : {}),
        turnCount: { increment: 1 },
      },
    });
  }

  async setPhase(args: {
    probeEventId: string;
    phase: ProbeDialogPhase;
  }): Promise<void> {
    await this.prisma.probeDialogState.update({
      where: { probeEventId: args.probeEventId },
      data: { phase: args.phase },
    });
  }

  async finalizeIfPending(probeEventId: string): Promise<boolean> {
    const res = await this.prisma.probeDialogState.updateMany({
      where: {
        probeEventId,
        phase: { in: ['awaiting_answer', 'awaiting_clarification', 'awaiting_confirmation'] },
      },
      data: { phase: 'resolved' },
    });
    return res.count === 1;
  }
}
