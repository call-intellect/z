import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  Event,
  EventParticipant,
  EventReminder,
  Issue,
  Project,
} from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

import { EventsService } from './events.service';

/**
 * IcsFeedService — генерация iCalendar 2.0 (RFC 5545) feed'а для одного
 * пользователя по его персональному токену (`User.calendarFeedToken`).
 *
 * Используется публичным контроллером `IcsFeedController`
 * (`GET /api/v1/calendar/:userId.ics?token=...`).
 *
 * Окно по умолчанию: `[now - 30 дней, now + 90 дней]`. Окно сделано
 * параметризованным, чтобы тесты могли подменить точные границы.
 */
@Injectable()
export class IcsFeedService {
  private readonly logger = new Logger(IcsFeedService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  /**
   * Проверяет токен и возвращает iCalendar строку с CRLF-разделителями.
   * Если user не найден или токен невалиден — возвращает `null` (контроллер
   * вернёт 404, не палим существование пользователя).
   */
  async buildFeed(args: {
    userId: string;
    token: string;
    now?: Date;
  }): Promise<string | null> {
    const { userId, token } = args;
    const now = args.now ?? new Date();

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, calendarFeedToken: true },
    });
    if (!user || !user.calendarFeedToken || user.calendarFeedToken !== token) {
      return null;
    }

    const from = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
    const to = new Date(now.getTime() + 90 * 24 * 60 * 60_000);

    const { events, issues } = await this.events.getEventsForFeed({
      userId,
      from,
      to,
    });

    return this.serialize({ events, issues, now });
  }

  /**
   * Сериализация в iCalendar 2.0. Производит выходную строку с CRLF (`\r\n`)
   * между строками, включая обязательный CRLF в конце.
   *
   * Экранирование SUMMARY/DESCRIPTION/LOCATION:
   *  - `\\` → `\\\\`
   *  - `;`  → `\\;`
   *  - `,`  → `\\,`
   *  - `\n` (любой EOL) → литерал `\\n`
   *
   * Folding: строки > 75 октетов в UTF-8 переносятся `\r\n ` (CRLF + space).
   */
  serialize(args: {
    events: (Event & {
      participants: EventParticipant[];
      reminders: EventReminder[];
    })[];
    issues: (Issue & { project: Project | null })[];
    now?: Date;
  }): string {
    const now = args.now ?? new Date();
    const dtstamp = this.formatUtc(now);

    const lines: string[] = [];
    lines.push('BEGIN:VCALENDAR');
    lines.push('VERSION:2.0');
    lines.push('PRODID:-//Kora//Calendar MVP//RU');
    lines.push('CALSCALE:GREGORIAN');
    lines.push('METHOD:PUBLISH');
    lines.push('X-WR-CALNAME:Kora — мои события');
    lines.push('X-WR-TIMEZONE:Europe/Moscow');

    for (const e of args.events) {
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:event-${e.id}@kora.app`);
      lines.push(`DTSTAMP:${dtstamp}`);
      lines.push(`DTSTART:${this.formatUtc(e.startAt)}`);
      const end =
        e.endAt ??
        new Date(
          e.startAt.getTime() + Math.max(15, e.durationMin ?? 30) * 60_000,
        );
      lines.push(`DTEND:${this.formatUtc(end)}`);
      lines.push(`SUMMARY:${this.escapeText(e.title)}`);
      if (e.description && e.description.trim().length > 0) {
        lines.push(`DESCRIPTION:${this.escapeText(e.description)}`);
      }
      if (e.location && e.location.trim().length > 0) {
        lines.push(`LOCATION:${this.escapeText(e.location)}`);
      }
      lines.push(`STATUS:${this.mapStatus(e.status)}`);
      lines.push('END:VEVENT');
    }

    for (const i of args.issues) {
      if (!i.dueDate) continue;
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:issue-${i.id}@kora.app`);
      lines.push(`DTSTAMP:${dtstamp}`);
      lines.push(`DTSTART:${this.formatUtc(i.dueDate)}`);
      // Issue.dueDate — это точка во времени, не интервал. Делаем "точку" 15 мин
      // и помечаем TRANSP:TRANSPARENT (не блокирует время в внешнем календаре).
      const issueEnd = new Date(i.dueDate.getTime() + 15 * 60_000);
      lines.push(`DTEND:${this.formatUtc(issueEnd)}`);
      const projectPrefix = i.project?.name ? `[${i.project.name}] ` : '';
      lines.push(`SUMMARY:${this.escapeText(`${projectPrefix}${i.title}`)}`);
      lines.push('STATUS:CONFIRMED');
      lines.push('TRANSP:TRANSPARENT');
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');

    // Применяем folding к каждой строке и склеиваем CRLF.
    const folded = lines.map((l) => this.foldLine(l));
    return folded.join('\r\n') + '\r\n';
  }

  // ─────────────────────────── helpers ─────────────────────────────────

  private mapStatus(s: string): 'TENTATIVE' | 'CONFIRMED' | 'CANCELLED' {
    switch (s) {
      case 'tentative':
        return 'TENTATIVE';
      case 'cancelled':
        return 'CANCELLED';
      default:
        return 'CONFIRMED';
    }
  }

  /** UTC формат RFC-5545: `YYYYMMDDTHHmmssZ`. */
  private formatUtc(d: Date): string {
    const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
    const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
    const dd = d.getUTCDate().toString().padStart(2, '0');
    const hh = d.getUTCHours().toString().padStart(2, '0');
    const mi = d.getUTCMinutes().toString().padStart(2, '0');
    const ss = d.getUTCSeconds().toString().padStart(2, '0');
    return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
  }

  /**
   * Escape SUMMARY/DESCRIPTION/LOCATION по RFC 5545 §3.3.11:
   *  - `\` → `\\`
   *  - `;` → `\;`
   *  - `,` → `\,`
   *  - любая комбинация CR/LF → литерал `\n`
   */
  private escapeText(s: string): string {
    return s
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r\n|\r|\n/g, '\\n');
  }

  /**
   * Folding по RFC 5545 §3.1: строки длиннее 75 октетов разбиваются на части,
   * каждая следующая часть начинается с пробела. Работаем по байтам UTF-8.
   */
  private foldLine(line: string): string {
    const bytes = Buffer.from(line, 'utf8');
    if (bytes.length <= 75) return line;

    const out: string[] = [];
    let offset = 0;
    let isFirst = true;
    while (offset < bytes.length) {
      const limit = isFirst ? 75 : 74; // 75 байт; для продолжений 1 байт под " "
      // Находим безопасную границу UTF-8 — не разрезаем посередине символа.
      let end = Math.min(offset + limit, bytes.length);
      while (end > offset && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) {
        end--;
      }
      const chunk = bytes.subarray(offset, end).toString('utf8');
      out.push(isFirst ? chunk : ' ' + chunk);
      offset = end;
      isFirst = false;
    }
    return out.join('\r\n');
  }
}
