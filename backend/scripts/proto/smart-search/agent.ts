import { llm, parseJsonLoose, type Provider } from './llm';
import { naiveRetrieve, type Block, type Candidate } from './fixtures';
import { LoopGuard } from './loop-guard';

export interface AgentConfig {
  planMode: 'none' | 'rewoo' | 'classic';
  rerank: boolean;
  gate: boolean;
  models: 'deepseek' | 'hybrid';
  maxRefine: number;
}

export const DEFAULT_CFG: AgentConfig = {
  planMode: 'classic',
  rerank: true,
  gate: true,
  models: 'hybrid',
  maxRefine: 2,
};

function providers(cfg: AgentConfig): Record<'route' | 'plan' | 'rerank' | 'sufficiency' | 'synth' | 'ground', Provider> {
  const reason: Provider = cfg.models === 'hybrid' ? 'gpt5mini' : 'deepseek';
  return { route: reason, plan: reason, rerank: 'deepseek', sufficiency: 'deepseek', synth: reason, ground: 'deepseek' };
}

export interface TraceStep {
  stage: string;
  provider?: Provider;
  ms?: number;
  info: unknown;
}
export interface AgentResult {
  kind: 'answer' | 'clarify' | 'abstain';
  text: string;
  usedBlockIds: string[];
  trace: TraceStep[];
  llmCalls: number;
  totalMs: number;
  loopGuardHits: number;
}

function blockLines(bs: Block[]): string {
  return bs
    .map((b) => `[BLOCK:${b.id}] (${b.signalType}, встреча «${b.meetingTitle}», ${b.date}) ${b.title}: ${b.text}`)
    .join('\n');
}

const ROUTE_SYS = `Ты — диспетчер помощника по памяти компании. Не отвечай на вопрос, только классифицируй.
Верни JSON: {"needsSearch":bool,"complexity":"none|single|iterative","clarifyNeeded":bool,"clarifyQuestion":str,"assumedDefault":str}.
- complexity: "none" — болтовня/не про память; "single" — один факт/один заход; "iterative" — агрегат/многошаг ("по ВСЕМ встречам с X собрать возражения/боли").

ГЛАВНОЕ ПРАВИЛО ПЕРЕСПРОСА (строгое): по умолчанию clarifyNeeded=FALSE. Помощник ОБЯЗАН сначала попытаться ответить, взяв разумные умолчания, а не допрашивать пользователя.
- На любой ВОПРОС-ПОИСК (найди / расскажи / собери / сколько / какие / суть / по всем встречам) — НИКОГДА не переспрашивай. Умолчания: вся память компании; период — всё время; источники — все; имя без фамилии — искать как есть.
- Имя без фамилии — НЕ повод переспрашивать; несколько совпадений покажет сам поиск, ответ перечислит варианты ПОСЛЕ поиска.
- Период/источники по умолчанию — НЕ спрашивай никогда.
- clarifyNeeded=TRUE допустим ТОЛЬКО перед необратимым ДЕЙСТВИЕМ, меняющим данные (поставить/удалить/отменить задачу/встречу, отправить сообщение), и только если без параметра можно сделать НЕ ТО. Для чтения/поиска переспрос запрещён.
- Всегда заполняй assumedDefault. clarifyQuestion — только при clarifyNeeded=true.`;

const PLAN_SYS = `Ты — планировщик поиска по памяти. Разбей сложный вопрос на 2-4 последовательных шага.
Верни JSON: {"steps":[{"goal":str,"query":str}]}. Первый шаг — "найти все релевантные эпизоды/встречи по теме", дальше — извлечь нужное. query — короткая поисковая фраза.`;

const RERANK_SYS = `Ты — фильтр релевантности. Верни JSON: {"keep":["<id>"],"dropped":["<id>"]}. Оставляй ТОЛЬКО блоки по теме вопроса. id бери только из списка.`;

const SUFF_SYS = `Ты — судья достаточности. Верни JSON: {"sufficient":bool,"gaps":[str],"nextQuery":str}.
sufficient=true, если собранного хватает на полный честный ответ ИЛИ темы просто нет в памяти (ответим честно "не нашли"). Иначе gaps + ОДНА новая поисковая фраза в nextQuery.`;

const SYNTH_SYS = `Ты — Кора, помощник по памяти компании. Отвечай ТОЛЬКО по приведённым блокам, простым русским языком.
Каждый факт — с маркером [BLOCK:<id>]. Если в блоках НЕТ ответа — честно "В памяти компании я этого не нашёл", не выдумывай. Противоречия — назови оба и предложи уточнить. Без английских слов.`;

const GROUND_SYS = `Ты — контролёр заземления. Верни JSON: {"grounded":bool,"reason":str}.
grounded=false, если ответ утверждает факты, которых НЕТ в блоках, ИЛИ выдаёт "готово/сделано" без опоры. Честное "не нашёл" при отсутствии данных — grounded=true.`;

