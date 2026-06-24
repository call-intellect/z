import { z } from 'zod';

export const RAG_ROUTE_SYSTEM_PROMPT = `Ты — диспетчер помощника по памяти компании. Не отвечай на вопрос, только классифицируй.
Верни JSON: {"needsSearch":bool,"complexity":"none|single|iterative","clarifyNeeded":bool,"clarifyQuestion":str,"assumedDefault":str}.
- complexity: "none" — болтовня/не про память; "single" — один факт/один заход; "iterative" — агрегат/многошаг ("по ВСЕМ встречам с X собрать возражения/боли").

ГЛАВНОЕ ПРАВИЛО ПЕРЕСПРОСА (строгое): по умолчанию clarifyNeeded=FALSE. Помощник ОБЯЗАН сначала попытаться ответить, взяв разумные умолчания, а не допрашивать пользователя.
- На любой ВОПРОС-ПОИСК (найди / расскажи / собери / сколько / какие / суть / по всем встречам) — НИКОГДА не переспрашивай. Умолчания: вся память компании; период — всё время; источники — все; имя без фамилии — искать как есть.
- Имя без фамилии — НЕ повод переспрашивать; несколько совпадений покажет сам поиск, ответ перечислит варианты ПОСЛЕ поиска.
- Период/источники по умолчанию — НЕ спрашивай никогда.
- clarifyNeeded=TRUE допустим ТОЛЬКО перед необратимым ДЕЙСТВИЕМ, меняющим данные (поставить/удалить/отменить задачу/встречу, отправить сообщение), и только если без параметра можно сделать НЕ ТО. Для чтения/поиска переспрос запрещён.
- При сомнении в сложности — выбирай "single", не "none".
- Всегда заполняй assumedDefault. clarifyQuestion — только при clarifyNeeded=true.`;

export const RagRouteSchema = z.object({
  needsSearch: z.boolean(),
  complexity: z.enum(['none', 'single', 'iterative']),
  clarifyNeeded: z.boolean(),
  clarifyQuestion: z.string().default(''),
  assumedDefault: z.string().default(''),
});
export type RagRoute = z.infer<typeof RagRouteSchema>;

export function buildRagRouteUser(question: string): string {
  return `Вопрос пользователя: ${question}`;
}

export const RAG_PLAN_SYSTEM_PROMPT = `Ты — планировщик поиска по памяти. Разбей сложный вопрос на 2-4 последовательных шага.
Верни JSON: {"steps":[{"goal":str,"query":str}]}. Первый шаг — "найти все релевантные эпизоды/встречи по теме", дальше — извлечь нужное. query — короткая поисковая фраза.`;

export const RagPlanSchema = z.object({
  steps: z
    .array(z.object({ goal: z.string(), query: z.string() }))
    .min(1)
    .max(6),
});
export type RagPlan = z.infer<typeof RagPlanSchema>;

export function buildRagPlanUser(question: string): string {
  return `Вопрос: ${question}`;
}

export const RAG_RERANK_SYSTEM_PROMPT = `Ты — фильтр релевантности. Верни JSON: {"keep":["<id>"],"dropped":["<id>"]}. Оставляй ТОЛЬКО блоки по теме вопроса. id бери только из списка.`;

export const RagRerankSchema = z.object({
  keep: z.array(z.string()).default([]),
  dropped: z.array(z.string()).default([]),
});
export type RagRerank = z.infer<typeof RagRerankSchema>;

export function buildRagRerankUser(question: string, candidates: string): string {
  return `Вопрос: ${question}\nКандидаты:\n${candidates}`;
}

export const RAG_SUFFICIENCY_SYSTEM_PROMPT = `Ты — судья достаточности. Верни JSON: {"sufficient":bool,"gaps":[str],"nextQuery":str}.
sufficient=true, если собранного хватает на полный честный ответ ИЛИ темы просто нет в памяти (ответим честно "не нашли"). Иначе gaps + ОДНА новая поисковая фраза в nextQuery.`;

export const RagSufficiencySchema = z.object({
  sufficient: z.boolean(),
  gaps: z.array(z.string()).default([]),
  nextQuery: z.string().default(''),
});
export type RagSufficiency = z.infer<typeof RagSufficiencySchema>;

export function buildRagSufficiencyUser(question: string, collected: string): string {
  return `Вопрос: ${question}\nСобрано:\n${collected}`;
}

export const RAG_GROUNDEDNESS_SYSTEM_PROMPT = `Ты — контролёр заземления. Верни JSON: {"grounded":bool,"reason":str}.
grounded=false, если ответ утверждает факты, которых НЕТ в блоках, ИЛИ выдаёт "готово/сделано" без опоры. Честное "не нашёл" при отсутствии данных — grounded=true.`;

export const RagGroundednessSchema = z.object({
  grounded: z.boolean(),
  reason: z.string().default(''),
});
export type RagGroundedness = z.infer<typeof RagGroundednessSchema>;

export function buildRagGroundednessUser(
  question: string,
  answer: string,
  blocks: string,
): string {
  return `Вопрос: ${question}\nОтвет помощника: ${answer}\nБлоки:\n${blocks || '(пусто)'}`;
}
