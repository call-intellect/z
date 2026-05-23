---
type: analysis
status: open
feature: Кора v2 — техдолги после batch-реализации 19 sub-ТЗ (простым русским)
date: 2026-05-23
author: claude (по запросу владельца "объясни простым языком")
related:
  - plans/analysis/2026-05-23-kora-v2-shipping-report.md (§5 «Известные TODO vNext»)
  - second-brain/05_история/2026-05-23-kora-v2-batch-19-sub-tz-orchestrated.md
---

# Кора v2 — техдолги после batch-реализации (простым русским)

> Это **не блокеры**. Продукт работает. Это «можно жить, но в будущем стоит почистить». В сумме ~1 рабочий день, если делать одним заходом.

---

## 1. Concierge tool-use — сейчас «эмуляция», лучше «нативно»

**Что есть.** Concierge-агент умеет выполнять действия за пользователя («создай встречу про X»). Чтобы агент сказал «вызови инструмент create_meeting», я заставил LLM вернуть JSON-строку `{"tool_call": {"name": "create_meeting", "args": {...}}}` внутри обычного текстового ответа — потом я её парсю.

**Что лучше.** У OpenAI и Anthropic есть отдельный нативный механизм tool-use — модель возвращает tool_call как **отдельное structured-поле**, а не текстом. Это надёжнее (модель не «забывает» формат и не путает с обычным ответом).

**Когда чинить.** Когда заметим, что Concierge периодически промахивается («сказал текст вместо tool_call»). Пока — мониторим метрики `concierge_tool_calls_total`.

**Сколько работы.** ~3-4 часа: переделать LlmRouter call для concierge-respond taskType под native tool-use schema; обновить ToolRouterService.

**Где трогать.** `backend/src/modules/concierge/services/concierge.service.ts`, `tool-router.service.ts`, `backend/src/modules/ai/services/llm-router.service.ts`.

---

## 2. Голос в Concierge через web — кнопка-микрофон не подключена

**Что есть.** Голос работает через Telegram/MAX (записал голосовое — наш ASR расшифровал — попало в чат). Также есть REST `POST /api/v1/voice/transcribe`.

**Что нет.** В UI кабинета на странице `/assistant` нет кнопки-микрофона «удерживать чтобы говорить» с WebSocket-стримом. Coder δ-3 не успел вписаться в готовый компонент γ-2, т.к. они закрывались параллельно.

**Сколько работы.** 1-2 часа — добавить кнопку в `ConciergeChat.tsx`, MediaRecorder + WebSocket-handler.

**Где трогать.** `frontend/src/ui/concierge/ConciergeChat.tsx` (extend существующий `ConciergeVoice.tsx` компонент); backend WS endpoint `/api/v1/concierge/voice`.

---

## 3. COO-дашборд без графиков

**Что есть.** Страница `/dashboard/operations` показывает метрики COO (блокеры, конфликты, нагрузка) **плоскими карточками с цифрами**.

**Что хотели.** Bar/Line charts через Recharts. Coder β-8 обошёл потому что Recharts не установлен в `package.json`.

**Сколько работы.** 30 минут — `bun add recharts` + переписать 3-4 виджета.

**Где трогать.** `frontend/app/(authenticated)/dashboard/operations/OperationsDashboardClient.tsx`.

---

## 4. Метрики стоимости LLM — раз в сутки, не в реал-тайм

**Что есть.** Метрики `ai_cost_usd_total{provider, model, ...}` обновляются ночью через `DailyCostAggregatorCron` — агрегирует AiUsageLog за вчера.

**Чего нет.** Реал-тайм видимости. Если прямо сейчас тенант начал жечь $10/мин — это видно только утром в дашборде.

**Сколько работы.** 1-2 часа — в `LlmRouterService.dispatch()` после успешного вызова инкрементировать метрику сразу. Сейчас просто пишет в AiUsageLog.

**Где трогать.** `backend/src/modules/ai/services/llm-router.service.ts` — добавить `businessMetrics.addAiCostUsdLabeled(...)` call после успешного adapter response.

---

## 5. Старая таблица PersonRole — оставлена «на откат»

