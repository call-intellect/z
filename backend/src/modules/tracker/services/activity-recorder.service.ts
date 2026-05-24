import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * Параметры записи строки IssueActivity. `epoch` подставляется сервисом
 * автоматически (микросекунды UNIX-времени). `metadata` — произвольный
 * JSON-контекст события (например, кто упомянут или какой webhook сработал).
 */
export interface RecordActivityParams {
  tenantId: string;
  issueId: string;
  /** ID пользователя, инициировавшего изменение. Null — если actor = AI/system. */
  actorUserId?: string | null;
  actorType: 'user' | 'ai_agent' | 'system';
  agentName?: string | null;
  verb: string;
  field?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: Record<string, unknown> | null;
  /**
   * Опционально: транзакционный клиент. Передаётся при многомутационных
   * операциях, чтобы IssueActivity создавалась внутри той же транзакции.
   */
  tx?: Prisma.TransactionClient;
}

/**
 * ActivityRecorderService — централизованная запись audit-trail задач в
 * `IssueActivity`. Все мутации (create / update / delete / status_changed /
 * commented / assigned / linked / ...) должны вызывать `record(...)`, чтобы
 * формировался корректный feed активности и материал для второго мозга.
 *
 * Доступен (через TrackerModule providers): всем сервисам трекера. Снаружи
 * модуля — через export TrackerModule.
 */
@Injectable()
export class ActivityRecorderService {
  private readonly logger = new Logger(ActivityRecorderService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Записать одну строку IssueActivity. Возвращает ID созданной записи. */
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

  /** Удобный helper: записать несколько строк подряд (одна транзакция). */
  async recordMany(rows: RecordActivityParams[]): Promise<number> {
    if (rows.length === 0) return 0;
    // Если передан tx во всех — используем его; иначе одна общая транзакция.
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

  /** Микросекунды UNIX-времени (BigInt). Достаточно для строгой сортировки. */
  private nowEpoch(): bigint {
    return BigInt(Date.now()) * 1_000n;
  }

  private toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (value === undefined || value === null) return Prisma.JsonNull;
    // Гарантируем JSON-сериализуемость: BigInt / функции выкинут — что и нужно.
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
