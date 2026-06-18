---
title: Инцидент — выкат завис на patch-telegram-register-in-proxy (нет process.exit + нет таймаута на шаг)
date: 2026-06-18
type: reflection
distilled: false
---

# Инцидент: migrate завис на выкате — рефлексия 2026-06-18

Ветка `bitrixFix`, коммит `c9998701`. Прод-выкат (`docker compose logs -f migrate`) замёрз; `backend` ждёт `migrate: service_completed_successfully` → стек не поднимался.

## Что было поставлено

Пользователь: «migrate зависает и не выходит», последняя строка лога — `✓ patch-migrate-clone-access.ts`.

## Как диагностировал

- Галочка `✓` в раннере = шаг **завершён**, значит висит **следующий** шаг. По `STEPS` в `apply-prod-deploy.ts` следом идёт `patch-telegram-register-in-proxy.ts`.
- Раннер `runOne` запускает шаг `Bun.spawn(cmd, {stdout:'pipe'})` и читает вывод через `new Response(proc.stdout).text()` — **поток читается до EOF (exit)**, поэтому логи зависшего шага не видны вообще, пока он не завершится.
- Скрипт `patch-telegram-register-in-proxy.ts` поднимает **полный Nest** (`NestFactory.createApplicationContext(AppModule)` → это и in-process воркеры/cron) и на успехе **не делает `process.exit`** — висячие хендлы Redis/BullMQ держат event loop живым вечно. `await proc.exited` в раннере не разрешается → весь выкат заморожен.
- HTTP к `telegram.crossmark.ru` — НЕ причина вечного фриза: у клиента `fetchWithTimeout`, `TELEGRAM_PROXY_REQUEST_TIMEOUT_MS` дефолт 15 000 мс ([env.schema.ts](../../backend/src/common/config/env.schema.ts) L414).
- `--continue-on-fail`/`--no-fail-on-steps` ловят **падение** шага, но не **зависание** — таймаута на шаг нет.

## Как решал

- **Разблокировка прода без пересборки:** `docker compose kill migrate` → `TELEGRAM_PROXY_ENABLED=false` в `.env` (скрипт делает early-return до Nest) → `docker compose up -d migrate` (идемпотентно дойдёт до конца, exit 0) → `docker compose up -d`. Флаг вернуть после фикса.
- **Fix B** [patch-telegram-register-in-proxy.ts](../../backend/scripts/patch-telegram-register-in-proxy.ts): `main().then(() => process.exit(0))` — процесс гарантированно завершается, даже если Nest оставил открытые хендлы.
- **Fix A** [apply-prod-deploy.ts](../../backend/scripts/apply-prod-deploy.ts) `runOne`: per-step timeout (дефолт 600с, env `DEPLOY_STEP_TIMEOUT_MS`; telegram-шагу 120с). При таймауте `proc.kill(9)`, шаг помечается failed, с `--continue-on-fail` выкат продолжается. Системная страховка: ни один зависший патч больше не морозит весь выкат.

## Что вышло

- backend `typecheck` 0 ошибок (heap поднят — обходим OOM-ловушку tsc), `eslint` 0 ошибок.
- После фикса можно держать `TELEGRAM_PROXY_ENABLED=true`: шаг отрабатывает ≤15с и корректно выходит.

## Итог на проде + follow-up

- Выкат на новом образе подтвердил фикс: в логе `✗ patch-telegram-register-in-proxy (ТАЙМАУТ 120s — процесс убит, шаг пропущен)`, после чего все patch+backfill прошли до конца, стек поднялся. При этом бот **успел зарегистрироваться** (`✓ proxyBotId=...`) — висло уже на `app.close()`: поднятый в migrate полный Nest запустил in-process воркеры, и они начали **жрать очередь и гонять LLM** (`block-linker` DeepSeek 20819ms), из-за чего `app.close()` не завершался. Значит `process.exit(0)` (Fix B) не спасает — до него не доходит. Спас таймаут.
- Поэтому telegram-шаг **убран из автодеплоя совсем** (`fd15350a`) — регистрация бота теперь ручная: `docker compose exec backend bun run scripts/patch-telegram-register-in-proxy.ts`.
- **Ускорение выката (`b5303ca2`):** ~половина `STEPS` (patch/backfill/migrate) — одноразовые миграции, но гонялись каждый деплой. Добавлен журнал `public._deploy_applied_step` (как `_prisma_migrations`): одноразовые шаги после успеха записываются и на следующих деплоях скипаются. Конфиг-реконсиляция (LLM-маршруты, Ship-On флаги) помечена `everyDeploy:true`. Форс — `--rerun-all` / `DEPLOY_RERUN_ALL=1`. Первый деплой после изменения прогонит всё один раз и запишет журнал.

## Чему научился

- **Любой prod-скрипт, поднимающий полный Nest/AppModule (воркеры+cron), ОБЯЗАН делать `process.exit(0)` в конце** — иначе in-process BullMQ/Redis/cron держат процесс живым, и one-shot-контейнер (migrate) висит вечно. Перекликается с [[feedback-no-child-process-python-container]] про границы процессов.
- **У batch-раннера деплоя нужен таймаут на шаг.** `--continue-on-fail` бесполезен против зависания — только против падения.
- **Диагностика по логам раннера:** `✓ X` = X завершён, виновник — следующий шаг. Из-за `stdout:'pipe'` + чтения до EOF логи зависшего шага не появляются вовсе — это само по себе сигнал «висит, а не медленно работает».
- **One-shot deploy-скрипты должны быть журналируемыми, а не «прогоняй всё каждый раз».** Одноразовые data-миграции, гоняемые каждый деплой, — это и время (bun+Prisma/Nest на каждый), и риск (booting Nest = воркеры жрут очередь). Ledger по образцу `_prisma_migrations` решает оба. Конфиг-реконсиляцию (идемпотентный self-heal) — наоборот, оставлять `everyDeploy`.
- **AGE-trap снова:** таблицу журнала квалифицировал `public._deploy_applied_step`, иначе сырой `CREATE TABLE` ушёл бы в `ag_catalog` ([[project-age-search-path-ddl-trap]]).
