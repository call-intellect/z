---
type: tz
status: ready-to-implement
feature: retrieval-base-recall-floor
date: 2026-07-04
owner: sergrv (recall-to-99)
relates_to:
  - plans/architecture/2026-07-04-retrieval-base-recall-floor.md
---
> Архитектура (одобрена владельцем): `plans/architecture/2026-07-04-retrieval-base-recall-floor.md` · доказано 7 диагностиками на «Стреле».

# ТЗ: детерминированный base-query recall-floor в chat-v2 retrieval

## Цель
Убрать недетерминированный обвал retrieval-пула (30→1–4) за счёт всегда-присутствующего детерминированного
базового подъёма сырого вопроса. Доказанный лифт покрытия контекста: 61% → 91% на провальных вопросах.

## REALITY-CHECK (по факту кода)
- `backend/src/modules/knowledge-core/services/chat-v2.service.ts` — метод `runRetrieval` (≈стр. 1310–1443,
  якорь: `const [semanticSettled, structuralSettled] = await Promise.allSettled([`). Здесь фьюзятся
  `semantic` (multi-query, дробит бюджет) и `structural` маршруты в `merged` → rerank → kContext.
- `this.retrieval: ChatV2RetrievalService` доступен (инъекция ≈стр. 809). `fetchCandidates(input, trace)` —
  сигнатура в `chat-v2-retrieval.service.ts:253`, `RetrievalInput` :31.
- `kRetrieve`/`kContext` из `resolveKSplit()` (default 30/18). `rrfK`, `accessWhere`, `ctx.query`,
  `input.validAt` — в scope `runRetrieval`.
- `fuseRankedLists(lists, rrfK)` — уже используется для fusion.
- Крутилки резолвятся `this.cfg.getDynamic<T>(key, undefined, default)` (см. graphAlwaysExpand :870).

## Принятые решения владельца
| # | Решение | Обоснование |
|---|---|---|
| Р1 | Base = сырой `ctx.query`, `limit=kRetrieve`, `graphHops=0`, БЕЗ структурного фильтра (entityIds/dateFrom/signalTypes/themeBranches — не передавать), `entityLinkHops=0`, `graphCypherRecall=false` | Ровно эта конфигурация валидирована = 91% стабильно. Структурный фильтр и multi-query — виновники обвала, base их обходит. |
| Р2 | Union через `fuseRankedLists` наравне с semantic/structural, ДО реранка | Union только ДОБАВЛЯЕТ; реранк+kContext сузят до 18 релевантных (точность). |
| Р3 | Kill-switch `knowledge.chatV2BaseRecallFloor` (bool, default **true** = Ship-On) | Аварийный рубильник; действий владельца не требует. |
| Р4 | Передавать `accessWhere` и `validAt` в base | Ф4-гейт доступа и bitemporal-корректность — не протащить закрытое/будущее. |

## Фаза 1 — base-recall-floor в runRetrieval (единственная)

**Ценность:** как сотрудник, задающий вопрос AI-чату, получаю стабильно полный контекст (не «пул=1 → не
нашёл» через раз), чтобы ответ был верным КАЖДЫЙ раз.

**Файл:** `backend/src/modules/knowledge-core/services/chat-v2.service.ts`, метод `runRetrieval`.

**Что сделать:**
1. Перед `const merged = ...` добавить резолв крутилки и base-подъём:
   ```ts
   const baseFloorEnabled = await this.cfg.getDynamic<boolean>(
     'knowledge.chatV2BaseRecallFloor', undefined, true,
   );
   let baseIds: string[] = [];
   if (baseFloorEnabled) {
     try {
       const baseRanked = await this.retrieval.fetchCandidates(
         {
           tenantId, scope, scopeId: scopeId ?? null,
           query,               // сырой ctx.query, НЕ reformulations
           limit: kRetrieve,
           graphHops: 0,
           graphAlwaysExpand: false,
           filterMode: 'boost',
           entityLinkHops: 0,
           graphCypherRecall: false,
           validAt: input.validAt ?? null,
           accessWhere,
         },
         trace,
       );
       baseIds = baseRanked.map((r) => r.blockId);
     } catch (err) {
       this.logger.warn(
         { err: err instanceof Error ? err.message : String(err) },
         'chat-v2 runRetrieval: base-recall-floor упал — fail-open (пул без base)',
       );
     }
   }
   ```
   `tenantId, scope, scopeId, query, accessWhere` — взять из `ctx` (проверить точные имена в scope
   `runRetrieval`; `ctx` содержит `tenantId, scope, scopeId, query, kRetrieve, accessWhere, graphHops...`).
