---
---

# 2026-06-16 — Клоны M5: «один человек = один клон должности» + ревизия 12 промптов + 21 баг конвейера

## Что было поставлено

Реализовать ТЗ [`plans/tz/2026-06-16-clone-agents-prompt-revision.md`](../../plans/tz/2026-06-16-clone-agents-prompt-revision.md) целиком в ветке `devsv`:

- **Раздел 7 (решение владельца) — модель носителей клона «один человек = один клон должности».** Клон роли = снимок ОДНОГО текущего носителя должности (без агрегации нескольких людей); прошлый носитель замораживается (`PersonaStatus.frozen`, read-only) и остаётся доступным навсегда; имя — «Клон <Должность> v<N>» без ФИО; новая под-фича «совет бывших» (ask-all-formers). И8: это НЕ персональные данные, 152-ФЗ к модели не применяем.
- **Раздел 8 — аудит логики кода M5: 21 баг конвейера** (застой `pending_verification`, голодание verify, дрейф `traitCount`, коллизия имени концепта, confidence не из дат, бюджеты кронов, версионирование персоны) + код-гарды Г1–Г4.
- **Приложения A–D — ревизия 12 LLM-промптов клона** (якорь смысла «клон отвечает от лица должности» + few-shot + self-check, всё в стабильный cache-friendly SYSTEM).

## Как решал

- **Worktree.** Работал в worktree `devsv` от `origin/dev`. Доказал diff'ом, что 84 невлитых COO-коммита параллельной сессии M5-зоны не трогают (разные файлы) → безопасно вести Раздел 7/8 здесь.
- **Ядро (фазы A→D) — сам.** Фаза A — схема: `PersonaStatus += frozen` отдельной миграцией (`20260616160000_add_frozen_persona_status`), partial-unique `executable_personas_one_active_per_role` в `postgres-init.sql` (self-skip по образцу `persons_tenant_email_active_uniq`, НЕ в Prisma-схему). Фаза B — `buildForRole` из единственного носителя + атомарный freeze + Redis-лок `persona:rebuild:role:<id>` (Б13). Фаза C — анонимизация имени (`publicName` вместо ФИО) + grounding-фикс Б20. Фаза D — `roleVersion` в `ask` + `askAllFormers` (бэкенд) и фронтенд (frozen-бейдж, спросить версию, совет бывших).
- **Раздел 8 — 4 параллельных агента** по непересекающимся файлам (конвейер черт / нормализация концептов / принципы роли / сборка персоны).
- **12 промптов — 4 агента** (по пачкам ТЗ).
- **Фронтенд — отдельный агент.**
- **Приёмка каждого агента:** полный typecheck (8GB heap) + тесты + lint + личное чтение diff; маркеры `[x]` в ТЗ не доверял — грепал факт в коде.

## Что вышло

- **9 коммитов** (`80ce250a..8168d915`).
- **677 unit-тестов зелёные**; backend + frontend typecheck 0 ошибок; lint 0.
- Фактически в коде подтверждено (грепом): enum `frozen`, миграция, partial-индекс с self-skip, эндпоинты `ask` (+`roleVersion`) и `ask-all-formers`, backfill в `apply-prod-deploy.ts STEPS`, фиксы кронов (orderBy+курсор, recomputeTraitCount, verify FIFO).

## Чему научился

- **Агенты не гоняют полный tsc** — ловил их типовые ошибки сам при приёмке (полный typecheck с 8GB heap обязателен, не доверять «зелёному» от агента).
- **Worktree без `node_modules`** — нужен `bun install` перед первой сборкой.
- **`vitest -u` переписывает ЧУЖИЕ снапшоты** окончаниями строк (CRLF/LF) — стейджить только свои `.snap`, остальные `__snapshots__/*.snap` не трогать (шум в `git status` остался — не коммитить).
- **`recomputeTraitCount` — кросс-агентная развилка**: Б6 (traitCount=COUNT(active)) затрагивал и нормализатор, и сервис концептов — единый источник подключил сам, чтобы агенты не разъехались.
- **Postgres `ALTER TYPE ... ADD VALUE`** — обязательно отдельной миграцией от использования значения (нельзя в одной транзакции).
- **Partial-unique → `postgres-init.sql` с self-skip, не Prisma-схема** — Prisma не умеет partial-индексы с `WHERE`, а наивный `@@unique` на NULL-`profileId` для `scope='role'` не конфликтует (NULL≠NULL в Postgres) — отсюда корень гонки Б13.
- **Раздел 7 ПЕРЕОПРЕДЕЛЯЕТ часть Раздела 8** (кластер версионирования Б12/Б16/Б17): читать решение владельца ПЕРЕД фиксами — иначе сделал бы «дописать поля в агрегат», которого больше нет.

## Связи

- ТЗ: [`plans/tz/2026-06-16-clone-agents-prompt-revision.md`](../../plans/tz/2026-06-16-clone-agents-prompt-revision.md)
- Модуль: [[../01_projects/skill-and-clone]] §«Доработки 2026-06-16», [[../02_architecture/agent-modules]] §M5
- Схема: [[../02_architecture/data-model]] §«PersonaStatus += frozen»
- Эндпоинты: [[../01_projects/api-layer]] §Clones, [[../02_architecture/module-map]]
- Кроны/jobs: [[../01_projects/ai-jobs]], [[../01_projects/workers-queues]]
- Прод: [`docs/operations/prod-deploy-log.md`](../../docs/operations/prod-deploy-log.md) §«2026-06-16 — Один человек = один клон должности»
- Открытые пробелы: [[../04_не-сделано/README]] (role-scope staleness-watcher; per-version conversation)
