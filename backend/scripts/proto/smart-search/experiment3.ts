import { runAgent, type AgentConfig } from './agent';
import { llm, parseJsonLoose } from './llm';

const AGG = 'По всем встречам с Александром собери список его болей, проблем и возражений';
const N = 3;

async function judge(question: string, answer: string): Promise<number> {
  const r = await llm(
    'deepseek',
    `Строгий оценщик ответа из памяти компании про КЛИЕНТА Александра (робототехника/внедрение). JSON {"score":0..3}. Штрафуй, если ответ приплёл посторонних (Александр Петров из бухгалтерии, Александр Сидоров дизайнер, маркетинг, Заречный, сервер) — это НЕ тот Александр. 3 — только про нужного Александра, со ссылками; 0 — мусор/чужие.`,
    `Вопрос: ${question}\nОтвет: ${answer}`,
    { json: true, maxTokens: 200 },
  );
  return parseJsonLoose<{ score: number }>(r.text)?.score ?? -1;
}
const avg = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100;

async function repeat(label: string, cfg: Partial<AgentConfig>): Promise<void> {
  const qs: number[] = [];
  const leak: number[] = [];
  const calls: number[] = [];
  const ms: number[] = [];
  for (let i = 0; i < N; i++) {
    const r = await runAgent(AGG, cfg);
    qs.push(await judge(AGG, r.text));
    leak.push(r.usedBlockIds.filter((id) => id.startsWith('n_')).length);
    calls.push(r.llmCalls);
    ms.push(r.totalMs);
  }
  process.stdout.write(
    `${label.padEnd(14)} кач=${avg(qs)} (${qs.join('/')})  ШУМ-в-ссылках=${avg(leak)} (${leak.join('/')})  выз=${avg(calls)}  мс=${Math.round(avg(ms))}\n`,
  );
}

async function main(): Promise<void> {
  process.stdout.write(`### ЭКСП 5c — РЕРАНК на ЗАШУМЛЁННОМ пуле ×${N} (DeepSeek, +5 шум-блоков: однофамильцы/чужие темы)\n`);
  process.stdout.write('Цель: доказать, удаляет ли реранк посторонние блоки (ШУМ-в-ссылках должен быть ~0 при ON и >0 при OFF, если шум протекает)\n');
  await repeat('rerank ON', { models: 'deepseek', rerank: true });
  await repeat('rerank OFF', { models: 'deepseek', rerank: false });
  process.stdout.write('\n══ раунд 3 отработан ══\n');
}

main().catch((e) => {
  process.stderr.write(String(e) + '\n');
  process.exit(1);
});
