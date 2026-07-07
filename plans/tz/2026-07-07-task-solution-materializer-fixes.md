---
type: tz
feature: task-solution-materializer-fixes
title: "TaskSolution — фиксы материализатора (гейт содержательности + рост клонов соисполнителей)"
status: done
date: 2026-07-07
owner: владелец (sergrv80@gmail.com)
baseline: docs/testing/regulation-stand-report.md (ось A5, итерация 0: PASS 9 · FAIL 2 · N/A 1)
code:
  - backend/src/modules/knowledge-core/services/task-solution-build.service.ts
  - backend/src/modules/knowledge-core/prompts/structured-document-compiler.prompt.ts
  - backend/src/modules/knowledge-core/services/entity-resolution.service.ts
  - backend/src/modules/ai/services/llm-router.service.ts
---

# ТЗ — фиксы материализатора «Решений задач» (цикл 1)

## 0. Контекст

Стенд `regulation-stand` ось A5 (итерация 0, HEAD `91013a1f`) снял baseline материализатора
`TaskSolutionBuildService`: **PASS 9 · FAIL 2 · N/A 1**. Два реальных дефекта:

1. **`a5-no-answer` FAIL** — материализация решается по ДЛИНЕ сигнала (`taskSolution.minSignalChars=40`),
   а не по содержательности. «Да фигня, само решилось, нечего рассказывать» (45 симв) породило «Решение
   задачи» из сплошных `[требует уточнения]`. Мусор в витрине решений и в клоне.
2. **`a5-multi-solver` FAIL** — `personSubjectIds` всегда `[ownerPersonId]`. При соисполнителях
   (текст решения знает: «Иван поднял сеть, Михаил — стораджи») второй решавший в субъекты не попадает →
   его клон по этому кейсу не растёт.

Сильные стороны (НЕ трогать, охранять от регресса): `owner_is_solver` и `no_cross_clone_leak` держатся
структурно (владелец = `Issue.assignee`; упомянувший владельцем не становится). Сценарии-сторожа:
`a5-ownership-solver` (Сергей рассказал → Михаил владелец), `a5-owner-not-mentioner` (Дарья рассказала →
Иван владелец) — после фикса они обязаны остаться PASS (subjects БЕЗ рассказавшего).

## 1. Решение (изолированно от общего компилятора)

Один точечный LLM-проход `task-solution-extract` по материалу задачи (issue.title + how-solved блоки),
возвращающий два сигнала. Общий `structured-document-compiler` НЕ трогаем (от него зависят оси A1–A3
регламентов — нулевой риск регресса).

Контракт прохода (tool `extract_task_solution`):
- `hasConcreteMethod: boolean` — есть ли в материале содержательное «как решалась задача».
  `false` для отписок («само решилось», «фигня», «нечего рассказывать», «не помню», «не знаю»).
  Смещение к ПОЛНОТЕ: любое конкретное действие/шаг → `true` (чтобы не терять реальные краткие решения).
- `solverNames: string[]` — имена тех, кто РЕАЛЬНО решал (делал работу), НЕ тех, кто рассказал/упомянул.
  Смещение к ТОЧНОСТИ: сомневаешься, решал ли человек, — не включай (защита `no_cross_clone_leak`).

## 2. Изменения в `TaskSolutionBuildService.buildOne`

Под аварийным рубильником `taskSolution.refineEnabled` (kill-switch, дефолт **ON**, `getDynamic` +
code-fallback `true`). OFF → текущее поведение (гейт по символам + subjects=[owner]).

Порядок (после сбора блоков и char-гейта, ДО дорогого компилятора):
1. `extract = await refiner.extract(issue.title, blocks)` (reuse taskType `compile-org-document` для
   маршрутизации — тот же домен/dataClass, без новой инфры роутера).
2. **Гейт содержательности:** если `refineEnabled && extract.ok && !extract.hasConcreteMethod` →
   вернуть новый outcome `skippedNoMethod` (не компилировать, не создавать, existing не трогать).
3. **Рост субъектов:** `subjectIds = union([ownerPersonId], resolveNames(extract.solverNames))`, где
   `resolveNames` — `EntityResolutionService.resolvePersonByHint(tenantId, name, context)` на каждое имя
   (null — игнор, не выдумываем). Owner всегда в списке. Ставить в `personSubjectIds` и при create,
   и при update (заменить `[ownerPersonId]` на `subjectIds`).
   - Деградация: `refineEnabled=false` ИЛИ `extract.ok=false` → `subjectIds=[ownerPersonId]` (как сейчас).

