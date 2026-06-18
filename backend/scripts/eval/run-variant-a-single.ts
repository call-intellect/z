import { promises as fs } from 'fs';
import path from 'path';
import OpenAI from 'openai';

import {
  BLOCK_INGEST_JSON_SCHEMA,
  buildBlockIngestPrompt,
} from '../../src/modules/knowledge-core/prompts/block-ingest.prompt';
import {
  CHAPTERS_V2_JSON_SCHEMA,
  buildChaptersV2Prompt,
} from '../../src/modules/knowledge-core/prompts/chapters-v2.prompt';
import {
  TASKS_V2_JSON_SCHEMA,
  buildTasksV2Prompt,
} from '../../src/modules/knowledge-core/prompts/tasks-v2.prompt';
import { buildSummaryV2Prompt } from '../../src/modules/knowledge-core/prompts/summary-v2.prompt';
import {
  MEETING_QUALITY_SCORE_SYSTEM_PROMPT,
  MEETING_QUALITY_SCORE_TOOL,
  buildMeetingQualityScoreUserPrompt,
  condenseTranscriptForQualityScore,
} from '../../src/modules/ai/services/prompts/meeting-quality-score';

const MODEL = 'deepseek-v4-pro';
const PRICE_IN = 0.435 / 1_000_000;
const PRICE_CACHED_IN = 0.003625 / 1_000_000;
const PRICE_OUT = 0.87 / 1_000_000;
const MAX_TOKENS_INGEST = 48000;
const MAX_TOKENS_CHAPTERS = 12000;
const MAX_TOKENS_TASKS = 8000;
const MAX_TOKENS_SUMMARY = 8000;
const MAX_TOKENS_QUALITY = 16000;

const FIXTURE_ID = process.argv[2] ?? 'fixture-01-pilot';
const FIXTURE_PATH = path.resolve(`test/eval/sales-merge-experiment/fixtures/${FIXTURE_ID}.json`);
const REPORT_PATH = path.resolve(
  `test/eval/sales-merge-experiment/reports/${FIXTURE_ID}-variant-a.json`,
);

interface FixtureJson {
  fixtureId: string;
  meetingType: 'sales';
  scenario: string;
  meta: {
    clientName: string;
    vendorName: string;
    speakers: Array<{ name: string; role: string; side: string }>;
    expectedFacts: string[];
  };
  transcript: string;
}

interface Turn {
  speaker: string;
  text: string;
  startSec: number;
  endSec: number;
}

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
  cached_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

interface CallReport {
  step: string;
  ok: boolean;
  ms: number;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  costUsd: number;
  jsonValid: boolean;
  error?: string;
  output?: unknown;
  outputSizeChars?: number;
}

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('✗ DEEPSEEK_API_KEY не задан');
  process.exit(1);
}
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
});

function parseTimestamp(s: string): number {
  const parts = s.split(':').map(Number);
  if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  if (parts.length === 3) return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  return 0;
}

const LINE_RE = /^\[(\d{1,3}:\d{2}(?::\d{2})?)\]\s*([^:]+):\s*(.+)$/;

function parseTranscript(transcript: string): Turn[] {
  const lines = transcript.split('\n');
  const raw: { startSec: number; speaker: string; text: string }[] = [];
  let pendingText: string | null = null;
  for (const line of lines) {
    const m = LINE_RE.exec(line);
    if (m) {
      const startSec = parseTimestamp(m[1]!);
      const speaker = m[2]!.trim();
      const text = m[3]!.trim();
      raw.push({ startSec, speaker, text });
      pendingText = null;
    } else if (raw.length > 0 && line.trim().length > 0) {
      raw[raw.length - 1]!.text += ' ' + line.trim();
      pendingText = raw[raw.length - 1]!.text;
    }
  }
  const turns: Turn[] = raw.map((r, i) => ({
    speaker: r.speaker,
    text: r.text,
    startSec: r.startSec,
    endSec: raw[i + 1]?.startSec ?? r.startSec + 5,
  }));
  return turns;
}

