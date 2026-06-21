import OpenAI from 'openai';

import {
  PROBE_FORMULATE_JSON_SCHEMA,
  PROBE_FORMULATE_SCHEMA_NAME,
  PROBE_FORMULATE_SYSTEM_PROMPT,
  PROBE_FORMULATE_USER_TEMPLATE,
} from '../../src/modules/knowledge-core/prompts/probe-formulate.prompt';
import {
  PROBE_REASON_FALLBACK,
  PROBE_REASON_FALLBACK_DEFAULT,
  PROBE_REASON_LABEL,
  PROBE_REASON_LABEL_DEFAULT,
} from '../../src/modules/probe/probe-reason-labels';
import {
  PROBE_QUALITY_JUDGE_JSON_SCHEMA,
  PROBE_QUALITY_JUDGE_SCHEMA_NAME,
  PROBE_QUALITY_JUDGE_SYSTEM_PROMPT,
  PROBE_QUALITY_JUDGE_USER,
} from '../../src/modules/probe/prompts/probe-quality-judge.prompt';

const MODEL = process.env.PROBE_TEST_MODEL ?? 'deepseek-v4-flash';

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('DEEPSEEK_API_KEY не задан (запускай с --env-file=backend/.env)');
  process.exit(1);
}
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
});

interface Case {
  label: string;
  reason: string;
  message: string;
  suggestedActions: string[];
  contextCard: { kind: string; title: string } | null;
  isReask?: boolean;
}

const CASES: Case[] = [
  {
    label: 'Регламент без ответственного (ваш дайджест Q2/Q4)',
    reason: 'regulation.missing_owner',
    message: 'У регламента «Фиксация договорённостей на совещаниях» нет ответственного.',
    suggestedActions: [],
    contextCard: { kind: 'regulation', title: 'Фиксация договорённостей на совещаниях' },
  },
  {
    label: 'Регламент без области применения (ваш дайджест Q3/Q5)',
    reason: 'regulation.scope_unclear',
    message:
      'Не указана область действия регламента «Упорядоченное хранение информации по торговым сетям». На кого распространяется?',
    suggestedActions: [],
    contextCard: {
      kind: 'regulation',
      title: 'Упорядоченное хранение информации по торговым сетям',
    },
  },
  {
    label: 'Шаг процесса без ответственного (дайджест-2 Q2/Q3)',
    reason: 'process_template.step_without_owner',
    message: 'У шага процесса «Настройка рабочего Telegram-аккаунта» нет ответственного.',
    suggestedActions: [],
    contextCard: { kind: 'process_step', title: 'Настройка рабочего Telegram-аккаунта' },
  },
  {
    label: 'Новая сущность без привязки (дайджест-2 Q5 «Молочные реки»)',
    reason: 'attribution.unresolved_at_ingest',
    message: 'Новая сущность «Молочные реки» упоминается, но не привязана к отделу, проекту или клиенту.',
    suggestedActions: [],
    contextCard: { kind: 'entity', title: 'Молочные реки' },
  },
  {
    label: 'DEFAULT-дыра: причина есть в LABEL, нет в FALLBACK (дайджест-2 Q1 «Можете уточнить»)',
    reason: 'process_template.missing_input_artifact',
    message:
      'У шага процесса «Настройка рабочего Telegram-аккаунта» не указан входной артефакт — что нужно иметь на входе.',
    suggestedActions: [],
    contextCard: { kind: 'process_step', title: 'Настройка рабочего Telegram-аккаунта' },
  },
  {
    label: 'Edge: пустой message и нет карточки (полный голод по контексту)',
    reason: 'process_template.missing_output_artifact',
    message: '',
    suggestedActions: [],
    contextCard: null,
  },
];

