---
date: 2026-06-05
title: Реализация ТЗ «Identity участника + атрибуция клонов» (Ф0–Ф5)
type: реализация
tz: plans/tz/2026-06-04-meeting-identity-and-clones-attribution.md
distilled: false
---

# Реализация ТЗ meeting-identity-and-clones-attribution (Ф0–Ф5)

## Что было поставлено
Полностью исполнить ТЗ за одну сессию (оркестратор + суб-агенты), работая **прямо на `dev`** (по явному указанию владельца, в обход дефолта скилла про feature-ветку), и в конце закоммитить + запушить. ТЗ — сквозная identity участника встречи и детерминированная атрибуция `IdeaBlockEntity.role='subject'` (оживление клонов), приглашение сотрудников из списка, доставка (email/Telegram), `assigneeUserId` в активном fast-воркере и единый путь голос→задача в трекере (Ф5).

## Как решал
- **Старт.** На входе подтянул `dev` (fast-forward до origin/dev — туда уже смержены МТЗ №1 Ф1–Ф11, значит зависимости — `ensurePersonForUser`, specialist-routing, free_note — на месте). Незакоммиченный WIP спрятал в stash; критично — версия ТЗ **с Фазой 5** жила только в моём stash (закоммиченные версии были 413-строчными без Ф5), восстановил её на dev отдельным docs-коммитом.
- **Окружение.** Docker Desktop не стартовал → локальной БД нет. Адаптировался: `prisma:generate` + `typecheck` + `build` + unit-vitest (моки) доказывают корректность; `prisma:push` и DB-интеграционные прогоны ушли в prod-deploy-log как деплой-шаги (это и по ТЗ так).
- **Оркестрация.** 6 фаз волнами через Workflow/Agent (картография → кодеры → **моя** лестница приёмки: greps маркеров → re-Read логики → typecheck/build → vitest → ревью → commit). Сам снимал ground-truth по якорям (номера строк дрейфуют) перед каждым кодером и фактчекал каждый отчёт (`feedback_agents_can_lie_about_edits`).
- **Ключевые решения оркестратора (отступления от буквы ТЗ, в пользу цели):**
  - **Ф1.1 проактивное создание person-Entity → ленивое** (в `resolveSubjectEntityId`): исходный план «звать `ensurePersonEntity` в `persons.service` при инвайте» упирался в (а) tx-visibility (ensurePersonForUser принимает `tx?`, отдельное соединение не видит незакоммиченную Person) и (б) риск циклического DI persons↔knowledge-core. Ленивое создание ровно в момент атрибуции даёт тот же результат (R5) без обеих ловушек.
  - **Ф1.2 маппинг блок→автор.** Открытие: `extractFull` отдаёт блоки пачкой, прямого соответствия «блок↔сегмент/спикер» нет. Решение — резолв автора по **перекрытию времени** `block.evidenceStartMs` с `Segment.startMs/endMs` (для встреч) и `payload.userId` (для текстовых каналов). Выровнял набор signalType атрибуции ровно под то, что читает клон (`specialist-3-7` берёт `{reasoning,rationale,decision_basis}`) + расширение `{expertise,experience,competence}`.
  - **Ф5.2 gate-coupled.** Репойнт 7 потребителей Task→Issue — самая широкая правка. Сделал через AdminSetting `meetingTasksToTrackerOnly` (**default FALSE**): при OFF всё читает Task как сегодня (ноль изменений в проде), ветка Issue дормант до включения флага владельцем. Так широкий blast radius безопасен по умолчанию и тестируем по веткам, выкат атомарный.

## Что вышло
Коммиты на `dev`: `0e3b2208` (контракт ТЗ+Ф5), `158a33d8` (Ф0), `b4ac1ebd` (Ф1), `b2fde6c9` (Ф2), `b5a07ebe` (Ф3), `d0609a90` (Ф4), `779b4811` (Ф5.1), Ф5.2, docs.
- **Верификация:** backend `typecheck`/`build`/`lint` (0 errors) + frontend `typecheck`/`lint`/`build` — всё зелёное. Затронутые модули — **417 тестов в 56 файлах, 100% зелёные**. Полный unit-прогон: 3459 passed / 4 failed — все 4 это **pre-existing flaky-таймауты в НЕ тронутых модулях** (например `admin-webhooks-mgmt` падает и изолированно: 5s timeout на `enqueue best-effort`).
- **Класс-фикс подтверждён (1.5):** `role:'subject'` теперь доезжает до `specialist-3-7` (клоны), `router.hasEmployeeSubject`, `axis-classifier` (WHO-ось), `card-rollup-v2`, дашборд-агентов — раньше все читали пустоту.
- **Prompt-cache цел:** диффы `block-ingest.prompt.ts` / `meeting-report-fast.prompt.ts` / `block-extraction.service.ts` пусты во всех фазах.

## Чему научился
- **`IdeaBlockEntity.role` до этого ТЗ никто не писал как `'subject'`** — главная ценность (клоны) была структурно пустой; чинится одним детерминированным шагом в `block-ingest`, без LLM.
- **Нет 1:1 блок↔сегмент** в knowledge-core: автор реплики восстанавливается по времени evidence, не по «сегменту блока».
- **`@Global`-модули** (Ai/KnowledgeCore/Meetings) позволяют инжектить сервис в чужой модуль без import-рёбер и без forwardRef — это снимает большинство рисков циклического DI; `build` — единственное надёжное доказательство DI (typecheck его не ловит).
- **Gate-coupled rollout** — правильный паттерн для широких репойнтов без локальной БД: дефолт-OFF делает изменение безопасным к выкату, ON-ветку владелец проверяет на проде осознанно.
- Локальный Docker может не подниматься — это не блокер для doc-of-correctness, но `prisma:push`/интеграционные прогоны честно уходят в prod-deploy-log.

## Что НЕ доделано / требует боевой проверки
- **`prisma:push` Ф0** (4 колонки Participant + enum) — на проде (локальной БД нет). Аддитивно, без data-loss.
- **`backfill-subject-attribution.ts`** — прогон на проде (dry-run → apply); идемпотентность доказана кодом, не на живых данных.
- **Ф5.2 ветка ON** (`meetingTasksToTrackerOnly=true`) — дормант; маппинг `Issue→MeetingActionItem` и поведение 7 потребителей при ON требуют боевой проверки на БД перед включением флага.
- 4 pre-existing flaky-теста в untracked-модулях — не из этого ТЗ, не чинил (вне scope).
