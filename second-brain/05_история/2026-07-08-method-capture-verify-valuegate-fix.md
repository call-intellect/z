---
title: Верификация probe-пути «как решал» + фикс value-гейта
date: 2026-07-08
distilled: false
tags: [task-solution, probe, method-capture, verification, value-gate, regulation-stand]
---

# Верификация probe-пути «как решал» после закрытия + фикс value-гейта

## Что было поставлено

После реализации ТЗ по дефектам `TaskSolution` владелец поправил меня по одному
пункту, который я записал в `04_не-сделано` как «дыру»:

> «Когда задача закрыта, у нас наоборот срабатывает агент, который приходит и
> спрашивает: „Расскажи, как ты решал эту задачу?" Это должно записываться.
> Надо перепроверить.»

Я утверждал, что «рассказ о решении УЖЕ закрытой задачи не материализуется»
(retro-after-close gap). Владелец сказал — это основной задуманный поток, а не дыра.

## Как решал

1. **Прямое чтение кода** нашло агента-опросник: probe `task.method_capture`
   (`issues.service.ts:1483` `maybeRaiseMethodCaptureProbe`, триггер из `update`/
   `transitionState` при `completed && !completedAt`), payload `contextCardId=issue.id`,
   ответ ингестится с `signalTypeHint='reasoning'` (`probe-response.handler.ts:147`).
   Моя детекция (`detectCandidateIssueIds` arm-1) ловит блок по `contextCardId=issue.id`,
   `buildOne` грузит задачу без фильтра статуса → **закрытая задача материализуется**.
2. **Workflow-верификация** `verify-method-capture-debrief` (T1/T2/T4 + 2 состязательных
   скептика): оба скептика НЕ смогли опровергнуть — цепочка цела end-to-end. Моя заметка
   была неверна: я перепутал probe-арм (основной путь, работает на закрытых) с
   closure-петлёй (`TaskCompletionHandler`, `openOnly:true` — ДРУГОЙ механизм, детекция
   сигнала «сделано» из встреч/чата). Заметку исправил.
3. **T4 вскрыл дыру в тестировании**: e2e-стенд гонял только closure-candidate-арм
   (`e2e.ts:225` дословно «а не по probe») → основной поток владельца был доказан лишь
   чтением кода, не прогоном. Добавил сценарий **P1** (`scenarioMethodCaptureProbe`):
   реальный `issues.transitionToCategory('completed')` → poll dispatched probe →
   `conv.respondToProbe` → poll RawEvent по `resp:<notifId>` → block-ingest → материализатор.
4. **Прогон P1 вскрыл реальный дефект продукта**: во 2-м заходе опросник получил
   `dropped_low_value` — недетерминированный LLM value-гейт диспетчера
   (`formulation.gate`, `probe-dispatcher.worker.ts:208`) отбраковал опросник, хотя задача
   прошла детерминированный порог сложности. То есть основной поток захвата спорадически
   душился ещё до отправки человеку. **Фикс**: вывел `task.method_capture` из-под value-гейта
   (`gate()` → `method_capture_complexity_gated`) — он уже прошёл `computeMethodCaptureComplexity ≥ 0.5`.

## Что вышло

- e2e-стенд **P1 9/9 PASS** при value-гейте на реальном дефолте (ON): опросник
  `dispatched`, ответ→RawEvent с `contextCardId`+`hint=reasoning`, канонический reasoning-блок,
  `TaskSolution` для `closed=true` задачи, owner выведен.
- Юнит `probe-formulation.service.spec.ts` **16/16** (новый тест: `method_capture` →
  `ask=true` без LLM при `valueGateEnabled=true`).
- typecheck + lint изменённых файлов — зелёные.
- Исправлена ложная заметка в `04_не-сделано`; карта `task-closure-method-capture-flow`
  обновлена (пропуск value-гейта).
- Прод-код изменён точечно: `probe-formulation.service.ts` (exempt) — без миграций/seed/ENV.

## Чему научился

- **Не путать похожие механизмы.** probe-арм (`contextCardId`, работает на закрытых) и
  closure-петля (`openOnly`, детекция «сделано») — разные пути; я приписал ограничение
  одного всему захвату и записал несуществующую дыру. Цена — дезинформация в источнике правды.
- **«Зелёный стенд» ≠ «доказан нужный путь».** e2e гонял обходной арм, а основной поток
  владельца — нет (`e2e.ts:225`). Зелёный был честным, но не про то. Всегда сверять, что
  тест проверяет ИМЕННО заявленный сценарий.
- **Живой прогон вскрывает то, что чтение кода не видит.** Недетерминированный LLM value-гейт,
  душащий основной поток — это нашлось только запуском, не ревью. Ремесло проверяется прогоном.
- **Состязательная верификация ловит мои же ошибки** дешевле, чем прод. Два скептика,
  прошедшие по коду независимо, подтвердили правоту владельца и мою ошибку.

См. [[../04_не-сделано/README]] · карта [[../01_projects/task-closure-method-capture-flow]] ·
ТЗ-рефлексия [[2026-07-08-task-solution-real-defects]].
