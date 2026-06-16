import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

export interface RecordActivityParams {
  tenantId: string;
  issueId: string;
  actorUserId?: string | null;
  actorType: 'user' | 'ai_agent' | 'system';
  agentName?: string | null;
  verb: string;
  field?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: Record<string, unknown> | null;
  tx?: Prisma.TransactionClient;
}

@Injectable()
export class ActivityRecorderService {
  private readonly logger = new Logger(ActivityRecorderService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(params: RecordActivityParams): Promise<string> {
    const client: Prisma.TransactionClient | PrismaService = params.tx ?? this.prisma;
    const epoch = this.nowEpoch();
    const created = await client.issueActivity.create({
      data: {
        tenantId: params.tenantId,
        issueId: params.issueId,
        actorUserId: params.actorUserId ?? null,
        actorType: params.actorType,
        agentName: params.agentName ?? null,
        verb: params.verb,
        field: params.field ?? null,
        oldValue: this.toJson(params.oldValue),
        newValue: this.toJson(params.newValue),
        metadata: this.toJson(params.metadata),
        epoch,
      },
      select: { id: true },
    });
    return created.id;
  }

  async recordMany(rows: RecordActivityParams[]): Promise<number> {
    if (rows.length === 0) return 0;
    const tx = rows[0]?.tx;
    if (tx) {
      for (const r of rows) await this.record({ ...r, tx });
      return rows.length;
    }
    await this.prisma.$transaction(async (innerTx) => {
      for (const r of rows) await this.record({ ...r, tx: innerTx });
    });
    return rows.length;
  }

  private nowEpoch(): bigint {
    return BigInt(Date.now()) * 1_000n;
  }

  private toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (value === undefined || value === null) return Prisma.JsonNull;
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
