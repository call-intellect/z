import { Injectable } from '@nestjs/common';
import type {
  AiResult,
  Meeting,
  MeetingChapter,
  Transcript,
} from '@prisma/client';

import { pickPrimarySummary } from '../../ai/utils/pick-primary-summary';

/**
 * Минимальная форма задачи для рендера (ТЗ Ф5.2): берём только используемые
 * поля, чтобы подходили и Prisma `Task`, и нормализованный `MeetingActionItem`.
 */
export interface ExportTaskLike {
  title: string;
  assigneeRaw: string | null;
  dueDate: Date | null;
}

/**
 * Генератор Markdown-экспорта одной встречи. Без I/O — pure-функция.
 */
@Injectable()
export class MdGenerator {
  build(input: {
    meeting: Meeting;
    aiResult: AiResult | null;
    chapters: MeetingChapter[];
    tasks: ReadonlyArray<ExportTaskLike>;
    transcript?: Transcript | null;
  }): string {
    const lines: string[] = [];
    lines.push(`# ${input.meeting.title}`);
    lines.push('');
    lines.push(`- **Тип:** ${input.meeting.type}`);
    lines.push(`- **Дата:** ${input.meeting.startedAt?.toISOString() ?? '—'}`);
    lines.push(`- **Длительность:** ${formatDuration(input.meeting.durationMs)}`);
    lines.push('');

    const summary = input.aiResult ? pickPrimarySummary(input.aiResult) : '';
    if (summary) {
      lines.push('## Summary', '', summary, '');
    }

    if (input.chapters.length > 0) {
      lines.push('## Главы', '');
      for (const c of input.chapters) {
        lines.push(`- **[${formatMmSs(c.startMs)}]** ${c.title}`);
      }
      lines.push('');
    }

    if (input.tasks.length > 0) {
      lines.push('## Задачи', '');
      for (const t of input.tasks) {
        const due = t.dueDate ? ` _(до ${t.dueDate.toISOString().slice(0, 10)})_` : '';
        const assignee = t.assigneeRaw ? ` — ${t.assigneeRaw}` : '';
        lines.push(`- [ ] ${t.title}${assignee}${due}`);
      }
      lines.push('');
    }

    if (input.transcript) {
      lines.push('## Транскрипт', '');
      lines.push('_(см. отдельный JSON-файл для полного транскрипта)_');
      lines.push('');
    }

    lines.push('---', `_Сгенерировано Z в ${new Date().toISOString()}_`);
    return lines.join('\n');
  }
}

function formatDuration(ms: number | null | undefined): string {
  if (!ms) return '—';
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function formatMmSs(ms: number): string {
  const t = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
