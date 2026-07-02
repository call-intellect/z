---
type: tz
status: ready-to-implement
feature: sync-bitrix-chatbox-same-time
date: 2026-06-29
owner: sergrv80 (владелец продукта Кора)
relates_to:
  - plans/analysis/2026-06-29-checkin-ingest-rebuild.md
---

# ТЗ — Синхронный ночной забор Bitrix и chatbox (00:00 МСК)

> Маленькое отдельное ТЗ. Вырезано из Ф1 анализа `plans/analysis/2026-06-29-checkin-ingest-rebuild.md` как самостоятельный быстрый фикс — закрывается независимо от остального (graph→checkin, снос day-signal).

## Цель + зачем

Bitrix и chatbox должны забираться в **одно время — 00:00 по Москве**. Сейчас они в разнобой: chatbox в 00:00 МСК, Bitrix в 03:00 МСК. Дополнительно у Bitrix забор (`sync`) и разбор (`analyze`) стоят на одной минуте → гонка (analyze берёт `pending`, пока sync ещё качает) → лаг Bitrix до 2 суток. Выравнивание забора на 00:00 МСК заодно разводит Bitrix sync (00:00) и analyze (03:00) на 3 часа — гонка уходит как побочный эффект.

## REALITY-CHECK (verified по коду 2026-06-29)

В прод-контейнере TZ не задан → процесс в UTC, поэтому `EVERY_DAY_AT_MIDNIGHT` без `timeZone` = 00:00 UTC = **03:00 МСК** (обоснование — §2 анализа).

| Крон | Файл | Сейчас в коде | Реально по МСК | Действие |
|---|---|---|---|---|
| chatbox **sync** | `backend/src/modules/chatbox/chatbox-sync.cron.ts:21` | `EVERY_DAY_AT_MIDNIGHT` + `timeZone: 'Europe/Moscow'` | **00:00** | ✅ уже верно — НЕ трогаем |
| bitrix **sync** | `backend/src/modules/bitrix/bitrix-sync.cron.ts:21` | `EVERY_DAY_AT_MIDNIGHT` (без TZ) | **03:00** | 🔧 **чиним** → 00:00 МСК |
| bitrix **analyze** | `backend/src/modules/bitrix/bitrix-analyze.cron.ts:26` | `EVERY_DAY_AT_MIDNIGHT` (без TZ) | **03:00** | НЕ трогаем (остаётся 03:00 МСК — после правки sync разводится с ним) |

## Что меняем (ровно одна правка)

`backend/src/modules/bitrix/bitrix-sync.cron.ts` — добавить явный `timeZone: 'Europe/Moscow'` в опции декоратора `@Cron`, чтобы привести к виду chatbox-sync.

**До:**
```ts
@Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'BitrixSyncCron.runDaily' })
```

**После:**
```ts
@Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, {
  name: 'BitrixSyncCron.runDaily',
  timeZone: 'Europe/Moscow',
})
```

Решение через явный pin часового пояса (а не пересчёт через UTC) — устойчиво к TZ сервера и единообразно с chatbox-sync.

## Scope

**Входит:** только расписание `bitrix-sync.cron.ts` (→ 00:00 МСК).

**Не входит (с судьбой):**
- `bitrix-analyze.cron.ts` — остаётся 03:00 МСК; полное выравнивание/событийный триггер анализа — большое ТЗ `2026-06-29-checkin-ingest-rebuild` (Ф1/Ф2).
- chatbox (sync и analyze) — уже на московском времени, не трогаем.
- Вынос расписания кронов в AdminSetting (крутилка часа забора) — отдельно, если понадобится крутить из админки; сейчас и chatbox, и Bitrix хардкодят расписание в декораторе — паритет сохраняем.
- Слой `graph→checkin` и снос `day-signal-*` — большое ТЗ.

## Побочный положительный эффект

После правки Bitrix sync (00:00 МСК) и analyze (03:00 МСК) разнесены на 3 часа → sync успевает докачать сессии до того, как analyze их запросит → исчезает гонка `sync↔analyze` и связанный с ней суточный лаг Bitrix.

## Acceptance

- grep `bitrix-sync.cron.ts`: в опциях `@Cron` присутствует `timeZone: 'Europe/Moscow'`.
- `bun run typecheck` · `bun run lint` · `bun run build` (backend) — зелёные.
- Поведение логики не меняется (правится только время срабатывания) — существующие тесты модуля bitrix остаются зелёными.

## Риски

- **TZ-зависимость снимается:** до правки время зависело от TZ сервера (UTC-предположение); после — явный pin `Europe/Moscow`, не зависит от сервера.
- **Первый запуск:** ближайшая 00:00 МСК после деплоя; ручных действий не требуется.
- Нагрузка на Bitrix API в 00:00 МСК совпадёт с chatbox — оба ставят job'ы в очередь (BullMQ), не синхронный наплыв; риск минимален на текущем масштабе.

## prod-deploy

**Prod-операций нет.** Изменение — только код крона; применяется обычным деплоем backend (`docker compose up -d --build backend`). Без миграций / seed / ENV / новых флагов.

## DoD

- Правка внесена; typecheck / lint / build зелёные.
- Строка в `second-brain/04_не-сделано/README.md` про тайминговую противофазу — обновить только когда закроется большой план (этот фикс — частичный шаг; полностью пробел закрывает `graph→checkin`).
- Рефлексия в `second-brain/05_история/` после push.

## Итог

Реализовано (2026-06-29). В `backend/src/modules/bitrix/bitrix-sync.cron.ts` в опции `@Cron` добавлен `timeZone: 'Europe/Moscow'` — bitrix sync приведён к 00:00 МСК (паритет с chatbox-sync), заодно разведён с analyze (03:00 МСК) → уходит гонка `sync↔analyze`.

Верификация: eslint (scoped) ✓ · `bun run typecheck` ✓ · `bun run build` ✓ (с `--max-old-space-size=8192` — дефолтный heap даёт OOM, грабля окружения, не правки) · тесты модуля bitrix 6 файлов / 42 теста — зелёные.

prod-операций нет: применяется обычным деплоем backend, без миграций/seed/ENV/флагов.
