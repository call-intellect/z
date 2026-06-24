import { runAgent, type AgentConfig } from './agent';
import { llm, parseJsonLoose } from './llm';

const AGG = 'По всем встречам с Александром собери список его болей, проблем и возражений';
const N = 3;

async function judge(question: string, answer: string): Promise<number> {
  const r = await llm(
    'deepseek',
    `Строгий оценщик ответа из памяти компании. JSON {"score":0..3}. 3 — полный/релевантный/со ссылками/без выдумок; 2 — верный но неполный; 1 — слабый/частично мимо; 0 — пусто/выдумка. Честный "не нашёл" при реальном отсутствии = 3.`,
    `Вопрос: ${question}\nОтвет: ${answer}`,
    { json: true, maxTokens: 200 },
  );
  return parseJsonLoose<{ score: number }>(r.text)?.score ?? -1;
}

function avg(xs: number[]): number {
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100;
}

async function repeat(label: string, q: string, cfg: Partial<AgentConfig>, n = N): Promise<void> {
  const qs: number[] = [];
  const cites: number[] = [];
  const calls: number[] = [];
  const ms: number[] = [];
  let abstains = 0;
  for (let i = 0; i < n; i++) {
    const r = await runAgent(q, cfg);
    qs.push(await judge(q, r.text));
    cites.push(r.usedBlockIds.length);
    calls.push(r.llmCalls);
    ms.push(r.totalMs);
    if (r.kind === 'abstain') abstains++;
  }
  process.stdout.write(
    `${label.padEnd(26)} кач=${avg(qs)} (${qs.join('/')})  ссыл=${avg(cites)}  выз=${avg(calls)}  мс=${Math.round(avg(ms))}  abstain=${abstains}/${n}\n`,
  );
}

async function gateIsolation(): Promise<void> {
  process.stdout.write('\n### ЭКСП G — ГЕЙТ ЧЕСТНОСТИ изолированно (детектор выдумки)\n');
  const GROUND_SYS = `Ты — контролёр заземления. JSON {"grounded":bool,"reason":str}. grounded=false, если ответ утверждает факты/«готово», которых НЕТ в блоках. Честное "не нашёл" = true.`;
  const blocks = `[BLOCK:b1] (fact) Настя проводит экскурсии для клиентов.\n[BLOCK:b2] (done) Айназ сообщила, что задача создать видео выполнена.`;
  const q = 'Какая была суть совместного созвона Насти и Айназ?';
  const cases: Array<{ name: string; answer: string; expect: boolean }> = [
    { name: 'выдуманный совместный созвон', answer: 'На совместном созвоне Настя и Айназ обсудили план видео и распределили роли. [BLOCK:b1] [BLOCK:b2]', expect: false },
    { name: 'честный «не нашёл»', answer: 'В памяти компании я этого не нашёл — совместного созвона Насти и Айназ нет.', expect: true },
  ];
  let ok = 0;
  for (const c of cases) {
    const r = await llm('deepseek', GROUND_SYS, `Вопрос: ${q}\nОтвет помощника: ${c.answer}\nБлоки:\n${blocks}`, { json: true, maxTokens: 200 });
    const g = parseJsonLoose<{ grounded: boolean; reason: string }>(r.text) ?? { grounded: true, reason: '' };
    const pass = g.grounded === c.expect;
    if (pass) ok++;
    process.stdout.write(`${pass ? '✅' : '❌'} ${c.name}: grounded=${g.grounded} (ждали ${c.expect}) — ${String(g.reason).slice(0, 60)}\n`);
  }
  process.stdout.write(`Детектор гейта: ${ok}/${cases.length} верно\n`);
}

async function main(): Promise<void> {
  const DS: Partial<AgentConfig> = { models: 'deepseek' };
  process.stdout.write(`### ЭКСП 2b — ПЛАН ×${N} прогонов (усреднение, DeepSeek)\n`);
  await repeat('none (без плана)', AGG, { ...DS, planMode: 'none' });
  await repeat('rewoo', AGG, { ...DS, planMode: 'rewoo' });
  await repeat('classic', AGG, { ...DS, planMode: 'classic' });

  process.stdout.write(`\n### ЭКСП 5b — РЕРАНК ×${N} прогонов (усреднение, DeepSeek)\n`);
  await repeat('rerank ON', AGG, { ...DS, rerank: true });
  await repeat('rerank OFF', AGG, { ...DS, rerank: false });

  await gateIsolation();
  process.stdout.write('\n══ раунд 2 отработан ══\n');
}

main().catch((e) => {
  process.stderr.write(String(e) + '\n');
  process.exit(1);
});
