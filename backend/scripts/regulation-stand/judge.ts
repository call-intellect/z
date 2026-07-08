import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { directLlmCall } from '../_lib/llm-direct';

import { RUNS_DIR, loadA5Cases } from './corpus';
import type { A5Case, JudgeVote, JudgedScenario, RawRun, ScenarioObservation } from './types';

export const JUDGE_MODEL = 'deepseek-v4-pro';

const LENSES: Array<{ name: string; focus: string }> = [
  { name: 'суть-решения', focus: 'Схвачена ли СУТЬ решения (как реально решали задачу), без воды и без потери ключевых шагов.' },
  { name: 'владелец', focus: 'Владелец решения = тот, кто РЕШАЛ задачу, а не тот, кто рассказал/упомянул. Проверь атрибуцию.' },
  { name: 'полнота', focus: 'Полнота и отсутствие дублей: все соисполнители учтены, старое не потеряно при дополнении.' },
];

const SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    gistCaptured: { type: 'boolean', description: 'Суть решения схвачена верно' },
    ownerCorrect: { type: 'boolean', description: 'Владелец = решавший (не упомянувший)' },
    subjectsCorrect: { type: 'boolean', description: 'Субъекты (к чьим клонам растёт) корректны' },
    verdict: { type: 'string', enum: ['good', 'flawed', 'wrong'] },
    rationale: { type: 'string', description: 'Кратко, 1-2 предложения' },
  },
  required: ['gistCaptured', 'ownerCorrect', 'subjectsCorrect', 'verdict', 'rationale'],
};

