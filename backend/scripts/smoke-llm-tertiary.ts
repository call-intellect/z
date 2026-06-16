import OpenAI from 'openai';

const BASE_URL = process.env.OLLAMA_BASE_URL ?? 'https://ollama.agent-lia.ru/v1';
const API_KEY = process.env.OLLAMA_API_KEY ?? 'sk-local-test-20260319';
const MODEL = process.env.OLLAMA_MODEL ?? 'qwen3.5:9b';

interface SmokeCase {
  taskType: string;
  systemPrompt: string;
  userMessage: string;
  expectJson: boolean;
}

const CASES: SmokeCase[] = [
  {
    taskType: 'summary',
    systemPrompt: 'Ты резюмируешь рабочую встречу. Отвечай кратко на русском.',
    userMessage:
      'Встреча 5 мая о найме маркетолога. Решили: опубликовать вакансию до пятницы. Резюмируй в 2 предложениях.',
    expectJson: false,
  },
  {
    taskType: 'tasks',
    systemPrompt:
      'Извлеки задачи из транскрипта встречи. Верни ТОЛЬКО JSON-массив объектов вида ' +
      '[{"title":string,"assignee":string|null,"dueDate":string|null}].',
    userMessage:
      'Иван должен подготовить отчёт к среде. Мария созвонится с клиентом завтра. Reply with valid JSON only.',
    expectJson: true,
  },
  {
    taskType: 'chapters',
    systemPrompt:
      'Раздели транскрипт встречи на главы. Верни ТОЛЬКО JSON: ' +
      '{"chapters":[{"title":string,"startSec":number,"endSec":number}]}.',
    userMessage:
      '00:00 Приветствие. 02:00 Обсуждение бюджета Q3. 15:30 Запуск кампании. Reply with valid JSON only.',
    expectJson: true,
  },
  {
    taskType: 'chat-v2',
    systemPrompt: 'Отвечай на вопросы о встречах. По-русски, кратко.',
    userMessage: 'Кто отвечал за подготовку отчёта на встрече 5 мая?',
    expectJson: false,
  },
  {
    taskType: 'behavior-refine',
    systemPrompt:
      'Оцени поведенческие метрики участника. Верни ТОЛЬКО JSON: ' +
      '{"engagement":0..1,"clarity":0..1,"interruptions":int}.',
    userMessage: 'Участник Иван говорил 60% времени, прерывал 2 раза. Reply with valid JSON only.',
    expectJson: true,
  },
];

interface SmokeResult {
  taskType: string;
  status: 'ok' | 'json_parse_failed' | 'http_error';
  durationMs: number;
  text: string;
  errorText?: string;
}

async function runCase(c: SmokeCase): Promise<SmokeResult> {
  const client = new OpenAI({ baseURL: BASE_URL, apiKey: API_KEY });
  const startedAt = Date.now();
  try {
    const res = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: c.systemPrompt },
        { role: 'user', content: c.userMessage },
      ],
      ...(c.expectJson ? { response_format: { type: 'json_object' as const } } : {}),
      temperature: 0.2,
      max_tokens: 800,
    });
    const text = res.choices[0]?.message.content ?? '';
    const durationMs = Date.now() - startedAt;
    if (c.expectJson) {
      try {
        JSON.parse(text);
      } catch (err) {
        return {
          taskType: c.taskType,
          status: 'json_parse_failed',
          durationMs,
          text,
          errorText: err instanceof Error ? err.message : String(err),
        };
      }
    }
    return { taskType: c.taskType, status: 'ok', durationMs, text };
  } catch (err) {
    return {
      taskType: c.taskType,
      status: 'http_error',
      durationMs: Date.now() - startedAt,
      text: '',
      errorText: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`=== smoke-llm-tertiary START (model=${MODEL}, baseURL=${BASE_URL}) ===`);
  const results: SmokeResult[] = [];
  for (const c of CASES) {
    // eslint-disable-next-line no-console
    console.log(`[run] ${c.taskType} (expectJson=${c.expectJson})`);
    const r = await runCase(c);
    // eslint-disable-next-line no-console
    console.log(
      `  → ${r.status} ${r.durationMs}ms` +
        (r.errorText ? ` err="${r.errorText.slice(0, 200)}"` : ''),
    );
    if (r.status === 'ok') {
      // eslint-disable-next-line no-console
      console.log(`  preview: ${r.text.slice(0, 180).replace(/\s+/g, ' ')}`);
    }
    results.push(r);
  }
  const okCount = results.filter((r) => r.status === 'ok').length;
  const jsonFail = results.filter((r) => r.status === 'json_parse_failed').length;
  const httpFail = results.filter((r) => r.status === 'http_error').length;
  // eslint-disable-next-line no-console
  console.log(
    `=== smoke-llm-tertiary DONE: ok=${okCount}, json_failed=${jsonFail}, http_failed=${httpFail} ===`,
  );
  if (httpFail === CASES.length) {
    process.exit(1);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('smoke-llm-tertiary FAILED:', err);
  process.exit(1);
});