**Что есть.** Новая таблица `Appointment` (правильная: с departmentId, loadPercent, status). Старая `PersonRole` помечена `@deprecated` в schema.prisma, но **не удалена**. В коде feature-flag `USE_APPOINTMENT_FOR_PERSON_ROLES` — если false, читает из PersonRole; если true, читает из Appointment. При создании/обновлении пишет в **обе таблицы** одновременно (страховка).

**Когда удалять.** Через ~1 месяц после прода с `USE_APPOINTMENT=true`. Когда убедимся что Appointment-данные валидны, никто не залогинился через откат на PersonRole — отдельный sub-ТЗ «дропнуть PersonRole + cleanup кода + DROP TABLE».

**Сколько работы.** ~1 час: убрать feature-flag из `PersonsService`, удалить модель PersonRole из schema.prisma + db push, удалить mirror-write в create/update/softDelete.

---

## Дополнительные мелкие техдолги (из shipping-report §5)

### 6. Concierge ServiceMap auto-discovery
**Что есть.** Сейчас 6 tools hardcoded в массиве `ServiceMapGeneratorService.STATIC_TOOLS`.
**Что хочется.** Декоратор `@ConciergeTool({ undoableVia?: 'methodName' })` уже создан в коде. Нужно: при старте сервера сканировать все REST endpoints через NestJS DiscoveryService и автоматически регистрировать tools у которых есть декоратор.
**Сколько работы.** ~1 час.
**Где трогать.** `backend/src/modules/concierge/services/service-map-generator.service.ts`.

### 7. ToolRouter direct service calls
**Что есть.** Concierge вызывает endpoints через HTTP loopback (`fetch http://localhost:3000/api/...`) с passthrough cookie.
**Что хочется.** Прямой DI-injected service call с TenantGuard context — быстрее и надёжнее.
**Сколько работы.** ~1 час refactor.
**Где трогать.** `backend/src/modules/concierge/services/tool-router.service.ts`.

### 8. Brand Voice scope=company → семантика через scope=org
**Что есть.** В `chat-v2` mode='clone_style' scope='org' (existing enum) триггерит инжекцию BrandVoiceProfile в systemPrompt. Семантически это то же что «scope=company».
**Когда чинить.** Если в продукте появится явное различение «персональный клон vs компания» — добавить новый enum value `scope='company'`. Пока работает корректно — не трогать.

### 9. Orchestrator 4-я subagent strategy
**Что есть.** 3 рабочих стратегии: `entity_research`, `comparison`, `topic_summary`. Четвёртая `timeline_construction` оставлена в каркасе.
**Сколько работы.** ~30 минут — реализовать класс по образцу первых трёх.
**Где трогать.** `backend/src/modules/orchestrator/subagents/`.

---

## Резюме простыми словами

| # | Техдолг | Время | Критичность |
|---|---|---|---|
| 1 | Concierge native tool-use protocol | 3-4 ч | Среднее (мониторим метрики, потом фиксим) |
| 2 | WebSocket-микрофон в Concierge UI | 1-2 ч | Низкое (голос через Telegram уже работает) |
| 3 | Recharts в COO dashboard | 30 мин | Низкое (карточки видно, графики красивее) |
| 4 | Реал-тайм метрики стоимости LLM | 1-2 ч | Среднее (только если будет cost-spike incident) |
| 5 | Удалить PersonRole через 1 месяц | 1 ч | Низкое (через месяц прод-наблюдения) |
| 6 | Concierge ServiceMap auto-discovery | 1 ч | Низкое (когда добавим >10 tools) |
| 7 | ToolRouter direct service calls | 1 ч | Низкое (HTTP loopback работает) |
| 8 | scope=company явный enum | 0 ч | Не трогать — работает |
| 9 | Orchestrator 4-я стратегия | 30 мин | Низкое (3 стратегии покрывают 90% запросов) |

**Итого:** ~9 часов, если делать всё подряд. На практике распределить на 2-3 недели и брать по 1-2 в неделю когда появится время.

**Главное:** ни один не блокирует запуск продукта. Всё это «потом, когда увидим что мешает».