function extractJson(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function buildUser(c: A5Case, obs: ScenarioObservation): string {
  const s = c.scenario;
  const signals = s.blocks
    .map((b) => `- (${b.signalType}) ${b.trustedAnswer}`)
    .join('\n');
  const sol = obs.solution;
  return [
    `ЗАДАЧА: ${s.requiresIssue?.title ?? '(без привязки к задаче)'}`,
    `ИСПОЛНИТЕЛЬ ЗАДАЧИ (assignee): ${s.requiresIssue?.assignee ?? '—'}`,
    '',
    'СИГНАЛЫ ДНЯ (как решали, по словам людей):',
    signals,
    '',
    'ЭТАЛОН (что ожидается):',
    `- суть: ${c.ruler.solutionGist ?? '(в эталоне не задана)'}`,
    `- владелец: ${c.ruler.owner ?? '—'}`,
    `- субъекты (клоны): ${(c.ruler.subjectPersons ?? []).join(', ') || '—'}`,
    '',
    'ФАКТИЧЕСКИ СОБРАННОЕ «Решение задачи» (TaskSolution):',
    sol
      ? `- владелец: ${sol.ownerPersonName ?? sol.ownerPersonId}\n- субъекты: ${sol.subjectPersonNames.join(', ') || '—'}\n- текст решения:\n${sol.solutionMd}`
      : '(решение НЕ создано)',
  ].join('\n');
}

const MAX_JUDGE_ATTEMPTS = 3;

function parseVote(argsRaw: string): Omit<JudgeVote, 'judge' | 'error'> | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(argsRaw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const verdict = parsed.verdict;
  if (verdict !== 'good' && verdict !== 'flawed' && verdict !== 'wrong') return null;
  if (
    typeof parsed.gistCaptured !== 'boolean' ||
    typeof parsed.ownerCorrect !== 'boolean' ||
    typeof parsed.subjectsCorrect !== 'boolean'
  ) {
    return null;
  }
  return {
    gistCaptured: parsed.gistCaptured,
    ownerCorrect: parsed.ownerCorrect,
    subjectsCorrect: parsed.subjectsCorrect,
    verdict,
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
  };
}

async function voteForLens(
  c: A5Case,
  obs: ScenarioObservation,
  lens: { name: string; focus: string },
): Promise<JudgeVote> {
  let lastErr = 'исчерпаны попытки';
  for (let attempt = 1; attempt <= MAX_JUDGE_ATTEMPTS; attempt += 1) {
    const res = await directLlmCall({
      provider: 'deepseek',
      model: JUDGE_MODEL,
      system: [
        'Ты — строгий судья качества сборки «Решения задачи» (TaskSolution) в системе памяти компании.',
        `Твоя линза внимания: ${lens.focus}`,
        'Оцени честно. Владелец решения ВСЕГДА тот, кто решал задачу (исполнитель), а не тот, кто про это рассказал.',
        'Владелец задачи — ВСЕГДА легитимный субъект своего решения (его клон растёт на его же задачах): subjects=[владелец] это НОРМА, не ошибка.',
        'subjectsCorrect=false ставь ТОЛЬКО если в субъектах есть ЛИШНИЙ человек (кто НЕ решал) ИЛИ пропущен явный со-исполнитель. Пустой эталон субъектов (—) НЕ означает «должно быть пусто».',
        'Верни строго структурированный результат через инструмент.',
      ].join(' '),
      user: buildUser(c, obs),
      schema: SCHEMA,
      schemaName: 'judge_task_solution',
      toolName: 'judge_task_solution',
      maxTokens: attempt === 1 ? 1600 : 2600,
    });
    if (res.error) {
      lastErr = res.error;
      continue;
    }
    const argsRaw = res.toolCallArgs ?? extractJson(res.text);
    if (!argsRaw) {
      lastErr = 'нет tool-call ответа';
      continue;
    }
    const parsed = parseVote(argsRaw);
    if (parsed) return { judge: lens.name, ...parsed, error: null };
    lastErr = 'невалидная структура ответа судьи';
  }
  return {
    judge: lens.name,
    gistCaptured: false,
    ownerCorrect: false,
    subjectsCorrect: false,
    verdict: 'wrong',
    rationale: '',
    error: lastErr,
  };
}

async function judgeOne(c: A5Case, obs: ScenarioObservation): Promise<JudgeVote[]> {
  const votes: JudgeVote[] = [];
  for (const lens of LENSES) {
    votes.push(await voteForLens(c, obs, lens));
  }
  return votes;
}

function majority(bools: boolean[]): boolean {
  const t = bools.filter(Boolean).length;
  return t * 2 > bools.length;
}

function consensus(votes: JudgeVote[]): JudgedScenario['consensus'] {
  const valid = votes.filter((v) => !v.error);
  if (valid.length < 2) return 'no-quorum';
  const counts: Record<'good' | 'flawed' | 'wrong', number> = { good: 0, flawed: 0, wrong: 0 };
  for (const v of valid) counts[v.verdict] += 1;
  const max = Math.max(counts.good, counts.flawed, counts.wrong);
  const leaders = (['good', 'flawed', 'wrong'] as const).filter((k) => counts[k] === max);
  if (leaders.length !== 1) return 'no-quorum';
  return leaders[0];
}

export async function runJudge(stamp: string): Promise<JudgedScenario[]> {
  const runDir = resolve(RUNS_DIR, stamp);
  const raw = JSON.parse(readFileSync(resolve(runDir, 'raw.json'), 'utf8')) as RawRun;
  const cases = loadA5Cases();
  const obsById = new Map<string, ScenarioObservation>();
  for (const o of raw.observations) obsById.set(o.scenarioId, o);

  const results: JudgedScenario[] = [];
  for (const c of cases) {
    const obs = obsById.get(c.scenario.id);
    if (!obs || !obs.solution) continue;
    process.stdout.write(`judge: ${c.scenario.id} …\n`);
    const votes = await judgeOne(c, obs);
    results.push({
      scenarioId: c.scenario.id,
      votes,
      majorityGist: majority(votes.filter((v) => !v.error).map((v) => v.gistCaptured)),
      majorityOwner: majority(votes.filter((v) => !v.error).map((v) => v.ownerCorrect)),
      lostVotes: votes.filter((v) => v.error).length,
      consensus: consensus(votes),
    });
  }

  writeFileSync(resolve(runDir, 'judged.json'), JSON.stringify(results, null, 2), 'utf8');
  const calls = results.reduce((n, r) => n + r.votes.length, 0);
  const fails = results.reduce((n, r) => n + r.votes.filter((v) => v.error).length, 0);
  process.stdout.write(`✓ judge ${stamp}: сценариев ${results.length}, LLM-вызовов ${calls} (ошибок ${fails})\n`);
  return results;
}

if (require.main === module) {
  const stamp = process.argv[2];
  if (!stamp) throw new Error('judge: нужен stamp');
  runJudge(stamp)
    .then(() => process.exit(0))
    .catch((e: unknown) => {
      process.stderr.write(`judge FAIL: ${e instanceof Error ? e.stack : String(e)}\n`);
      process.exit(1);
    });
}