async function callJson(
  system: string,
  user: string,
  schemaName: string,
  schema: Record<string, unknown>,
): Promise<{ ok: boolean; raw: string; ms: number; tokensIn: number; tokensOut: number; err?: string }> {
  const tool = {
    type: 'function' as const,
    function: { name: schemaName, description: 'Верни результат строго по схеме.', parameters: schema },
  };
  const start = Date.now();
  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 1200,
      tools: [tool],
      tool_choice: 'auto',
    } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
      choices: Array<{ message?: { content?: string | null; tool_calls?: Array<{ function: { arguments: string } }> } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const ms = Date.now() - start;
    const msg = resp.choices[0]?.message;
    const call = msg?.tool_calls?.[0];
    const fromContent = (msg?.content ?? '').replace(/```json\s*|```/g, '').trim();
    const raw = call ? call.function.arguments : fromContent;
    return {
      ok: raw.length > 0,
      raw,
      ms,
      tokensIn: resp.usage?.prompt_tokens ?? 0,
      tokensOut: resp.usage?.completion_tokens ?? 0,
      err: raw.length > 0 ? undefined : 'пустой ответ',
    };
  } catch (e) {
    return { ok: false, raw: '', ms: Date.now() - start, tokensIn: 0, tokensOut: 0, err: e instanceof Error ? e.message : String(e) };
  }
}

function fallbackOf(reason: string): string {
  return PROBE_REASON_FALLBACK[reason] ?? PROBE_REASON_FALLBACK_DEFAULT;
}

async function main(): Promise<void> {
  console.log(`=== probe-formulate синтетический прогон | модель=${MODEL} ===\n`);
  for (const c of CASES) {
    const reasonLabel = PROBE_REASON_LABEL[c.reason] ?? PROBE_REASON_LABEL_DEFAULT;
    const user = PROBE_FORMULATE_USER_TEMPLATE({
      reasonLabel,
      message: c.message,
      suggestedActions: c.suggestedActions,
      contextCard: c.contextCard,
      isReask: c.isReask,
    });

    const f = await callJson(
      PROBE_FORMULATE_SYSTEM_PROMPT,
      user,
      PROBE_FORMULATE_SCHEMA_NAME,
      PROBE_FORMULATE_JSON_SCHEMA,
    );
    let llmQuestion = '';
    if (f.ok) {
      try {
        llmQuestion = (JSON.parse(f.raw) as { question?: string }).question ?? '';
      } catch (e) {
        f.err = `parse: ${(e as Error).message}`;
      }
    }

    let judged = '';
    let judgeVerdict = '';
    if (llmQuestion) {
      const j = await callJson(
        PROBE_QUALITY_JUDGE_SYSTEM_PROMPT,
        PROBE_QUALITY_JUDGE_USER({ question: llmQuestion }),
        PROBE_QUALITY_JUDGE_SCHEMA_NAME,
        PROBE_QUALITY_JUDGE_JSON_SCHEMA,
      );
      if (j.ok) {
        try {
          const v = JSON.parse(j.raw) as { ok?: boolean; issues?: string[]; rewrite?: string };
          judgeVerdict = v.ok ? 'ok' : `rewrite[${(v.issues ?? []).join(',')}]`;
          judged = v.ok ? llmQuestion : (v.rewrite?.trim() || llmQuestion);
        } catch {
          judgeVerdict = 'parse-fail';
          judged = llmQuestion;
        }
      } else {
        judgeVerdict = `judge-fail: ${j.err}`;
        judged = llmQuestion;
      }
    }

    console.log(`### ${c.label}`);
    console.log(`reason=${c.reason} | label="${reasonLabel}"`);
    console.log(`  СЕЙЧАС в дайджесте (fallback):  "${fallbackOf(c.reason)}"`);
    console.log(
      `  LLM probe-formulate:            "${llmQuestion || '— (' + (f.err ?? 'пусто') + ')'}"  [${f.ms}мс, in=${f.tokensIn} out=${f.tokensOut}]`,
    );
    console.log(`  После судьи качества:           "${judged || '—'}"  [${judgeVerdict || '—'}]`);
    console.log('');
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
