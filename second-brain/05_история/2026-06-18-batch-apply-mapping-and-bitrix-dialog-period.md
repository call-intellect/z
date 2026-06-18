---
title: Сопоставление по кнопке + период подтяжки диалогов Bitrix (как в чат-боксе)
date: 2026-06-18
type: reflection
distilled: false
---

# Сопоставление по кнопке + период диалогов Bitrix — рефлексия 2026-06-18

Ветка `dev`, коммиты `a2e3b531` (batch-apply) и `c989f258` (период диалогов).

## Что было поставлено

1. На страницах сопоставления (bitrix-сотрудники, chatbox-менеджеры, chatbox-клиенты) выбор в селекте применялся **сразу** — надо копить выбор и применять одной кнопкой.
2. У Bitrix нет выбора периода для подтяжки диалогов — сделать как в чат-боксе («Забрать за период»).

## Как решал

**Batch-apply (фронт, 3 файла):** перенёс выбор из row-level immediate API в состояние списка `pending: Record<id, value>`. Row стал контролируемым (`value`/`onChange`/`dirty`/`disabled`), строка с изменением помечается бейджем «изменено». Внизу карточки sticky-бар `ApplyBar` с кнопкой «Применить (N)» — в `handleApply` прогон по `changed` (diff pending vs текущий linkedPersonId), каждый через свой API (bitrix `linkUser(extId, mode, personId?)`; chatbox `linkMember`/`linkCustomer(id, personId)` + `create*Person(id)`), тосты-итог, `mutate()`.

**Период диалогов Bitrix (фронт + бэк):**
- Фронт: блок «Забрать диалоги за период» (селект 7д…вся история + кнопка), `bitrixApi.sync(scope, since)`; «вся история» = `new Date(0)`.
- Бэк: `since?: string` протянут `BitrixSyncJobData` → `enqueue` (отдельный jobId `*-dialogs-backfill`, + учёт в `getRunningScopes`) → worker → `syncByScope(tenantId, scope, since)` → `syncDialogs(tenantId, sinceDate)` → `syncDialogMessages(..., since?)`.
- `syncDialogMessages` при `since` делает **обратную пагинацию** Bitrix `im.dialog.messages.get` по `LAST_ID` (страница = min id текущей страницы; Bitrix отдаёт newest-first, LAST_ID = «старше этого id»), страницы по 200, до 25 страниц/диалог, стоп при достижении `since` / короткой странице. Без `since` (суточная синхра) — поведение прежнее: одна страница 100.

## Что вышло

- FE: `lint` 0 ошибок, `typecheck` чисто (осталась только стейл-ошибка `.next/feed/page.js`, не связана).
- BE: `lint` 0, `typecheck` exit 0 (heap поднят).
- Prod-операций нет — только код (миграций/сидов/ENV не добавлял; `BitrixDialog`/`BitrixMessage` уже есть).

## Чему научился

- **Bitrix `im.dialog.messages.get` отдаёт newest-first; пагинация назад через `LAST_ID`** (= min id предыдущей страницы), `LIMIT` до 200. Дата-фильтра нет — период реализуется обратной пагинацией с отсечкой по `date < since` и кэпом страниц. Кэп страниц = негласный предел «всей истории» (≈5000 сообщений/диалог) — при необходимости поднимать `DIALOG_BACKFILL_MAX_PAGES`.
- **Backfill-джоба должна иметь отдельный jobId** (`*-dialogs-backfill`), иначе перетрёт обычную синхру того же scope; и его надо добавить в `getRunningScopes`, иначе UI-баннер не увидит работу (так уже сделано в chatbox — скопировал паттерн).
- **Batch-apply паттерн для списков сопоставления:** контролируемые строки + `pending` в родителе + diff-by-current на «Применить». Переиспользуемо для любых «выбрал много → применил разом» экранов.
