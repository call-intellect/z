import { Injectable } from '@nestjs/common';
import type { AiResult, Meeting, MeetingChapter } from '@prisma/client';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';

import { pickPrimarySummary } from '../../ai/utils/pick-primary-summary';

@Injectable()
export class DocxGenerator {
  async build(input: {
    meeting: Meeting;
    aiResult: AiResult | null;
    chapters: MeetingChapter[];
    tasks: ReadonlyArray<{ title: string }>;
  }): Promise<Buffer> {
    const sections: Paragraph[] = [];

    sections.push(
      new Paragraph({
        text: input.meeting.title,
        heading: HeadingLevel.HEADING_1,
      }),
      new Paragraph({
        children: [new TextRun({ text: `Тип: ${input.meeting.type}`, bold: false })],
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `Дата: ${input.meeting.startedAt?.toISOString() ?? '—'}`,
          }),
        ],
      }),
    );

    const summary = input.aiResult ? pickPrimarySummary(input.aiResult) : '';
    if (summary) {
      sections.push(
        new Paragraph({ text: 'Summary', heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: summary }),
      );
    }

    if (input.chapters.length > 0) {
      sections.push(new Paragraph({ text: 'Главы', heading: HeadingLevel.HEADING_2 }));
      for (const c of input.chapters) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({ text: formatMmSs(c.startMs), bold: true }),
              new TextRun({ text: `  ${c.title}` }),
            ],
          }),
        );
      }
    }

    if (input.tasks.length > 0) {
      sections.push(new Paragraph({ text: 'Задачи', heading: HeadingLevel.HEADING_2 }));
      for (const t of input.tasks) {
        sections.push(new Paragraph({ text: `• ${t.title}` }));
      }
    }

    const doc = new Document({
      sections: [{ properties: {}, children: sections }],
    });
    return Packer.toBuffer(doc);
  }
}

function formatMmSs(ms: number): string {
  const t = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
