import { runAgent, type AgentResult } from './agent';

interface Scenario {
  name: string;
  question: string;
  check: (r: AgentResult) => { pass: boolean; why: string };
}

function routeInfo(r: AgentResult): { complexity?: string; clarifyNeeded?: boolean } {
  const t = r.trace.find((s) => s.stage === 'route');
  return (t?.info as { complexity?: string; clarifyNeeded?: boolean }) ?? {};
}
function planSteps(r: AgentResult): number {
  const t = r.trace.find((s) => s.stage === 'plan');
  return Array.isArray(t?.info) ? (t!.info as unknown[]).length : 0;
}
const saysNotFound = (t: string) => /не наш|не найден|нет (данных|информаци)|не зафиксир/i.test(t);

const SCENARIOS: Scenario[] = [
  {
    name: 'S1 простой вопрос → один заход, без плана, без переспроса',
    question: 'Когда была встреча с Александром?',
    check: (r) => {
      const ok = r.kind === 'answer' && routeInfo(r).clarifyNeeded === false;
      return { pass: ok, why: `kind=${r.kind} complexity=${routeInfo(r).complexity} clarify=${routeInfo(r).clarifyNeeded}` };
    },
  },
  {
    name: 'S2 агрегат → план ≥2 шагов, без переспроса, ответ со ссылками',
    question: 'По всем встречам с Александром собери список его болей, проблем и возражений',
    check: (r) => {
      const ok = r.kind === 'answer' && routeInfo(r).complexity === 'iterative' && planSteps(r) >= 2 && r.usedBlockIds.length >= 2;
      return { pass: ok, why: `kind=${r.kind} planSteps=${planSteps(r)} cites=${r.usedBlockIds.length}` };
    },
  },
  {
    name: 'S3 нет данных → честный отказ, НЕ ложное «готово»',
    question: 'Какая была суть совместного созвона Насти и Айназ?',
    check: (r) => {
      const honest = r.kind === 'abstain' || saysNotFound(r.text);
      const noFabricatedJoint = !/состоялся|прошёл|на созвоне насти и айназ обсуд/i.test(r.text);
      return { pass: honest && noFabricatedJoint, why: `kind=${r.kind} honest=${honest} noFabrication=${noFabricatedJoint}` };
    },
  },
  {
    name: 'S4 понятный вопрос про Айназ → не переспрашивает',
    question: 'Что известно про задачу создать видео-встречу у Айназ?',
    check: (r) => {
      const ok = r.kind !== 'clarify' && routeInfo(r).clarifyNeeded === false;
      return { pass: ok, why: `kind=${r.kind} clarify=${routeInfo(r).clarifyNeeded}` };
    },
  },
];

async function main(): Promise<void> {
  let passed = 0;
  for (const sc of SCENARIOS) {
    process.stdout.write(`\n━━ ${sc.name}\n   ❓ ${sc.question}\n`);
    try {
      const r = await runAgent(sc.question);
      const v = sc.check(r);
      if (v.pass) passed++;
      process.stdout.write(`   ${v.pass ? '✅ PASS' : '❌ FAIL'} — ${v.why} · ${r.llmCalls} вызовов · ${r.totalMs}ms\n`);
      process.stdout.write(`   💬 ${r.text.replace(/\n+/g, ' ').slice(0, 240)}\n`);
    } catch (e) {
      process.stdout.write(`   ❌ ERROR — ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }
  process.stdout.write(`\n${'═'.repeat(70)}\nИТОГ: ${passed}/${SCENARIOS.length} сценариев PASS\n`);
  process.exit(passed === SCENARIOS.length ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(String(e) + '\n');
  process.exit(1);
});