export async function runAgent(question: string, cfgIn: Partial<AgentConfig> = {}): Promise<AgentResult> {
  const cfg: AgentConfig = { ...DEFAULT_CFG, ...cfgIn };
  const P = providers(cfg);
  const t0 = Date.now();
  const trace: TraceStep[] = [];
  let calls = 0;
  const guard = new LoopGuard();
  const collected = new Map<string, Candidate>();

  const call = async (provider: Provider, sys: string, user: string, json = true, maxTokens = 900) => {
    calls++;
    return llm(provider, sys, user, { json, maxTokens, effort: 'low' });
  };

  const rRoute = await call(P.route, ROUTE_SYS, `Вопрос пользователя: ${question}`);
  const route = parseJsonLoose<{ needsSearch: boolean; complexity: string; clarifyNeeded: boolean; clarifyQuestion: string; assumedDefault: string }>(rRoute.text)
    ?? { needsSearch: true, complexity: 'single', clarifyNeeded: false, clarifyQuestion: '', assumedDefault: '' };
  trace.push({ stage: 'route', provider: P.route, ms: rRoute.ms, info: route });
  if (route.clarifyNeeded && route.clarifyQuestion.trim()) {
    return { kind: 'clarify', text: route.clarifyQuestion.trim(), usedBlockIds: [], trace, llmCalls: calls, totalMs: Date.now() - t0, loopGuardHits: guard.hitCount };
  }

  let steps: Array<{ goal: string; query: string }>;
  if (cfg.planMode !== 'none' && route.complexity === 'iterative') {
    const rPlan = await call(P.plan, PLAN_SYS, `Вопрос: ${question}`);
    const plan = parseJsonLoose<{ steps: Array<{ goal: string; query: string }> }>(rPlan.text);
    steps = plan?.steps?.length ? plan.steps.slice(0, 4) : [{ goal: 'найти', query: question }];
    trace.push({ stage: 'plan', provider: P.plan, ms: rPlan.ms, info: { mode: cfg.planMode, steps } });
  } else {
    steps = [{ goal: 'найти', query: question }];
    trace.push({ stage: 'plan', info: { mode: cfg.planMode, steps: 'single' } });
  }

  // rewoo: исполняем шаги как есть, без переформулировки (maxRefine=0); classic/none: с переформулировкой по достаточности
  const refineBudget = cfg.planMode === 'rewoo' ? 0 : cfg.maxRefine;

  for (const step of steps) {
    let query = step.query;
    for (let refine = 0; refine <= refineBudget; refine++) {
      if (!guard.firstTime(query)) {
        trace.push({ stage: 'loop-guard', info: `повтор «${query}» — стоп` });
        break;
      }
      const cands = naiveRetrieve(query, 8);
      trace.push({ stage: 'retrieve', info: { query, found: cands.map((c) => c.id) } });
      if (cands.length === 0) break;

      let kept: Candidate[];
      if (cfg.rerank) {
        const rRer = await call(P.rerank, RERANK_SYS, `Вопрос: ${question}\nКандидаты:\n${blockLines(cands)}`);
        const rer = parseJsonLoose<{ keep: string[]; dropped: string[] }>(rRer.text) ?? { keep: cands.map((c) => c.id), dropped: [] };
        kept = cands.filter((c) => rer.keep.includes(c.id));
        trace.push({ stage: 'rerank', provider: P.rerank, ms: rRer.ms, info: { keep: rer.keep, dropped: rer.dropped } });
      } else {
        kept = cands;
        trace.push({ stage: 'rerank', info: 'OFF (все кандидаты)' });
      }
      for (const k of kept) collected.set(k.id, k);

      if (refineBudget === 0) break;
      const pool = [...collected.values()];
      const rSuf = await call(P.sufficiency, SUFF_SYS, `Вопрос: ${question}\nСобрано:\n${blockLines(pool)}`);
      const suf = parseJsonLoose<{ sufficient: boolean; gaps: string[]; nextQuery: string }>(rSuf.text) ?? { sufficient: true, gaps: [], nextQuery: '' };
      trace.push({ stage: 'sufficiency', provider: P.sufficiency, ms: rSuf.ms, info: suf });
      if (suf.sufficient || !suf.nextQuery?.trim() || refine === refineBudget) break;
      query = suf.nextQuery.trim();
    }
  }

  const pool = [...collected.values()];
  const rSyn = await call(P.synth, SYNTH_SYS, `Вопрос: ${question}\n\nБлоки памяти:\n${pool.length ? blockLines(pool) : '(ничего не найдено)'}`, false, 1100);
  let answer = rSyn.text.trim();
  trace.push({ stage: 'synth', provider: P.synth, ms: rSyn.ms, info: answer.slice(0, 160) });

  let kind: AgentResult['kind'] = 'answer';
  if (cfg.gate) {
    const rGr = await call(P.ground, GROUND_SYS, `Вопрос: ${question}\nОтвет помощника: ${answer}\nБлоки:\n${pool.length ? blockLines(pool) : '(пусто)'}`);
    const gr = parseJsonLoose<{ grounded: boolean; reason: string }>(rGr.text) ?? { grounded: true, reason: '' };
    trace.push({ stage: 'groundedness', provider: P.ground, ms: rGr.ms, info: gr });
    if (!gr.grounded) {
      kind = 'abstain';
      answer = 'В памяти компании я этого не нашёл — не хочу выдумывать. Уточните формулировку или назовите конкретную встречу, и я поищу снова.';
    }
  } else {
    trace.push({ stage: 'groundedness', info: 'OFF' });
  }

  const usedBlockIds = [...answer.matchAll(/\[BLOCK:([a-z0-9_]+)\]/gi)].map((m) => m[1]!);
  return { kind, text: answer, usedBlockIds, trace, llmCalls: calls, totalMs: Date.now() - t0, loopGuardHits: guard.hitCount };
}