function buildSegments(
  turns: Turn[],
): Array<{ startMs: number; endMs: number; speakers: string[]; text: string }> {
  const groups: Turn[][] = [];
  let current: Turn[] = [];
  let last: string | null = null;
  for (const t of turns) {
    if (t.speaker !== last && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(t);
    last = t.speaker;
  }
  if (current.length > 0) groups.push(current);
  return groups.map((g) => ({
    startMs: Math.round(g[0]!.startSec * 1000),
    endMs: Math.round(g[g.length - 1]!.endSec * 1000),
    speakers: [g[0]!.speaker],
    text: g.map((t) => `${t.speaker}: ${t.text}`).join('\n'),
  }));
}

interface LocalTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

async function callDeepseek(opts: {
  step: string;
  system: string;
  user: string;
  maxTokens: number;
  tool?: LocalTool;
}): Promise<CallReport> {
  console.log(`  → ${opts.step}…`);
  const start = Date.now();
  let usage: Usage = {};
  let output: unknown = undefined;
  let jsonValid = true;
  let error: string | undefined;

  try {
    const params: Record<string, unknown> = {
      model: MODEL,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      max_tokens: opts.maxTokens,
    };
    if (opts.tool) {
      params.tools = [
        {
          type: 'function',
          function: {
            name: opts.tool.name,
            description: opts.tool.description,
            parameters: opts.tool.parameters,
          },
        },
      ];
      params.tool_choice = 'auto';
    }
    const resp = (await client.chat.completions.create(
      params as Parameters<typeof client.chat.completions.create>[0],
    )) as unknown as {
      choices: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            function: { name: string; arguments: string };
          }>;
        };
      }>;
      usage?: Usage;
    };
    usage = resp.usage ?? {};
    const msg = resp.choices[0]?.message;

    if (opts.tool) {
      const call = msg?.tool_calls?.[0];
      if (!call) {
        jsonValid = false;
        error = 'модель не позвала tool (свободный текст вместо структурного)';
        output = msg?.content ?? '';
      } else {
        try {
          output = JSON.parse(call.function.arguments);
        } catch (e) {
          jsonValid = false;
          error = `JSON.parse tool args: ${(e as Error).message}`;
          output = call.function.arguments;
        }
      }
    } else {
      output = msg?.content ?? '';
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    jsonValid = false;
  }

  const ms = Date.now() - start;
  const tokensIn = usage.prompt_tokens ?? 0;
  const tokensOut = usage.completion_tokens ?? 0;
  const cachedTokens =
    usage.prompt_cache_hit_tokens ??
    usage.cached_tokens ??
    usage.prompt_tokens_details?.cached_tokens ??
    0;
  const uncached = Math.max(0, tokensIn - cachedTokens);
  const costUsd = uncached * PRICE_IN + cachedTokens * PRICE_CACHED_IN + tokensOut * PRICE_OUT;

  const outputStr = typeof output === 'string' ? output : JSON.stringify(output ?? '');
  const outputSizeChars = outputStr.length;

  console.log(
    `    ${error ? '✗' : '✓'} ${ms} мс | вход=${tokensIn} (кэш=${cachedTokens}) выход=${tokensOut} | $${costUsd.toFixed(4)}${error ? ` | ${error}` : ''}`,
  );
  return {
    step: opts.step,
    ok: !error,
    ms,
    tokensIn,
    tokensOut,
    cachedTokens,
    costUsd,
    jsonValid,
    error,
    output,
    outputSizeChars,
  };
}