2. Включить `baseIds` в fusion. Заменить построение `merged`:
   ```ts
   const lists: Array<Array<{ id: string }>> = [];
   if (structural.length > 0) lists.push(structural.map((id) => ({ id })));
   lists.push(semantic.map((id) => ({ id })));
   if (baseIds.length > 0) lists.push(baseIds.map((id) => ({ id })));
   const merged =
     lists.length > 1
       ? fuseRankedLists(lists, rrfK).slice(0, kRetrieve)
       : (lists[0] ?? []).map((x) => x.id).slice(0, kRetrieve);
   ```
   Сохранить существующую ветку `trace.setPool(...)` (обновить, чтобы использовала `merged`; fusionScores —
   пересчитать по тем же `lists` или оставить `?? 0`, косметика трейса).
3. Не менять сигнатуры, не добавлять комментарии в код (правило проекта).

**Крутилка (реестр + резолв):**
- `backend/src/modules/admin/settings/admin-setting-schema-registry.ts` — строка
  `['knowledge.chatV2BaseRecallFloor', BOOLEAN]` (взять существующий bool-хелпер, как у соседних
  `chatV2*` bool-настроек).
- Если для `getDynamic<boolean>` нужен code-fallback в `TypedConfigService` — НЕ обязателен (getDynamic
  принимает default 3-м арг). Достаточно записи в реестре + default `true` в вызове. Проверить паттерн
  соседних `knowledge.chatV2GraphAlwaysExpand` (тоже getDynamic с default, без ENV) — повторить.

**Acceptance (машинно):**
- `grep -n "chatV2BaseRecallFloor" chat-v2.service.ts admin-setting-schema-registry.ts` → есть в обоих.
- `bun run typecheck` · `bun run lint` · `bun run build` — зелёные.
- Существующие спеки retrieval зелёные: `bunx vitest run src/modules/knowledge-core/services/chat-v2-retrieval-adaptive-hops.spec.ts src/modules/knowledge-core/services/chat-v2-structural-fallback.spec.ts`.
- Новый спек (или расширение существующего): при `baseFloorEnabled=true` `fetchCandidates` вызывается с
  `limit=kRetrieve`, без структурных полей (entityIds undefined), `graphHops=0`; при `false` — не
  вызывается доп. проходом. Мок `retrieval.fetchCandidates`, проверить аргументы.
- **Замер на «Стреле»:** линейка ×3 ДО/ПОСЛЕ; CORRECT ↑, honest_empty галлюцинации = 0.

**Закрывает:** R1 (стабильный пул), R2 (recall-floor), R3 (kill-switch).

## Идемпотентность / флаг / prod
- Только код + крутилка. Миграций/seed/backfill НЕТ.
- prod-deploy-log Шаг 1 (крутилка в реестре — но это AdminSetting getDynamic, не ENV → строки в Шаг 1 не
  требуется, если нет ENV; отметить в реестре/seed админ-настроек при наличии сида settings).
- Ship-On: default true, выкат включённым.

## DoD
typecheck+lint+build зелёные, спеки зелёные, second-brain обновлён (knowledge-core.md — recall-floor),
рефлексия, prod-инструкция (prod-операций нет кроме сборки — фича чисто кодовая + admin-крутилка с
дефолтом). Замер ×3 приложен.

## Итог
Реализовано целиком. A/B на «Стреле» (gold-45 answerable, ×3, честный протокол — чистится `dlg:ans`+`dlg:ret`,
крутилка-переключатель):
- **CORRECT: floor OFF 74.8% → ON 80.0% (+5.2 п.п.)**, +PARTIAL 89.6→90.4%, **галлюцинации 0→0**.
- Атрибуция ПОСЛЕ: доля RETRIEVAL схлопнулась (осталось q088 отчёт + gold-артефакты q033 Telegram=Логистик,
  q092 «теряется»); остаток провалов теперь доминирует СИНТЕЗ (факт в контексте, ответ уронил) — чистый
  следующий рычаг.
- Приёмка: typecheck+lint+build зелёные; 33 спека (вкл. 4 base-floor: base-config, floor-off, temporal-skip,
  fail-open). Адверсариальное ревью (14 агентов) → 6 находок починены (temporal-guard против реинъекции
  superseded, параллелизм base∥semantic, fail-open, усиленный спек).
