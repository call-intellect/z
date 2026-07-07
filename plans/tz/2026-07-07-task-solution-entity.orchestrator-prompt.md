# Промпт для агента: реализация сущности «Решение задачи» (TaskSolution)

> Готовый брифинг для СВЕЖЕГО агента (новый контекст). Скопируй целиком как задачу.
> Ты реализуешь новую сущность памяти компании — **«Решение задачи»** — фаза за фазой по готовому ТЗ.
> Ведёшь как оркестратор-разработчик (скилл `tz-orchestrator`): картография → промпты кодерам → своя
> приёмка (typecheck/lint/build/тесты) → коммит по фазам. Push — только по подтверждению владельца.

---

## Что строишь (в двух словах)

Когда сотрудник решает задачу, он рассказывает «как решал» (после закрытия по опросу ИЛИ в течение дня в
чате/чек-ине). Сейчас это **растворяется в клоне**. Нужно **дополнительно** материализовать это отдельной
просматриваемой сущностью **`TaskSolution`** `{название задачи · описание · как решалась · исполнитель-владелец
· ссылка на задачу}`, собирать её **суточным сводом**, показывать **отдельной вкладкой «Решения задач»** рядом с
регламентами. Клон при этом кормится как раньше (двойное назначение).

## 📌 Прямые пути

| Артефакт | Путь |
|---|---|
| **ТЗ (контракт, фазы Ф1–Ф7)** | `plans/tz/2026-07-07-task-solution-entity.md` |
| **Архитектура (человеческим языком, макеты)** | `plans/architecture/2026-07-07-task-solution-entity.md` |
| Стенд-проверка (ось A5) | `plans/tz/2026-07-03-regulation-instruction-stand.md` + `docs/testing/regulation-stand-agent-prompt.md` |

## Заперто (решения владельца — не пересматривать)
1. **Отдельная сущность** `TaskSolution` (не 6-й вид регламента).
2. **Двойное назначение** — материализуем И продолжаем кормить клон (поведение клона НЕ меняем).
3. **Без слияния** дублей; повтор способа ×N → **кандидат в Инструкцию** (флаг+ссылка, без авто-создания).
4. **Точка входа — суточная сборка** (крон): сигналы дня (ответ опроса `task.method_capture` + дневные
   упоминания) копятся → раз в сутки собирается/дополняется одна сущность на задачу.
5. **Владение всегда** — владелец = **исполнитель** (решавший), не упомянувший; растёт его клон (ось A4).
6. **Вкладка «Решения задач»** рядом с Регламенты/Инструкции/Политики/Процессы.

## Ключевые инварианты (проверяй на приёмке каждой фазы)
- сущность создаётся только при **содержательном** «как решалось» (нет ответа/тривиальное под гейтом → не плодим);
- **одна задача → одна `TaskSolution`** (`@@unique([tenantId, sourceIssueId])`, суточная сборка апдейтит, не дробит);
- **владелец = решавший** (не упомянувший) — anti-cross-clone;
- **идемпотентность** суточной сборки (повторный прогон Δ=0);
- клон кормится как раньше — **снапшоты/тесты клона зелёные** (поведение не изменилось).

## Код-якоря (досверяйся по символу — строки дрейфуют)
- `backend/src/modules/tracker/services/issues.service.ts` — `maybeRaiseMethodCaptureProbe` (сигнал закрытия задачи).
- `backend/src/modules/probe/probe-response.handler.ts` — `maybeApplyMethodCaptureAnswer` (ответ опроса → блоки).
- `backend/src/modules/knowledge-core/constants/skill-signal-types.ts` — `reasoning`/`methodology_step` (кормят клон; они же вход `TaskSolution`).
- `backend/src/modules/knowledge-core/services/structured-document-compiler.service.ts` — **переиспользуй** для сборки `solutionMd` (режим СОЗДАНИЕ/ДОПОЛНЕНИЕ, старое сохраняется).
- `backend/src/modules/knowledge-core/workers/operations-daily-digest.cron.ts` — образец суточного крона (`@Cron`, `timeZone: 'Europe/Moscow'`).
- `backend/src/modules/regulations/*` + `frontend/{src/api/regulations.api.ts, src/domain/regulation.ts, app/(authenticated)/regulations/RegulationsListClient.tsx}` — образец витрины (API + слои ApiDto→Domain→Ui + список/карточка/вкладки).

## Фазы (из ТЗ §8 — веди по ним)
1. **Данные:** модель `TaskSolution` (schema.prisma) + миграция `task_solution` + `CardVersion.resourceType='task_solution'` + HNSW-индекс embedding в `postgres-init.sql`. `prisma:generate`/typecheck зелёные.
2. **Сборка:** `TaskSolutionService` + `task-solution-build.cron` (суточный) + компилятор-режим «решение задачи» + резолв владельца (исполнитель) + гейт содержательности. Юнит + integration (prefixed/safe).
3. **Повтор→кандидат:** кластеризация по embedding + `repeatGroupKey` + флаг кандидата в инструкцию (без авто-создания).
4. **API:** контроллер `api/v1/task-solutions` + Zod-DTO + Swagger (list/summary/detail/sources/history/confirm/delete/restore).
5. **Frontend:** `src/api/task-solutions.api.ts` + `src/domain/task-solution.ts` + вкладка/страница «Решения задач» + карточка (ссылка на задачу, история версий, бейдж «🔁 похожих ×N»).
6. **Крутилки/флаг/деплой:** AdminSetting (`taskSolution.*`) + kill-switch `aiFeatures.taskSolutionEnabled` (ON, ship-on) + сид + `apply-prod-deploy.ts STEPS` + `prod-deploy-log` (Шаги 4/5/7/12) + реестр флагов.
7. **second-brain:** data-model / module-map / ai-jobs / workers-queues / api-layer / frontend-pages.

## Правила репо (обязательно)
- Prisma: **файловая миграция** (`bun run prisma:migrate -- --name task_solution`), не `db push`; ревью SQL.
- Крутилки — в **AdminSetting** через `getDynamic` + реестр + сид + UI-поле (не в ENV, не в коде).
- Скрипты: `createPrismaClient()` из `_lib/prisma.ts` (не голый `new PrismaClient()`); новые seed/patch → в `apply-prod-deploy.ts STEPS`.
- Без нарративных комментариев в коде (самодокументируемый код; знания — в `docs/`).
- Команды через `bun` из `backend/`/`frontend/`. Приёмка: `bun run typecheck && bun run lint && bun run build` (backend И frontend) + `test:unit`/`test:integration` зелёные.
- Коммит по фазам (`тип(область): описание`, Conventional Commits); коммить только своё; **push — только по явному подтверждению владельца**.

## Что вернуть
Реализованная сущность (Ф1–Ф7), все проверки зелёные, обновлённый second-brain + prod-deploy-log + реестр флагов,
рефлексия в `second-brain/05_история/`. Затем — стенд-агент гоняет **ось A5** (`regulation-stand-agent-prompt.md`),
чтобы подтвердить: сущность создаётся верно (владелец=решавший, одна на задачу, из дневных сигналов, повтор→кандидат).

## Acceptance (из ТЗ §9)
`TaskSolution` собирается суточным сводом (опрос + дневные упоминания), одна задача → одна сущность (идемпотентно);
владелец=исполнитель; нет ответа → не плодим; клон кормится как раньше (тесты зелёные); повтор→кандидат в инструкцию;
API + вкладка работают; флаг ON + крутилки в AdminSetting; миграция/индекс/сид в prod-deploy; typecheck/lint/build
(backend+frontend) зелёные; second-brain обновлён.