async function step1BlockIngest(
  fixture: FixtureJson,
  segments: ReturnType<typeof buildSegments>,
): Promise<{ blocks: Array<MeetingBlockLocal>; report: CallReport }> {
  const segmentsWithIndex = segments.map((s, idx) => ({ index: idx, ...s }));
  const { system, user } = buildBlockIngestPrompt({
    meetingTitle: `Продажная встреча: ${fixture.meta.vendorName} ↔ ${fixture.meta.clientName}`,
    segments: segmentsWithIndex,
  });
  const report = await callDeepseek({
    step: '1. block-ingest',
    system,
    user: user + '\n\nВажно: верни результат через вызов инструмента submit_block_ingest.',
    maxTokens: MAX_TOKENS_INGEST,
    tool: {
      name: 'submit_block_ingest',
      description: 'Отдать извлечённые блоки и типизированные сущности по схеме block-ingest.',
      parameters: BLOCK_INGEST_JSON_SCHEMA,
    },
  });
  let blocks: Array<MeetingBlockLocal> = [];
  if (report.ok && report.output && typeof report.output === 'object') {
    const out = report.output as {
      blocks?: Array<{
        name: string;
        criticalQuestion: string;
        trustedAnswer: string;
        signalType: string;
        tags?: string[];
        evidenceQuote?: string;
        evidenceStartMs?: number;
        evidenceEndMs?: number;
      }>;
    };
    blocks = (out.blocks ?? []).map((b, idx) => ({
      id: `blk_${String(idx).padStart(3, '0')}`,
      name: b.name,
      criticalQuestion: b.criticalQuestion,
      trustedAnswer: b.trustedAnswer,
      signalType: b.signalType,
      tags: b.tags ?? [],
      dataClass: 'internal',
      evidence: [
        {
          id: `ev_${idx}`,
          startMs: b.evidenceStartMs ?? null,
          endMs: b.evidenceEndMs ?? null,
          quote: b.evidenceQuote ?? '',
          sourceTimestamp: null,
        },
      ],
    }));
  }
  console.log(`    извлечено блоков: ${blocks.length}`);
  return { blocks, report };
}

interface MeetingBlockLocal {
  id: string;
  name: string;
  criticalQuestion: string;
  trustedAnswer: string;
  signalType: string;
  tags: string[];
  dataClass: string;
  evidence: Array<{
    id: string;
    startMs: number | null;
    endMs: number | null;
    quote: string;
    sourceTimestamp: Date | null;
  }>;
}

async function step2Chapters(blocks: MeetingBlockLocal[], title: string): Promise<CallReport> {
  const { system, user } = buildChaptersV2Prompt({
    meetingId: FIXTURE_ID,
    meetingTitle: title,
    blocks: blocks as unknown as Parameters<typeof buildChaptersV2Prompt>[0]['blocks'],
  });
  return callDeepseek({
    step: '2. chapters-v2',
    system,
    user: user + '\n\nВажно: верни результат через вызов инструмента submit_chapters.',
    maxTokens: MAX_TOKENS_CHAPTERS,
    tool: {
      name: 'submit_chapters',
      description: 'Отдать главы встречи по схеме chapters-v2.',
      parameters: CHAPTERS_V2_JSON_SCHEMA,
    },
  });
}

async function step3Tasks(blocks: MeetingBlockLocal[], title: string): Promise<CallReport> {
  const TASK_SIGNALS = new Set(['commitment', 'decision']);
  const filtered = blocks.filter((b) => TASK_SIGNALS.has(b.signalType));
  console.log(`    блоков под фильтр tasks: ${filtered.length}`);
  const { system, user } = buildTasksV2Prompt({
    meetingId: FIXTURE_ID,
    meetingTitle: title,
    blocks: filtered as unknown as Parameters<typeof buildTasksV2Prompt>[0]['blocks'],
  });
  return callDeepseek({
    step: '3. tasks-v2',
    system,
    user: user + '\n\nВажно: верни результат через вызов инструмента submit_tasks.',
    maxTokens: MAX_TOKENS_TASKS,
    tool: {
      name: 'submit_tasks',
      description: 'Отдать список действий встречи по схеме tasks-v2.',
      parameters: TASKS_V2_JSON_SCHEMA,
    },
  });
}

async function step4Summary(blocks: MeetingBlockLocal[], title: string): Promise<CallReport> {
  const { system, user } = buildSummaryV2Prompt({
    meetingType: 'sales' as unknown as Parameters<typeof buildSummaryV2Prompt>[0]['meetingType'],
    meetingTitle: title,
    blocks: blocks as unknown as Parameters<typeof buildSummaryV2Prompt>[0]['blocks'],
  });
  return callDeepseek({
    step: '4. summary-v2',
    system,
    user,
    maxTokens: MAX_TOKENS_SUMMARY,
  });
}

