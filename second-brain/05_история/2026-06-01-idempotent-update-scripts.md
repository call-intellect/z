---
date: 2026-06-01
tema: Идемпотентность prod update-скриптов + аудит агрегатора перед первым большим cut'ом
commit: d4b17d5
---

# Самопроверка update-скриптов вместо сырых падений

## Что было поставлено
Перед первым большим накопительным выкатом (окно 2026-05-20..05-31, архив `prod-deploy-log.md` пуст) три задачи:
1. Подробная инструкция по обновлению прода.
2. Проверка: всё ли включено в агрегатор `apply-prod-deploy.ts` для корректного обновления.
3. Часть скриптов падает «сырой» ошибкой на рабочем проде — обработать все кейсы: вместо raw-error печатать конкретную причину («обновление не требуется, данные актуальны»), т.е. скрипты должны сами проверять актуальность.

## Как решал
- **Инструкция + агрегатор**: прочитал `docs/operations/prod-deploy-log.md` (2027 строк) и `apply-prod-deploy.ts`. Сверил все новые seed/patch/backfill/migrate из коммитов 05-29..31 против `STEPS` — состав полный, вне агрегатора только намеренно-исключённые (`seed-demo-workspace` per-Org, dev-only `patch-bootstrap-audit-org`/`patch-create-dev-audit-user`, incident/verify-only). Добавлять ничего не нужно.
- **Аудит идемпотентности**: 3 параллельных general-purpose агента прошли ~48 update-скриптов. Гипотеза «bare `new PrismaClient()` крашит Prisma 7» **не подтвердилась** — 9 подозрительных скриптов передают adapter инлайн. Реальные причины падений другие.
- **Hardening** (P1+P2+P3, полный объём — выбрал пользователь):
  - Создал `backend/scripts/_lib/schema-guards.ts`: `enumHasValue` / `isColumnNullable` / `tableExists` / `columnExists` (read-only `information_schema`/`pg_enum`). Param типизирован как `PrismaClient` напрямую (а не структурный интерфейс) — нулевой риск со структурной типизацией `$queryRaw`.
  - P1 (4): `telegram-register-in-proxy` (3 throw→log+return, недоступность прокси пишет `proxyLastSyncError` и не валит выкат), `encrypt-tochka-oauth` (`CRYPTO_MASTER_KEY` только когда есть что шифровать), `demo-subscriptions` (per-org errors → warn+exit0), `backfill-card-versions` (курсор по id — фикс бесконечного цикла в `--dry-run`).
  - P2 (3): `commitment-due-dates`, `knowledge-clone-after-router-fix` — лёгкий `count` + early-return ДО подъёма AppModule; `migrate-telegram-channels-to-global` → `createPrismaClient()` без Nest.
  - P3 (11): enum/NOT-NULL/removed-model guard'ы — превентивно от будущих cleanup-миграций.
- Обновил `prod-deploy-log.md`: новый раздел про самопроверку + обобщил заметку Шага 3.

## Что вышло
- 20 файлов, +372/−51. Коммит `d4b17d5`, запушен в `dev`.
- ⚠️ **`tsc` не прогнан** — локально нет `node_modules` (проект в docker, `bun install` на хост против правил). Сделал тщательную ручную проверку: сверил импорт/использование хелпера по всем 11 P3-файлам, нашёл и починил dangling-переменную `proxyLastSyncError` (перенёс объявление в catch, success-путь → `null`), проверил порядок объявления `crypto` после перестановки.

## Чему научился
- **Не доверяй априорной гипотезе о причине падений — аудируй.** «bare PrismaClient» звучало как очевидный виновник, но реальные причины — внешние зависимости (прокси/ключ), `exit(1)` на per-org ошибках, и отложенные мины под будущие cleanup-миграции.
- **Эталон уже был в репо** (`backfill-orgs-fase0.ts` `isColumnNullable` + заметка строки 1215 в логе) — масштабировал его в общий `_lib` хелпер вместо изобретения паттерна.
- **При выносе inline-where в переменную теряется контекстная типизация** — строковые литералы Prisma-enum (`role: 'subject'`) виджутся до `string` и ломают тип; лечится `as const`. [[code-pitfalls]]
- **Параллельные аудит-агенты** хорошо масштабируются на «прочитать 48 файлов и вернуть структурированный вердикт» без раздувания основного контекста.

## Добавление (тот же день) — реальный выкат вскрыл дыры процесса

Пока вёл владельца по выкату на сервере — всплыло то, чего аудит не покрыл:
1. **`migrate`-контейнер с голым `prisma db push` падает на первом выкате с новыми unique** (`BillingEventLog.jti/(provider,eventId)`, `ReferralAttribution(...)`, `ReferralPayout.triggerInvoiceId`): `--accept-data-loss` не задан, а dedupe-скрипты в агрегаторе стоят ПОСЛЕ push. Классический ordering-баг.
2. **`docker compose run backend` дёргает зависимость `migrate`** → нужен `--no-deps`, чтобы прогнать gate/push в обход.
3. **`frontend/bun.lock` был сгенерён через `registry.npmmirror.com`** (776 URL) → 404 на свежий `@livekit/components-react@2.9.21` при сборке прода. Фикс: sed-замена хоста на `registry.npmjs.org` (integrity-хэши те же, версии не тронуты), проверено `bun install --frozen-lockfile --dry-run`. [[code-pitfalls]]
4. Я несколько раз давал **дженерик-инструкцию вместо реальной инфры** (выдумал отдельный `worker`-сервис, ручной `prisma:push` вместо контейнера `migrate`). Урок: **читать `docker-compose.yml` ПЕРЕД тем, как писать инструкцию по выкату**, а не после того как владелец ткнёт носом.

**Что сделал в ответ:** `apply-prod-deploy.ts --with-schema` — единый вход: авто-бэкап (`pg_dump` в volume `z-backups`) → pre-push dedupe → `prisma db push --accept-data-loss` → `apply-postgres-init` → seeds/patches/backfills. `--accept-data-loss` теперь ВСЕГДА с бэкапом (нет бэкапа → нет push). Dockerfile +`postgresql16-client`, compose +volume `z-backups`, prod-deploy-log +«⚡ Быстрый выкат». Зафиксировал в памяти feedback-правило: новый prod-скрипт → сразу в `STEPS`; выкат = одна команда. Коммиты `1f56567` (lockfile), `e782417` (--with-schema).

**Главный урок:** идемпотентность отдельных скриптов — половина дела; вторая половина — чтобы их не надо было запускать руками по одному. Оркестратор должен покрывать ВЕСЬ путь (включая схему и бэкап), иначе оператор всё равно тонет в командах.

**Финал (коммит `f4113c5`):** завязал `migrate`-контейнер на агрегатор → выкат = `docker compose up -d`. Ключевая семантика отказов через флаг `--no-fail-on-steps`: сбой СХЕМЫ (бэкап/push) валит migrate и блокирует backend (схема-mismatch фатален — это правильно), а осечка идемпотентного seed/backfill НЕ кладёт стек (логируется в SUMMARY, перезапускается руками). Без этого разделения один флапающий сид брикнул бы весь прод при каждом `up`. Tradeoff: migrate теперь прогоняет ~102 идемпотентных скрипта на каждом `up -d` (+1-3 мин к старту) — приемлемо за «одну кнопку».
