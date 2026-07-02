---
feature: Пакет D — надёжность и наблюдаемость (recovery · retry · метрики масштаба)
status: approved
approved_by: владелец (делегировано 2026-07-01)
date: 2026-07-01
covers: F-9 (recovery/метрика застрявших), F-8 (retry на parse-error), + мониторинг масштаба (over/under-merge, атрибуция)
---

# Пакет D — надёжность и наблюдаемость

При 40–100 юзерах нужны видимость тихих сбоев и восстановление под наплывом.

## F-9 — застрявшие RawEvents: метрика + окно-крутилка
**Сейчас:** recovery-крон уже есть (`raw-event-recovery.cron.ts:31`, окно через `staleMinutes`/`maxAgeHours` = AdminSetting `getDynamic`). Чего нет — **метрики «сколько сейчас застряло»**, поэтому наплыв не виден.
**Делаем:** добавить prometheus-gauge `raw_event_stuck_gauge{tenant, source_type}`; крон после прохода считает застрявших и выставляет gauge.
**Развилка — решена (Р-1):** *что считать «застрявшим» для метрики — по времени (received + receivedAt<staleBefore) или по evidence (received + 0 evidence)?* → **по времени.** *Доказательство:* крон уже использует time-based окно с крутилками; метрика без дорогого JOIN к evidence; консистентно с самим recovery. (Ремарка: ручной `reprocess-stuck.ts` фильтрует по `evidence.none` — оставить коммент о расхождении, крон — источник правды.)
**Изменения:** `business-metrics.service.ts` (~:490 объявить gauge, onModuleInit зарегистрировать `getOrCreateGauge`, метод `setRawEventStuck`), `raw-event-recovery.cron.ts` (метод `observeStuckCount(staleMinutes)` + вызов после sweep).

## F-8 — combined parse-error глотается без retry
**Сейчас:** `specialists-combined.worker.ts:210-223` ловит `SpecialistsCombinedParseError`, логирует и `return void` → задачи источника тихо теряются.
**Делаем:** ограниченный in-worker retry через **repair-prompt** (пере-спросить LLM починить кривой JSON), затем — если не вышло — в метрику/failed, не в тихий проглот.
**Развилка — решена (Р-2):** *retry как: (A) in-worker repair-prompt, (B) throw→BullMQ backoff, (C) ...?* → **A.** *Доказательство:* BullMQ-backoff повторяет с ИДЕНТИЧНЫМ входом → тот же кривой JSON. Repair-prompt («вот твой ответ, он невалиден — верни валидный JSON») с высокой вероятностью чинит с первого раза. Bounded (maxAttempts=2), при исчерпании — surface в метрику.
**Изменения:** `specialists-combined.service.ts` (+`repairJsonAndRetry(error, tenantId, args, attempt)`), `specialists-combined.worker.ts:210-223` (заменить тихий return на `repairAndRetry(...maxAttempts=2)`, при провале — метрика `combined_parse_failed_total`), расширить `SpecialistsCombinedParseError` полем `repairContext`.

## Мониторинг масштаба (не код-фикс сейчас — метрики + пороги)
Из разбора: проявятся на реальных данных 40–100, не на синтетике. Не тормозят фиксы A–C, живут здесь как наблюдение:
- **Точность слияния сущностей** — over-merge (склеило двух разных клиентов) / under-merge (клиент двоится). Метрика: доля merge с низким зазором уверенности + ручные откаты; порог арбитра — крутилка. **Действие:** dashboards + alert, не переписывание сейчас.
- **Точность атрибуции автора** — блок приписан не тому человеку через fuzzy. Метрика: доля low-confidence атрибуций; выборочный аудит. **Действие:** наблюдение.
- Явно **НЕ действия сейчас:** cap=4 (`core_router_trimmed_total`) — крутилка, поднять при реальном тримминге; whitelist рёбер AGE — только если включат «фазу 2».

## Тест-план
- F-9: застрявшие RawEvents → gauge отражает count по tenant/source_type.
- F-8: воркеру подсунуть кривой JSON → repair-prompt чинит; неисправимый → метрика инкрементится, не тихий return.
- Мониторинг: дашборд-панели merge-зазора и атрибуции существуют (данные могут быть 0 на старте).
