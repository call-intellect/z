---
date: 2026-05-26
title: Единая prod-инструкция — docs/operations/prod-deploy-log.md
distilled: false
---

# Единая prod-инструкция — docs/operations/prod-deploy-log.md

## Что было поставлено

После ~10 дней активной разработки (с 2026-05-16) накопилось ~12 разрозненных prod-инструкций — каждая в своей рефлексии, каждая со своим набором `bun run scripts/...`. Владелец продукта пожаловался, что половину команд теряет: «есть инструкция, но я точно знаю, что я что-то потерял».

Задача:
1. Свести все накопленные prod-операции в единый документ.
2. Зафиксировать правило: после каждого push дополнять этот документ, а не выдавать инструкцию в чат.
3. Сделать структуру, в которую можно дописывать каждый день; после реального выката — архивировать.

## Как решал

**Параллельный сбор данных — 3 sub-агента одновременно** (не последовательно):

1. **Агент 1 (general-purpose):** прошёл по `second-brain/05_история/*` за период + `git log --since="10 days ago"` и собрал черновую карту prod-инструкций по дням/волнам. Объём отчёта — ~60 КБ.
2. **Агент 2 (general-purpose):** инвентаризировал ВСЕ файлы в `backend/scripts/` (patch/seed/migrate/backfill/setup/smoke/apply), прочитал каждый, проверил флаги (--dry-run / --apply / --update-existing), идемпотентность, защиту admin-edited данных. Сверил со списком из рефлексий — несоответствий не нашёл, но подсветил 10 уточнений (например, `setup-telegram-bot` с β-9 больше без `--tenant-id`; `backfill-task-assignee-userid.ts` в шапке стоит «не на прод»; `patch-migrate-clone-access.ts` — заглушка-no-op).
3. **Агент 3 (general-purpose):** прочитал `env.schema.ts`, `schema.prisma`, `postgres-init.sql`, `package.json` за период. Зафиксировал ~100 новых ENV (все опциональные), ~165 новых моделей, 2 опасных schema-операции (DROP Transcript.rawIndexS3Url, Meeting.tenantId NOT NULL — нужен backfill ПЕРЕД prisma:push), AGE-блокер (`shared_preload_libraries`), все HNSW/GIN/partial unique индексы из postgres-init.sql.

**Файл [docs/operations/prod-deploy-log.md](../../docs/operations/prod-deploy-log.md)** — 12 шагов в строгом порядке:

- Шаг 0 — Pre-flight (AGE, бэкап)
- Шаг 1 — ENV
- Шаг 2 — Pull + install
- Шаг 3 — **PRE-MIGRATION gate** (`backfill-orgs` → `backfill-meeting-tenant-id` → `tighten-meeting-tenant-not-null` exit 1)
- Шаг 4 — Prisma (с явным предупреждением про `--accept-data-loss`)
- Шаг 5 — apply-postgres-init (12 HNSW + GIN + 5 partial unique + AGE-граф)
- Шаги 6-7 — patch/seed (9 + 7 подгрупп)
- Шаги 8-9 — backfill + миграции
- Шаг 10 — per-tenant боты (Telegram теперь без `--tenant-id`)
- Шаг 11 — build + restart (HTTP + worker — два процесса)
- Шаг 12 — smoke (Swagger-разделы + Prometheus метрики)

Плюс разделы «Особо опасные операции» (6 пунктов) и пустой «Архив применённых».

**Правило в [CLAUDE.md](../../CLAUDE.md)** (Триггер 1 после push):

- Расширил таблицу производных заметок 8 новыми строками (patch/seed/backfill/migrate/setup/postgres-init/env.schema/feature-flag → конкретный Шаг файла).
- Пункт 5 переписан с «напомни про prod-операции в чате» → «обнови `prod-deploy-log.md` по маппингу шагов».
- Пункт 6 — в чат выдавать только diff («добавил X в Шаг Y»). Если изменений нет — явно «prod-операций нет».
- Добавлен новый суб-триггер «выкатили на прод» → перенос блока «Накоплено» в «Архив», обнуление.

**Память:** сохранил `feedback_prod_deploy_log_single_source.md` в `~/.claude/projects/c--work-z/memory/` + строку в `MEMORY.md`. Без этого в новой сессии я бы снова выдал инструкцию в чат — двойная защита (memory + CLAUDE.md правило).

## Что вышло

- Коммит `a97ef88` (push прошёл `11e1b08..a97ef88`).
- 2 файла изменено: новый `docs/operations/prod-deploy-log.md` (495 строк), `CLAUDE.md` (+33/-6 строк).
- Чужие модификации в working tree (10 modified .ts + 19 untracked) **не тронул** — index гигиена соблюдена.
- Index перед commit проверил (`git status --short`), staged только мои файлы.

## Чему научился

1. **Прод-инструкции в чате — антипаттерн.** Они теряются между сессиями. Кумулятивный файл в репо + правило «после push → дополнять» > отдельных портянок. У владельца было ~12 фрагментов из разных рефлексий — половину терял.

2. **Параллельные агенты быстрее серии в разы.** 3 разных задачи за один прогон (~5 мин вместо 15-20). Особенно когда задачи не зависят друг от друга: «собери карту по дням», «проверь, что все файлы реально существуют», «инвентаризируй ENV/Prisma».

3. **Агенты валидируют друг друга.** Один (general-purpose #1) собрал по рефлексиям — мог пропустить или придумать. Второй (general-purpose #2) физически открыл каждый файл из `backend/scripts/` и сверил — нашёл 10 уточнений, которые в рефлексиях были неточны (alias'ы, флаги, deprecated параметры). Это закрепляет memory-правило про «агенты могут лгать про [x]».

4. **Memory + CLAUDE.md = двойная защита от регрессии.** Правило в CLAUDE.md (видимо всем сессиям) + memory feedback (для меня). Если одно потеряется — другое сработает.

5. **Конкретные находки для prod-инструкции, которые легко упустить:**
   - `setup-telegram-bot` после β-9 больше **глобальный** — `--tenant-id` устарел.
   - `Meeting.tenantId String?` → `String` (NOT NULL) — без backfill `prisma:push` упадёт.
   - `Transcript.rawIndexS3Url` — DROP колонки, нужен `--accept-data-loss`.
   - AGE extension — без `shared_preload_libraries='age'` в кластере `apply-postgres-init` упадёт.
   - VAPID_*, PUSH_MAX_FAILURES, CONCIERGE_* — **вне** EnvSchema (zod не валидирует), опечатки молча → no-op.
   - `backfill-task-assignee-userid.ts` — в шапке файла стоит «НЕ ЗАПУСКАТЬ НА ПРОДЕ без согласования», легко включить по ошибке.
   - `patch-migrate-clone-access.ts` — заглушка, ничего не делает (волна 2 ещё не пришла), но в инструкциях из агентов упоминается.

## Связанные файлы

- [docs/operations/prod-deploy-log.md](../../docs/operations/prod-deploy-log.md) — сам реестр
- [CLAUDE.md](../../CLAUDE.md) — раздел «Триггер 1: после `git push`», пункты 5-6
- `~/.claude/projects/c--work-z/memory/feedback_prod_deploy_log_single_source.md` — memory правило
