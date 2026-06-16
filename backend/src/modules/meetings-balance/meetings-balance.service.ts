import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../common/config';
import { PrismaService } from '../../common/prisma/prisma.service';

const DEFAULT_BASE_MEETINGS_GRANT = 150;
const DEFAULT_PER_EXTRA_SEAT_MEETINGS_GRANT = 5;

export interface MeetingsBalanceView {
  balance: number;
  totalGranted: number;
  totalConsumed: number;
  lastGrantedAt: Date | null;
}

@Injectable()
export class MeetingsBalanceService {
  private readonly logger = new Logger(MeetingsBalanceService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async getBaseMeetingsGrant(): Promise<number> {
    return this.cfg.getDynamic<number>(
      'billing.baseMeetingsGrant',
      undefined,
      DEFAULT_BASE_MEETINGS_GRANT,
    );
  }

  async getPerExtraSeatMeetingsGrant(): Promise<number> {
    return this.cfg.getDynamic<number>(
      'billing.perExtraSeatMeetingsGrant',
      undefined,
      DEFAULT_PER_EXTRA_SEAT_MEETINGS_GRANT,
    );
  }

  async calculateMeetingsGrant(seatsExtra: number): Promise<number> {
    const [base, perSeat] = await Promise.all([
      this.getBaseMeetingsGrant(),
      this.getPerExtraSeatMeetingsGrant(),
    ]);
    return base + Math.max(0, seatsExtra) * perSeat;
  }

  async getBalance(tenantId: string): Promise<MeetingsBalanceView> {
    const row = await this.prisma.meetingsBalance.findUnique({
      where: { tenantId },
    });
    if (!row) {
      return { balance: 0, totalGranted: 0, totalConsumed: 0, lastGrantedAt: null };
    }
    return {
      balance: row.balance,
      totalGranted: row.totalGranted,
      totalConsumed: row.totalConsumed,
      lastGrantedAt: row.lastGrantedAt,
    };
  }

  async grant(tenantId: string, amount: number): Promise<void> {
    if (amount <= 0) return;
    await this.prisma.meetingsBalance.upsert({
      where: { tenantId },
      create: {
        tenantId,
        balance: amount,
        totalGranted: amount,
        lastGrantedAt: new Date(),
      },
      update: {
        balance: { increment: amount },
        totalGranted: { increment: amount },
        lastGrantedAt: new Date(),
      },
    });
    this.logger.log(`Granted ${amount} meetings to org=${tenantId}`);
  }

  async consume(tenantId: string, amount = 1): Promise<void> {
    if (amount <= 0) return;
    const { count: affected } = await this.prisma.meetingsBalance.updateMany({
      where: { tenantId, balance: { gte: amount } },
      data: {
        balance: { decrement: amount },
        totalConsumed: { increment: amount },
      },
    });
    if (affected === 0) {
      this.logger.warn(
        `MeetingsBalance.consume: недостаточно баланса для org=${tenantId} (нужно ${amount})`,
      );
      throw new ForbiddenException(
        'Закончились встречи в текущем балансе. Доплатите тариф или дождитесь продления подписки.',
      );
    }
  }
}
