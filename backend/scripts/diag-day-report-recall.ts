import type { SignalType, SourceType } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';

const DEFAULT_DAYS = 14;
const DEFAULT_LIMIT = 50;
const SAMPLE_TABLE_ROWS = 20;

const SOURCE_TYPES: SourceType[] = ['bitrix', 'chatbox'];

const PLAN_REPORT_SIGNAL_TYPES: SignalType[] = [
  'plan_item',
  'action_item',
  'done_item',
  'task_completed',
  'result',
  'blocker',
  'idea',
  'suggestion',
  'hypothesis',
];

interface Options {
  days: number;
  limit: number;
  tenantId?: string;
}

interface Sample {
  rawEventId: string;
  sourceType: SourceType;
  snippet: string;
  blockSignalTypes: SignalType[];
  hasMatchedWithAuthor: boolean;
}

function parseArgs(argv: string[]): Options {
  const tenantArg = argv.find((a) => a.startsWith('--tenant='));

  const readNumeric = (flag: string, dflt: number): number => {
    const eqArg = argv.find((a) => a.startsWith(`${flag}=`));
    let v: string | undefined;
    if (eqArg) {
      v = eqArg.split('=')[1];
    } else {
      const idx = argv.indexOf(flag);
      if (idx >= 0) v = argv[idx + 1];
    }
    if (v === undefined) return dflt;
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`Некорректное значение ${flag}: "${v}" (ожидалось положительное целое)`);
    }
    return n;
  };

  const opts: Options = {
    days: readNumeric('--days', DEFAULT_DAYS),
    limit: readNumeric('--limit', DEFAULT_LIMIT),
  };
  if (tenantArg) {
    const v = tenantArg.split('=')[1];
    if (v) opts.tenantId = v;
  }
  return opts;
}

function shortSnippet(text: string | null | undefined): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '<пусто>';
  return t.length > 70 ? `${t.slice(0, 70)}…` : t;
}

async function main(opts: Options): Promise<void> {
  console.log(
    `=== diag-day-report-recall (READ-ONLY) days=${opts.days}, limit=${opts.limit}, tenant=${opts.tenantId ?? '<все>'} ===`,
  );

  const prisma = createPrismaClient();
  try {
    const since = new Date(Date.now() - opts.days * 24 * 3600 * 1000);

    const events = await prisma.rawEvent.findMany({
      where: {
        sourceType: { in: SOURCE_TYPES },
        occurredAt: { gte: since },
        ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
      },
      select: { id: true, sourceType: true, sourceTitle: true, occurredAt: true },
      orderBy: { occurredAt: 'desc' },
      take: opts.limit,
    });

    console.log(
      `diag-day-report-recall: найдено RawEvent из bitrix/chatbox за ${opts.days} дн.: ${events.length}`,
    );

    const samples: Sample[] = [];
    for (const ev of events) {
      const evidences = await prisma.ideaBlockEvidence.findMany({
        where: { rawEventId: ev.id },
        select: {
          authorPersonId: true,
          block: { select: { signalType: true } },
        },
      });

      const blockSignalTypes = Array.from(new Set(evidences.map((e) => e.block.signalType)));
      const hasMatchedWithAuthor = evidences.some(
        (e) =>
          e.authorPersonId != null &&
          PLAN_REPORT_SIGNAL_TYPES.includes(e.block.signalType),
      );

      samples.push({
        rawEventId: ev.id,
        sourceType: ev.sourceType,
        snippet: shortSnippet(ev.sourceTitle),
        blockSignalTypes,
        hasMatchedWithAuthor,
      });
    }

    const total = samples.length;
    const covered = samples.filter((s) => s.hasMatchedWithAuthor).length;
    const pct = total > 0 ? ((covered / total) * 100).toFixed(1) : '0.0';

    console.log('=== Сводка (прокси recall разметки план/отчёт) ===');
    console.log(`  всего сэмплов                        : ${total}`);
    console.log(`  с размеченным блоком нужного типа     : ${covered}`);
    console.log(`  + authorPersonId != null (покрытие)   : ${pct}%`);
    console.log(
      '  ВНИМАНИЕ: «покрытие» — прокси, не истинный recall. Сверь текст глазами по таблице ниже.',
    );

    console.log(`=== Первые ${Math.min(SAMPLE_TABLE_ROWS, total)} сэмплов ===`);
    for (const s of samples.slice(0, SAMPLE_TABLE_ROWS)) {
      const types = s.blockSignalTypes.length > 0 ? s.blockSignalTypes.join(',') : '<нет блоков>';
      const mark = s.hasMatchedWithAuthor ? 'ДА' : 'нет';
      console.log(
        `  [${s.sourceType}] ${s.rawEventId} | автор+тип: ${mark} | типы: ${types} | «${s.snippet}»`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

const opts = parseArgs(process.argv.slice(2));
main(opts)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('diag-day-report-recall ПРОВАЛЕН:', err);
    process.exit(1);
  });
