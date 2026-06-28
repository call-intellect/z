import { Inject, Injectable, Logger } from '@nestjs/common';

import { MessageBridgeService } from './message-bridge.service';

export interface TelegramExportMessage {
  id?: unknown;
  type?: unknown;
  date?: unknown;
  date_unixtime?: unknown;
  from?: unknown;
  from_id?: unknown;
  text?: unknown;
}

export interface TelegramExport {
  name?: unknown;
  type?: unknown;
  id?: unknown;
  messages?: unknown;
}

export interface TelegramImportResult {
  imported: number;
  skipped: number;
}

export function extractPlainText(text: unknown): string {
  if (typeof text === 'string') return text;
  if (Array.isArray(text)) {
    return text
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const t = (part as { text?: unknown }).text;
          return typeof t === 'string' ? t : '';
        }
        return '';
      })
      .join('');
  }
  return '';
}

export function parseDate(m: TelegramExportMessage): Date | null {
  if (typeof m.date_unixtime === 'string' || typeof m.date_unixtime === 'number') {
    const sec = Number(m.date_unixtime);
    if (Number.isFinite(sec) && sec > 0) return new Date(sec * 1000);
  }
  if (typeof m.date === 'string' && m.date.trim().length > 0) {
    const d = new Date(m.date);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

@Injectable()
export class TelegramExportImportService {
  private readonly logger = new Logger(TelegramExportImportService.name);

  constructor(@Inject(MessageBridgeService) private readonly bridge: MessageBridgeService) {}

  async importTelegramExport(
    tenantId: string,
    exportJson: unknown,
  ): Promise<TelegramImportResult> {
    if (typeof exportJson !== 'object' || exportJson === null) {
      throw new Error('Telegram-export: ожидается JSON-объект result.json');
    }
    const exp = exportJson as TelegramExport;
    const messages = Array.isArray(exp.messages) ? (exp.messages as TelegramExportMessage[]) : [];

    const chatId = String(exp.id ?? exp.name ?? 'unknown');
    const threadTitle = typeof exp.name === 'string' ? exp.name : null;

    let imported = 0;
    let skipped = 0;

    for (const m of messages) {
      if (m?.type !== 'message') {
        skipped += 1;
        continue;
      }
      const text = extractPlainText(m.text).trim();
      const occurredAt = parseDate(m);
      if (text.length === 0 || occurredAt === null || m.id == null) {
        skipped += 1;
        continue;
      }

      const result = await this.bridge.ingestChatMessage({
        tenantId,
        channel: 'telegram_export',
        threadExternalId: chatId,
        threadTitle,
        messageExternalId: String(m.id),
        externalAuthorId: m.from_id != null ? String(m.from_id) : null,
        authorName: typeof m.from === 'string' ? m.from : null,
        text,
        occurredAt,
      });

      if ('skipped' in result) skipped += 1;
      else if (result.idempotent) skipped += 1;
      else imported += 1;
    }

    this.logger.log(
      `importTelegramExport tenantId=${tenantId} chatId=${chatId} imported=${imported} skipped=${skipped}`,
    );
    return { imported, skipped };
  }
}
