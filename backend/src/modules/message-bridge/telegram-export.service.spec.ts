import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessageBridgeService } from './message-bridge.service';
import {
  extractPlainText,
  parseDate,
  TelegramExportImportService,
} from './telegram-export.service';

const GOLDEN_EXPORT = {
  name: 'Команда продаж',
  type: 'private_supergroup',
  id: 123456,
  messages: [
    {
      id: 1,
      type: 'service',
      date: '2026-06-01T09:00:00',
      date_unixtime: '1780300800',
      text: '',
    },
    {
      id: 2,
      type: 'message',
      date: '2026-06-01T10:00:00',
      date_unixtime: '1780304400',
      from: 'Иван',
      from_id: 'user101',
      text: 'Привет, как дела с клиентом?',
    },
    {
      id: 3,
      type: 'message',
      date: '2026-06-01T10:05:00',
      from: 'Пётр',
      from_id: 202,
      text: ['Смотри ', { type: 'link', text: 'https://crm/deal/7' }, ' — сделка на финале'],
    },
    {
      id: 4,
      type: 'message',
      date: '2026-06-01T10:06:00',
      from: 'Иван',
      from_id: 'user101',
      text: '',
    },
  ],
};

function makeImporter() {
  const ingestChatMessage = vi
    .fn()
    .mockResolvedValue({ rawEvent: { id: 'raw-1' }, idempotent: false });
  const bridge = { ingestChatMessage } as unknown as MessageBridgeService;
  const importer = new TelegramExportImportService(bridge);
  return { importer, bridge, ingestChatMessage };
}

describe('extractPlainText', () => {
  it('строка → как есть', () => {
    expect(extractPlainText('hello')).toBe('hello');
  });
  it('массив строк+сущностей → конкатенация .text', () => {
    expect(extractPlainText(['a ', { type: 'bold', text: 'b' }, ' c'])).toBe('a b c');
  });
  it('не строка/не массив → пусто', () => {
    expect(extractPlainText(undefined)).toBe('');
    expect(extractPlainText(42)).toBe('');
  });
});

describe('parseDate', () => {
  it('date_unixtime приоритетнее date', () => {
    const d = parseDate({ date: '2000-01-01T00:00:00', date_unixtime: '1780304400' });
    expect(d?.getTime()).toBe(1780304400 * 1000);
  });
  it('fallback на date если unixtime нет', () => {
    const d = parseDate({ date: '2026-06-01T10:00:00' });
    expect(d).not.toBeNull();
  });
  it('нет валидной даты → null', () => {
    expect(parseDate({})).toBeNull();
    expect(parseDate({ date: 'не дата' })).toBeNull();
  });
});

describe('TelegramExportImportService.importTelegramExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('golden-фикстура → imported=2, skipped=2 (service + пустое), text-as-array собран', async () => {
    const { importer, ingestChatMessage } = makeImporter();

    const result = await importer.importTelegramExport('org-1', GOLDEN_EXPORT);

    expect(result).toEqual({ imported: 2, skipped: 2 });
    expect(ingestChatMessage).toHaveBeenCalledTimes(2);

    const first = ingestChatMessage.mock.calls[0]![0] as Record<string, unknown>;
    expect(first).toMatchObject({
      tenantId: 'org-1',
      channel: 'telegram_export',
      threadExternalId: '123456',
      threadTitle: 'Команда продаж',
      messageExternalId: '2',
      externalAuthorId: 'user101',
      authorName: 'Иван',
      text: 'Привет, как дела с клиентом?',
    });

    const second = ingestChatMessage.mock.calls[1]![0] as Record<string, unknown>;
    expect(second.text).toBe('Смотри https://crm/deal/7 — сделка на финале');
    expect(second.externalAuthorId).toBe('202');
    expect(second.messageExternalId).toBe('3');
  });

  it('повторный импорт того же экспорта → 0 новых (bridge возвращает idempotent)', async () => {
    const { importer, ingestChatMessage } = makeImporter();
    ingestChatMessage.mockResolvedValue({ rawEvent: { id: 'raw-1' }, idempotent: true });

    const result = await importer.importTelegramExport('org-1', GOLDEN_EXPORT);

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(4);
  });

  it('skipped:true от bridge тоже считается skipped', async () => {
    const { importer, ingestChatMessage } = makeImporter();
    ingestChatMessage.mockResolvedValue({ skipped: true });

    const result = await importer.importTelegramExport('org-1', GOLDEN_EXPORT);

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(4);
  });

  it('не-объект → ошибка', async () => {
    const { importer } = makeImporter();
    await expect(importer.importTelegramExport('org-1', null)).rejects.toThrow();
  });

  it('chatId fallback на name если нет id', async () => {
    const { importer, ingestChatMessage } = makeImporter();
    await importer.importTelegramExport('org-1', {
      name: 'Безымянный',
      messages: [{ id: 1, type: 'message', date: '2026-06-01T10:00:00', text: 'hi' }],
    });
    const call = ingestChatMessage.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.threadExternalId).toBe('Безымянный');
  });
});
