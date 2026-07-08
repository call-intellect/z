---
date: 2026-07-07
title: "Стенд regulation-stand — ось A5 (Решения задач / TaskSolution): baseline снят"
tags: [testing, task-solution, knowledge-core, stand, baseline]
---

# regulation-stand ось A5 — baseline

## Что было поставлено

Владелец: «Прогон стенда (521 сценарий, ось A5) — docs/testing/regulation-stand-agent-prompt.md».
Сущность `TaskSolution` только что реализована (Фазы 1–7), корпус+эталон regulation-stand (521 сценарий)
готовы, из них 12 — ось A5 (Решения задач). Скриптов `backend/scripts/regulation-stand/` не было вообще
(существующий `task-stand` — про трекинг задач, не про `TaskSolution`). Задача: написать harness под A5,
прогнать, снять baseline качества материализатора `TaskSolutionBuildService`.

## Как решал

1. **Разведка (Bash find/grep + Read, vexp-хук блокирует Grep/Glob):** развёл путаницу `task-stand` vs
   ось A5; вычитал 12 A5-сценариев корпуса + эталоны; картографировал `TaskSolutionBuildService`
   (`task-solution-build.service.ts`) — детект how-solved сигналов по задаче → владелец=`Issue.assignee` →
   гейт по `minSignalChars` → upsert 1:1 по `sourceIssueId` → компилятор документа → эмбеддинг → репит-группа.
2. **Развилка вынесена владельцу** (AskUserQuestion, RU): синтез блоков vs полный LLM-пайплайн.
   Выбран **синтез блоков** — детерминированно, изолирует именно билдер решений (ось A1-классификация
   тестируется отдельно).
3. **Harness** `backend/scripts/regulation-stand/`: `stand.ts` (диспетчер) · `seed-reg-feed.ts`
   (prepare: throwaway-тенант + 4 персоны + конфиг; build: посев Issue через `IssuesService` +
   how-solved `IdeaBlock`+`IdeaBlockEvidence`+`RawEvent.payload.contextCardId` → 3 прохода
   create→extend→idempotency реального `runForOrg`) · `match.ts` (детерминированная сверка ↔ эталон) ·
   `judge.ts` (панель 3 LLM-судей) · `report.ts` (scorecard + атрибуция) · `corpus.ts`/`types.ts`.
   Переиспользовал `_lib/combat-harness` (assertNotProd, bootstrap) и `_lib/llm-direct` (deepseek).

## Что вышло

- `typecheck`/`lint` — зелёные. Прод не тронут (локальная z_main, `assertNotProd`).
- **Baseline (HEAD после Фазы 6 TaskSolution): PASS 9 · FAIL 2 · N/A 1**, идемпотентность Δ=0 (3-й проход
  created=0/updated=0). Отчёт — `docs/testing/regulation-stand-report.md`.
- **Сильная сторона подтверждена:** `owner_is_solver` и `no_cross_clone_leak` держатся **структурно** —
  владелец = `Issue.assignee`, рассказавший/упомянувший (Сергей/Дарья в тексте блока) владельцем не
  становится. Это ровно свойство оси A4, и оно работает.
- **Два реальных дефекта материализатора (атрибуция A5):**
  1. `a5-no-answer` — гейт материализации по ДЛИНЕ сигнала (`minSignalChars=40`), не по содержательности:
     «Да фигня, само решилось» (45 симв) породило пустое решение из `[требует уточнения]`.
  2. `a5-multi-solver` — `personSubjectIds` всегда `[owner]`; соисполнитель (текст решения его знает:
     «Иван — сеть, Михаил — стораджи») в субъекты не попадает → его клон не растёт.
- `a5-extend-daily` PASS — компилятор-дополнение сохранил «ночной дамп»+«S3» и добавил «проверка
  восстановления» (версия 2, оба блока).
- `repeat_candidate` — N/A: локально нет таблицы `embedding_providers` → эмбеддинги `TaskSolution` не
  пишутся → репит-группа не тестируема.
- Всё занесено: ТЗ (статус оси A5), реестр не-сделанного (2 дефекта + 2 ограничения), README стенда.

## Чему научился

- **`RawEventProcessingStatus` = `received | ingested | failed`** (НЕ `processed`) — синтез RawEvent падал
  `PrismaClientValidationError`. Занёс в code-pitfalls-кандидаты.
- **`IdeaBlock` партиционирован — `@@id([id, tenantId])`;** синтез блока идёт через prisma напрямую
  (id авто-cuid), evidence через составной FK `[blockId, tenantId]`.
- **Детект решения-задачи** завязан на `RawEvent.payload->>'contextCardId' = issueId` — синтетический блок
  обязан нести это поле, иначе не дойдёт до билдера (это и проверяет `a5-no-issue-link`).
- **LLM-судья с tool-call:** `maxTokens=700` обрезает JSON («Unterminated string»), а `tool_choice='auto'`
  у deepseek иногда отвечает текстом мимо тула — поднял до 1600 + фолбэк `extractJson(text)`. Детерминированный
  match — авторитетный источник, судья — вторичная смысловая сверка.
- **owner=assignee — сильный дизайн:** он бесплатно даёт `owner_is_solver` и anti-cross-clone; дефекты
  оказались НЕ в атрибуции владельца, а в (а) слабом гейте материализации и (б) неполном росте субъектов.
