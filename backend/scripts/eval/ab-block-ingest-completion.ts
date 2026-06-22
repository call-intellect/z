import { promises as fs } from 'node:fs';
import path from 'node:path';

import OpenAI from 'openai';

import { buildBlockIngestPrompt } from '../../src/modules/knowledge-core/prompts/block-ingest.prompt';

const NEW_SYSTEM = buildBlockIngestPrompt({ segments: [] }).system;

const ADDED_MARKERS = [
  '6. Выполнение (task_completed / done_item)',
  'ПРИМЕР 7 (выполнение',
  'ПЛОХО: signalType=commitment ИЛИ signalType=fact «Письмо Насте»',
  'ХОРОШО: signalType=task_completed (или done_item); name «Выполнено: письмо Насте',
  '9. Сообщения о УЖЕ сделанном',
];

function buildOldSystem(): string {
  const old = NEW_SYSTEM.split('\n')
    .filter((line) => !ADDED_MARKERS.some((m) => line.includes(m)))
    .join('\n');
  if (old === NEW_SYSTEM) {
    throw new Error('OLD == NEW: маркеры Ф2a не найдены в текущем промпте.');
  }
  for (const m of ADDED_MARKERS) {
    if (old.includes(m)) throw new Error(`OLD всё ещё содержит маркер: ${m}`);
    if (!NEW_SYSTEM.includes(m)) throw new Error(`NEW не содержит ожидаемый маркер: ${m}`);
  }
  return old;
}

const COMPLETION_SIGNALS = new Set(['task_completed', 'done_item', 'task_status_changed']);

interface Case {
  id: string;
  text: string;
  gold: 'completion' | 'other';
  note: string;
}

const CORPUS: Case[] = [
  { id: 'c1', gold: 'completion', note: 'прошедшее, результат', text: 'Я отправил коммерческое предложение клиенту вчера.' },
  { id: 'c2', gold: 'completion', note: 'закрытие задачи', text: 'Закрыл задачу по интеграции с Битриксом, всё работает.' },
  { id: 'c3', gold: 'completion', note: 'сделал + выложил', text: 'Сделал отчёт по продажам за месяц, выложил в общую папку.' },
  { id: 'c4', gold: 'completion', note: 'подписали', text: 'Договор с поставщиком подписали сегодня утром.' },
  { id: 'c5', gold: 'completion', note: 'готово/выкатили', text: 'Готово, выкатили новую версию приложения в прод.' },
  { id: 'c6', gold: 'completion', note: 'написал и отправил', text: 'Написал Насте по поставке и отправил ей письмо.' },
  { id: 'o1', gold: 'other', note: 'commitment (будущее)', text: 'Отправлю коммерческое предложение клиенту завтра.' },
  { id: 'o2', gold: 'other', note: 'commitment (обязуюсь)', text: 'Обязуюсь сделать отчёт по продажам к пятнице.' },
  { id: 'o3', gold: 'other', note: 'commitment (займусь)', text: 'Я займусь интеграцией с Битриксом на следующей неделе.' },
  { id: 'o4', gold: 'other', note: 'decision (план)', text: 'Решили перейти на новую CRM в следующем квартале.' },
  { id: 'o5', gold: 'other', note: 'need/idea', text: 'Нам нужно нанять ещё одного дизайнера в команду.' },
  { id: 'o6', gold: 'other', note: 'fact/metric', text: 'Выручка в этом месяце выросла на двадцать процентов.' },
];

function buildUser(text: string): string {
  return buildBlockIngestPrompt({
    segments: [{ startMs: 0, endMs: 5000, speakers: ['Спикер 1'], text }],
  }).user;
}

interface Pred {
  predictedCompletion: boolean;
  signals: string[];
  error?: string;
}

async function classify(
  client: OpenAI,
  model: string,
  system: string,
  text: string,
): Promise<Pred> {
  try {
    const resp = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: buildUser(text) },
      ],
    });
    const content = resp.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(content) as { blocks?: Array<{ signalType?: string }> };
    const signals = (parsed.blocks ?? []).map((b) => b.signalType ?? '?');
    return { predictedCompletion: signals.some((s) => COMPLETION_SIGNALS.has(s)), signals };
  } catch (err) {
    return { predictedCompletion: false, signals: [], error: err instanceof Error ? err.message : String(err) };
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY не задан (запусти с --env-file).');
  const model = process.env.AB_MODEL ?? 'deepseek-chat';
  const client = new OpenAI({ apiKey, baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1' });
  const oldSystem = buildOldSystem();

  const rows: Array<{
    c: Case;
    old: Pred;
    neu: Pred;
  }> = [];
  for (const c of CORPUS) {
    const [oldP, newP] = await Promise.all([
      classify(client, model, oldSystem, c.text),
      classify(client, model, NEW_SYSTEM, c.text),
    ]);
    rows.push({ c, old: oldP, neu: newP });
  }

  const score = (pick: (r: (typeof rows)[number]) => Pred) => {
    let complHit = 0;
    let complTotal = 0;
    let otherCorrect = 0;
    let otherTotal = 0;
    for (const r of rows) {
      const p = pick(r);
      if (r.c.gold === 'completion') {
        complTotal++;
        if (p.predictedCompletion) complHit++;
      } else {
        otherTotal++;
        if (!p.predictedCompletion) otherCorrect++;
      }
    }
    return { complHit, complTotal, otherCorrect, otherTotal };
  };

  const sOld = score((r) => r.old);
  const sNew = score((r) => r.neu);

  const lines: string[] = [];
  lines.push('# A/B block-ingest — захват «выполнения» (OLD prompt vs NEW prompt Ф2a)');
  lines.push('');
  lines.push(`Модель: ${model}. temperature=0. Корпус: ${CORPUS.length} реплик.`);
  lines.push('');
  lines.push('| id | gold | заметка | OLD→done? | NEW→done? | OLD signals | NEW signals |');
  lines.push('|----|------|---------|-----------|-----------|-------------|-------------|');
  for (const r of rows) {
    const f = (p: Pred) => (p.error ? 'ERR' : p.predictedCompletion ? '✅' : '—');
    lines.push(
      `| ${r.c.id} | ${r.c.gold} | ${r.c.note} | ${f(r.old)} | ${f(r.neu)} | ${(r.old.error ? r.old.error : r.old.signals.join(',')) || '∅'} | ${(r.neu.error ? r.neu.error : r.neu.signals.join(',')) || '∅'} |`,
    );
  }
  lines.push('');
  lines.push('## Итог');
  lines.push(`- Recall «выполнения» (gold=completion → распознано как done): OLD ${sOld.complHit}/${sOld.complTotal} · NEW ${sNew.complHit}/${sNew.complTotal}`);
  lines.push(`- Точность по «не-выполнению» (gold=other → НЕ помечено done): OLD ${sOld.otherCorrect}/${sOld.otherTotal} · NEW ${sNew.otherCorrect}/${sNew.otherTotal}`);
  const report = lines.join('\n');
  console.log('\n' + report + '\n');

  const outDir = path.resolve(process.cwd(), 'test/eval/block-ingest-completion-ab');
  await fs.mkdir(outDir, { recursive: true });
  const stamp = process.env.AB_STAMP ?? 'latest';
  const file = path.join(outDir, `ab-${model}-${stamp}.md`);
  await fs.writeFile(file, report + '\n', 'utf8');
  await fs.writeFile(path.join(outDir, `ab-${model}-${stamp}.json`, ), JSON.stringify({ model, rows, sOld, sNew }, null, 2), 'utf8');
  console.log(`Отчёт сохранён: ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