async function step5Quality(turns: Turn[], fixture: FixtureJson): Promise<CallReport> {
  const lastTurn = turns[turns.length - 1];
  const durationMs = Math.round((lastTurn?.endSec ?? 0) * 1000);
  const dialogTurns = turns.map((t) => ({
    speaker: t.speaker,
    text: t.text,
    startSec: t.startSec,
    endSec: t.endSec,
  }));
  const transcriptCondensed = condenseTranscriptForQualityScore(dialogTurns, {
    durationMs,
  });
  const user = buildMeetingQualityScoreUserPrompt({
    meetingType: fixture.meetingType,
    durationMinutes: Math.round(durationMs / 60_000),
    participantsCount: fixture.meta.speakers.length,
    transcriptCondensed,
  });
  return callDeepseek({
    step: '5. meeting-quality-score',
    system: MEETING_QUALITY_SCORE_SYSTEM_PROMPT,
    user,
    maxTokens: MAX_TOKENS_QUALITY,
    tool: {
      name: MEETING_QUALITY_SCORE_TOOL.name,
      description: MEETING_QUALITY_SCORE_TOOL.description,
      parameters: MEETING_QUALITY_SCORE_TOOL.input_schema as unknown as Record<string, unknown>,
    },
  });
}

async function main(): Promise<void> {
  console.log('=== Variant A — раздельные вызовы цепочки №1 ===');
  console.log(`  модель:    ${MODEL}`);
  console.log(`  фикстура:  ${path.basename(FIXTURE_PATH)}`);
  const fixtureRaw = await fs.readFile(FIXTURE_PATH, 'utf-8');
  const fixture: FixtureJson = JSON.parse(fixtureRaw);
  console.log(`  знаков:    ${fixture.transcript.length}, тип: ${fixture.meetingType}\n`);

  const turns = parseTranscript(fixture.transcript);
  const segments = buildSegments(turns);
  console.log(`✓ парсинг: ${turns.length} реплик, ${segments.length} сегментов\n`);

  const title = `Продажная встреча: ${fixture.meta.vendorName} ↔ ${fixture.meta.clientName}`;
  const totalStart = Date.now();

  const { blocks, report: rIngest } = await step1BlockIngest(fixture, segments);

  console.log('\n→ параллельно: chapters-v2 | tasks-v2 | summary-v2 | quality-score');
  const [rChapters, rTasks, rSummary, rQuality] = await Promise.all([
    step2Chapters(blocks, title),
    step3Tasks(blocks, title),
    step4Summary(blocks, title),
    step5Quality(turns, fixture),
  ]);

  const totalMs = Date.now() - totalStart;
  const reports = [rIngest, rChapters, rTasks, rSummary, rQuality];

  const tokensIn = reports.reduce((s, r) => s + r.tokensIn, 0);
  const tokensOut = reports.reduce((s, r) => s + r.tokensOut, 0);
  const cached = reports.reduce((s, r) => s + r.cachedTokens, 0);
  const costUsd = reports.reduce((s, r) => s + r.costUsd, 0);
  const fails = reports.filter((r) => !r.ok).length;

  console.log('\n=== Итоги ===');
  console.log(`  всего вызовов: 5  (упало: ${fails})`);
  console.log(`  итог. время:   ${totalMs} мс`);
  console.log(`  токены: вход=${tokensIn} (кэш=${cached}) выход=${tokensOut}`);
  console.log(`  стоимость:     $${costUsd.toFixed(4)}`);

  await fs.writeFile(
    REPORT_PATH,
    JSON.stringify(
      {
        variant: 'A',
        fixtureId: fixture.fixtureId,
        model: MODEL,
        totalMs,
        totalTokensIn: tokensIn,
        totalTokensOut: tokensOut,
        totalCachedTokens: cached,
        totalCostUsd: costUsd,
        steps: reports,
        ingestedBlocksCount: blocks.length,
      },
      null,
      2,
    ),
    'utf-8',
  );
  console.log(`\n✓ отчёт: ${REPORT_PATH}`);
}

main().catch((e) => {
  console.error('\n✗ FATAL:', e);
  process.exit(1);
});