`TaskSolutionBuildStats` — добавить `skippedNoMethod`. Логировать в `runForOrg`.

## 3. Новый промпт `task-solution-extract.prompt.ts`

Рядом с `structured-document-compiler.prompt.ts`. Код-промпт (как компилятор), русский, tool-use:
- `EXTRACT_TASK_SOLUTION_TASK_TYPE = 'compile-org-document'` (переиспользуем route);
- tool `extract_task_solution` со схемой `{ hasConcreteMethod: boolean, solverNames: string[] }`;
- SYSTEM: «кто решал ≠ кто рассказал», «отписка → hasConcreteMethod=false», «сомнение в решателе → не включай».
- Сервис-обёртка `TaskSolutionRefinerService` (или метод в build-service) с fallback `{ok:false}` при сбое LLM.

## 4. Крутилка (реестр + сид + feature-flags)

- `taskSolution.refineEnabled` — kill-switch, bool, дефолт `true`. `admin-setting-schema-registry.ts` +
  сид + строка в `docs/operations/feature-flags.md` (тип: аварийный рубильник, состояние: ON).
- Стендовый прогон фиксирует фактическое значение (harness пинит `true` в prepare).

## 5. Фазы

- **Ф1** — промпт `task-solution-extract.prompt.ts` + сервис-обёртка (extract с fallback).
- **Ф2** — `buildOne`: гейт `skippedNoMethod` + рост subjects через resolvePersonByHint; статистика.
- **Ф3** — крутилка `refineEnabled` (registry + seed + feature-flags).
- **Ф4** — unit-тест build-service (гейт содержательности; union субъектов; отсутствие leak рассказавшего).
- **Ф5** — перепрогон стенда A5 (итерация 1) + сравнение было→стало в отчёте.

## 6. Acceptance

- [ ] `a5-no-answer` → `created=false` (PASS): отписка не материализуется.
- [ ] `a5-multi-solver` → `subjectPersons=[Иван,Михаил]` (PASS): соисполнитель в субъектах.
- [ ] `a5-ownership-solver` / `a5-owner-not-mentioner` остаются PASS (рассказавший НЕ в субъектах) — нет регресса `no_cross_clone_leak`.
- [ ] Остальные A5 не регрессируют; идемпотентность Δ=0 сохраняется.
- [ ] `refineEnabled=false` → поведение как в итерации 0 (обратимость рубильника).
- [ ] `typecheck/lint/build` зелёные; unit-тест build-service зелёный.
- [ ] Отчёт `regulation-stand-report.md` показывает было→стало (итерация 0 → 1).

## 7. Ловушки

- Компилятор общий — НЕ добавлять task_solution-поля в его схему (регресс осей A1–A3).
- `resolvePersonByHint` может вернуть owner повторно — дедуп через union.
- Экстрактор не должен включать рассказавшего в solverNames (иначе регресс `no_cross_clone_leak`) —
  сторожа `a5-ownership-solver`/`a5-owner-not-mentioner` в стенде ловят это.
- Гейт содержательности не должен резать реальные КРАТКИЕ решения (bias к hasConcreteMethod=true).
- Прод-путь — материализатор в проде; фикс shippable сразу ON (Ship-On) с рубильником.

## Итог
**Реализовано целиком (Ф1–Ф5).** Стенд A5 итерация 1 (свежий тенант, `refineEnabled=true`, реальный LLM):
**PASS 9 → 11 · FAIL 2 → 0 · N/A 1** (repeat — без эмбеддингов локально), идемпотентность Δ=0.
- `a5-no-answer` → `created=false` (гейт `hasConcreteMethod=false` на «Да фигня, само решилось»).
- `a5-multi-solver` → `subjects=[Иван,Михаил]` (клон соисполнителя растёт).
- Сторожа `no_cross_clone_leak` держатся: `a5-ownership-solver` subjects=[Михаил] (Сергей НЕ добавлен),
  `a5-owner-not-mentioner` subjects=[Иван] (Дарья НЕ добавлена) — реальный LLM отличил решавшего от рассказавшего.
Unit-тесты build-service 16/16 (5 новых: гейт, update-путь, fallback, union субъектов, нет утечки), typecheck/lint/build зелёные.
Файлы: `prompts/task-solution-extract.prompt.ts`, `services/task-solution-refiner.service.ts`,
`services/task-solution-build.service.ts` (гейт+subjects), модуль, крутилка `taskSolution.refineEnabled`.
Прод: seed `refineEnabled` через `seed-admin-setting-task-solution.ts` (`apply-prod-deploy --mode update`).
