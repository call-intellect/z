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
