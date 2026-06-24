import { runAgent, type AgentConfig, type AgentResult } from './agent';
import { llm, parseJsonLoose } from './llm';
import { naiveRetrieve } from './fixtures';

const AGG = 'По всем встречам с Александром собери список его болей, проблем и возражений';
const ABSTAIN = 'Какая была суть совместного созвона Насти и Айназ?';
const COLDSTART = 'По всем встречам с Никитой собери его возражения и проблемы';

async function judge(question: string, answer: string): Promise<{ score: number; note: string }> {
  const r = await llm(
    'deepseek',
    `Ты — строгий оценщик ответа помощника по памяти компании. Верни JSON {"score":0..3,"note":str}.
3 — полный, релевантный, со ссылками, без выдумок; 2 — в целом верный, но неполный; 1 — слабый/частично мимо; 0 — пустой/выдумка/мимо. Честный "не нашёл" при реальном отсутствии данных = 3.`,
    `Вопрос: ${question}\nОтвет: ${answer}`,
    { json: true, maxTokens: 300 },
  );
  return parseJsonLoose<{ score: number; note: string }>(r.text) ?? { score: -1, note: 'parse-fail' };
}

interface Row {
  variant: string;
  kind: string;
  cites: number;
  calls: number;
  ms: number;
  quality: number;
  note: string;
}
async function runVariant(label: string, q: string, cfg: Partial<AgentConfig>): Promise<Row> {
  const r: AgentResult = await runAgent(q, cfg);
  const jq = await judge(q, r.text);
  return { variant: label, kind: r.kind, cites: r.usedBlockIds.length, calls: r.llmCalls, ms: r.totalMs, quality: jq.score, note: jq.note.slice(0, 70) };
}
function table(title: string, rows: Row[]): void {
  process.stdout.write(`\n### ${title}\n`);
  process.stdout.write('вариант'.padEnd(26) + 'исход'.padEnd(10) + 'кач'.padEnd(5) + 'ссыл'.padEnd(6) + 'выз'.padEnd(5) + 'мс'.padEnd(8) + 'заметка\n');
  for (const r of rows) {
    process.stdout.write(
      r.variant.padEnd(26) + r.kind.padEnd(10) + String(r.quality).padEnd(5) + String(r.cites).padEnd(6) + String(r.calls).padEnd(5) + String(r.ms).padEnd(8) + r.note + '\n',
    );
  }
}

async function main(): Promise<void> {
  const DS: Partial<AgentConfig> = { models: 'deepseek' };

  // ЭКСП 1 — модели: hybrid(gpt5mini) vs deepseek на агрегате
  table('ЭКСП 1 — МОДЕЛИ (агрегат Александр)', [
    await runVariant('hybrid(gpt5mini)', AGG, { models: 'hybrid' }),
    await runVariant('deepseek', AGG, { models: 'deepseek' }),
  ]);

  // ЭКСП 2 — стратегия плана: none / rewoo / classic (агрегат)
  table('ЭКСП 2 — ПЛАН (агрегат Александр, DeepSeek)', [
    await runVariant('none (без плана)', AGG, { ...DS, planMode: 'none' }),
    await runVariant('rewoo (план без переплана)', AGG, { ...DS, planMode: 'rewoo' }),
    await runVariant('classic (план+переформ.)', AGG, { ...DS, planMode: 'classic' }),
  ]);

  // ЭКСП 3 — холодный старт (нет данных по Никите): rewoo vs classic — оба должны честно отказать
  table('ЭКСП 3 — COLD-START (Никита нет в памяти, DeepSeek)', [
    await runVariant('rewoo', COLDSTART, { ...DS, planMode: 'rewoo' }),
    await runVariant('classic', COLDSTART, { ...DS, planMode: 'classic' }),
  ]);

  // ЭКСП 4 — гейт честности on/off на «нет данных» (Настя+Айназ совместного созвона нет)
  table('ЭКСП 4 — ГЕЙТ ЧЕСТНОСТИ (нет данных, DeepSeek)', [
    await runVariant('gate ON', ABSTAIN, { ...DS, gate: true }),
    await runVariant('gate OFF', ABSTAIN, { ...DS, gate: false }),
  ]);

  // ЭКСП 5 — реранк on/off на агрегате (шум)
  table('ЭКСП 5 — РЕРАНК (агрегат, DeepSeek)', [
    await runVariant('rerank ON', AGG, { ...DS, rerank: true }),
    await runVariant('rerank OFF', AGG, { ...DS, rerank: false }),
  ]);

  // ЭКСП 6 — гейт переспроса: суите вопросов (только маршрут). Поиск → НЕ переспрашивать; действие неоднозначное → переспрос ок.
  const CLARIFY_Q: Array<{ q: string; mustClarify: boolean }> = [
    { q: 'Найди все встречи с Александром', mustClarify: false },
    { q: 'Сколько у нас было встреч с Александром?', mustClarify: false },
    { q: 'Расскажи суть последней встречи', mustClarify: false },
    { q: 'По всем встречам с Настей собери задачи', mustClarify: false },
    { q: 'Поставь задачу', mustClarify: true },
    { q: 'Отмени встречу', mustClarify: true },
  ];
  process.stdout.write('\n### ЭКСП 6 — ГЕЙТ ПЕРЕСПРОСА (маршрут, DeepSeek)\n');
  let clarOk = 0;
  for (const c of CLARIFY_Q) {
    const r = await runAgent(c.q, { ...DS, planMode: 'none', rerank: false, gate: false, maxRefine: 0 });
    const clar = r.kind === 'clarify';
    const ok = clar === c.mustClarify;
    if (ok) clarOk++;
    process.stdout.write(`${ok ? '✅' : '❌'} ${c.mustClarify ? 'должен спросить' : 'НЕ должен'} → ${clar ? 'спросил' : 'не спросил'} | ${c.q}\n`);
  }
  process.stdout.write(`Гейт переспроса: ${clarOk}/${CLARIFY_Q.length} верно\n`);

  // ЭКСП 7 — сторож зацикливания (детерминированно, без LLM): повтор запроса не должен искать дважды
  const a = naiveRetrieve('Александр', 8).map((c) => c.id).join(',');
  const b = naiveRetrieve('Александр', 8).map((c) => c.id).join(',');
  process.stdout.write(`\n### ЭКСП 7 — СТОРОЖ (детерминизм поиска)\n${a === b ? '✅' : '❌'} одинаковый запрос → одинаковый детерминированный результат (отпечаток стабилен)\n`);

  process.stdout.write('\n══ матрица отработана ══\n');
}

main().catch((e) => {
  process.stderr.write(String(e) + '\n');
  process.exit(1);
});
