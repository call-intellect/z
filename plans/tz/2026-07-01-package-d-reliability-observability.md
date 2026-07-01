# ТЗ — Пакет D: надёжность и наблюдаемость

- **Архитектура:** [plans/architecture/2026-07-01-package-d-reliability-observability.md](../architecture/2026-07-01-package-d-reliability-observability.md) (status: approved)
- **Покрывает:** F-9 (метрика застрявших), F-8 (retry на parse-error), мониторинг масштаба

## Фаза F-9 — метрика застрявших RawEvents

### [ ] Ф1
- `business-metrics.service.ts` (~:490): объявить `rawEventStuckGauge!: Gauge<'tenant'|'source_type'>`; в `onModuleInit` (~:2490) — `getOrCreateGauge({ name:'raw_event_stuck_gauge', help:'...' })`; метод `setRawEventStuck(count, {tenant, source_type})`.
- `raw-event-recovery.cron.ts`: метод `observeStuckCount(staleMinutes, now=new Date())` — считает `processingStatus='received' AND receivedAt < staleBefore`, группирует по tenant/source_type; вызвать после `sweep()` в `runOnce()` и выставить gauge.
- Окно — существующая крутилка `staleMinutes`/`maxAgeHours` (`getDynamic`), не менять.
- Коммент в `reprocess-stuck.ts:16` о расхождении фильтров (evidence.none vs time-window); крон = источник правды.

## Фаза F-8 — retry на combined parse-error

### [ ] Ф2
- `specialists-combined.service.ts`: `repairJsonAndRetry(originalError, tenantId, args, attempt)` — repair-prompt («твой ответ невалиден, верни валидный JSON по схеме»), bounded.
- `SpecialistsCombinedParseError`: добавить `repairContext?: {attempt, previousRawText?}`.
- `specialists-combined.worker.ts:210-223`: заменить тихий `return void` на `repairAndRetry(..., maxAttempts=2)`; при исчерпании — метрика `combined_parse_failed_total{tenant,source_type}` (не тихий проглот).
- Проверить, что `LlmRouterService` поддерживает repair-контекст в промпте.

## Фаза мониторинга масштаба (метрики, не переписывание)

### [ ] Ф3
- Панель/метрика **точности слияния сущностей**: доля merge с низким зазором уверенности + счётчик ручных откатов; alert на всплеск. (Порог арбитра — крутилка, не трогаем сейчас.)
- Метрика **атрибуции автора**: доля low-confidence атрибуций блок→person; выборочный аудит.
- Зафиксировать в `second-brain/04_не-сделано/README.md`: cap=4 (`core_router_trimmed_total`) и whitelist рёбер AGE — **не действия сейчас** (cap — крутилка при реальном тримминге; whitelist — только под «фазу 2» AGE).

### [ ] Ф4. Тесты
- F-9: N застрявших RawEvents → gauge = N по tenant/source_type.
- F-8: кривой JSON → repair-prompt чинит; неисправимый → `combined_parse_failed_total++`, не тихий return.

## Критерии приёмки (DoD)
- Наплыв застрявших виден в метрике (не молча).
- Parse-error не теряет задачи тихо: либо чинится repair-prompt, либо инкрементит failed-метрику.
- Панели merge-accuracy/атрибуции существуют (данные могут быть 0 на старте).

## Prod-deploy
- Новые метрики → `prod-deploy-log.md` Шаг 12 (smoke: `/metrics` grep `raw_event_stuck_gauge`, `combined_parse_failed_total`).

## Итог
_Заполнить после реализации._
