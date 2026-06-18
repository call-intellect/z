---
type: tz
status: ready-to-implement
feature: telegram-assistant-loop-technical-fix
date: 2026-06-16
owner: Сергей (sergrv80@gmail.com)
relates_to:
  - plans/tz/2026-06-13-telegram-assistant-loop-and-scope-fix.md
  - plans/analysis/2026-06-13-telegram-assistant-checkin-incident-and-agent-channel-risks.md
  - plans/tz/2026-06-14-assistant-router-dedup-and-prompt.md
  - docs/operations/feature-flags.md
supersedes: plans/tz/2026-06-13-telegram-assistant-loop-and-scope-fix.md
---
> Разбор инцидента: `plans/analysis/2026-06-13-telegram-assistant-checkin-incident-and-agent-channel-risks.md` · Согласование scope: 2026-06-16 (владелец: «только техническая часть, промпты не трогаем»).

# Помощник в каналах: убрать петлю и неконтролируемый расход — ТОЛЬКО техническая часть

> **Контекст:** инцидент 13.06.2026 — вечерний чек-ин в Telegram: помощник зациклился (повтор каждые ~2–3 с, **40 доставок вебхука на ~6 реплик владельца, ~230 LLM-вызовов**), «Стоп» не помогал. Поток прекратился только когда владелец отозвал ключи (быстрый 401 → быстрый 200 → прокси перестал повторять).
>
> **Это ТЗ — переписанная техническая часть** старого инцидентного ТЗ. Из старого берём **только** инфраструктурные фазы (анти-петля + анти-флуд). Все промптовые/классификаторные фазы старого ТЗ (Ф3 `recentContext`+новый SYSTEM, Ф4 scope-гейт+границы, Ф4.1 CompanyProfile) **исключены** — см. REALITY-CHECK §«Почему промпты вне scope».

## Принцип

**Два разных бага, не путать (порядок = приоритет):**

- **🔴 БАГ №1 — самоподдерживающаяся петля.** Webhook обрабатывается **синхронно в теле HTTP-запроса**: 200 возвращается только ПОСЛЕ всего цикла (`ingestUpdate` с LLM-классификацией → `dispatchInbound` → агентный цикл concierge до 5 итераций). Цикл дольше таймаута прокси `telegram.crossmark.ru` → прокси ретраит тот же `update` → новый полный прогон → снова не успели → снова ретрай. Петля **структурно не затухает**. Плюс нет дедупа по `update_id`, который оборвал бы повтор. **Это даёт 40 запусков вместо 4. Чинится первым (Ф1+Ф2).**
- **🟡 БАГ №2 — помощник отвечал не по теме** (принял отчёт-чек-ин за заказ). **Уже закрыт** другим ТЗ (`2026-06-14-assistant-router-dedup-and-prompt`): блок «ТВОИ ГРАНИЦЫ (строго)» в `concierge-respond.prompt.ts:37-45` и перевод классификатора на актуальные категории. **В этом ТЗ не трогаем.**

«Долбёжка каждые 3 с» = БАГ №1 — он и есть весь предмет этого ТЗ.

---

## REALITY-CHECK (по факту кода на 2026-06-16)

| Что | Факт в коде |
|---|---|
| Синхронный webhook Telegram | ❌ Не исправлен. `processUpdate` ([telegram-webhooks.controller.ts:278-355](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-webhooks.controller.ts#L278)): verify secret → `await adapter.ingestUpdate` ([:320](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-webhooks.controller.ts#L320)) → `await conversational.dispatchInbound` ([:343](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-webhooks.controller.ts#L343)) → только потом `return { ok: true }` ([:354](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-webhooks.controller.ts#L354)). |
| Дедуп `update_id` | ❌ Нет. `update_id` только логируется в catch ([:329](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-webhooks.controller.ts#L329)). |
| Синхронный webhook MAX | ❌ Тот же паттерн ([max-webhooks.controller.ts:93-126](../../backend/src/modules/conversational/adapters/max-bot/max-webhooks.controller.ts#L93)). MAX **не имеет `update_id`** — есть `message.body.mid` ([max.types.ts:71](../../backend/src/modules/conversational/adapters/max-bot/max.types.ts#L71)). |
| Анти-флуд на исходящие | ❌ Нет. `handleAssistantTurn` гоняет агента и шлёт ответ без лимита ([assistant-channel.bridge.ts:188-354](../../backend/src/modules/concierge/services/assistant-channel.bridge.ts#L188)). |
| Очередь-образец | ✅ `conversational.send` — `conversational-queue.ts` (константа+payload), `conversational-queue.service.ts` (обёртка `Queue`+`enqueueSend`, `attempts:1`, jobId-дедуп), `conversational-send.worker.ts` (in-process `Worker`+`PipelineRunner`). |
| Топология процессов | ⚠️ Воркеры живут **IN-PROCESS** (нет `backend/src/workers/main.ts`, `package.json` только `"dev"`/`"start"`; комментарий [conversational.module.ts:129](../../backend/src/modules/conversational/conversational.module.ts#L129) прямо: «Воркер живёт IN-PROCESS»). CLAUDE.md упоминает `worker:dev` как отдельный процесс — **этого процесса в репозитории нет**. Новый inbound-воркер тоже будет in-process. Это НЕ ломает фикс (см. §«Доказательство»). |
| Границы темы в промпте | ✅ Уже есть ([concierge-respond.prompt.ts:37-45](../../backend/src/modules/concierge/prompts/concierge-respond.prompt.ts#L37)) — ТЗ 2026-06-14. Вне scope. |
| Классификатор | ✅ Переведён на 7 категорий ТЗ 2026-06-14 ([classify.prompt.ts:14](../../backend/src/modules/dialog-layer/prompts/classify.prompt.ts#L14)). Приложение А старого инцидентного ТЗ устарело. Вне scope. |
| `ASSISTANT_CHANNEL_ROUTING_ENABLED` | ⚠️ Сейчас **ВКЛ** (`zBool(true)` [env.schema.ts:1107](../../backend/src/common/config/env.schema.ts#L1107), 🟢 [feature-flags.md:119](../../docs/operations/feature-flags.md#L119)). Это значит свободный текст канала идёт в агента, и петля сейчас воспроизводима. |
| RedisService API | ✅ `this.redis.client` = ioredis ([redis.service.ts:20](../../backend/src/common/redis/redis.service.ts#L20)); `SET key val 'EX' 600 'NX'` доступен. Контроллер уже инжектит `RedisService` ([telegram-webhooks.controller.ts:88](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-webhooks.controller.ts#L88)) и `BusinessMetricsService` ([:86](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-webhooks.controller.ts#L86)). MAX-контроллер — **НЕ инжектит** (надо добавить). |

**Почему промпты вне scope:** БАГ №2 («отвечает не по теме / принял отчёт за заказ») уже закрыт ТЗ 2026-06-14. Петля (БАГ №1) от промпта/классификатора **не зависит** — при идеальной классификации лавина случилась бы всё равно, крутились бы «правильные» ответы; петлю создаёт синхронный webhook без дедупа. Любые правки `*.prompt.ts`, `classify.prompt.ts`, SYSTEM-текстов, новые промпт-файлы — **запрещены** в этом ТЗ.

---

## Принятые решения

| # | Решение | Обоснование (Почему) |
|---|---|---|
| Б1 | Тяжёлую обработку вынести в **отдельную BullMQ-очередь `conversational.inbound`** (in-process воркер), webhook отвечает 200 сразу после verify+дедуп+enqueue. | Прокси перестаёт ретраить (получает 200 за миллисекунды → не истекает его таймаут → петля обрывается в корне). Очередь, а не «детач/`setImmediate`»: durable (переживает рестарт), backpressure через `concurrency`, retry, метрики — консистентно с `conversational.send`. Детач даёт неограниченную параллельность тяжёлых LLM-прогонов и теряет работу при рестарте — для пути, который только что устроил runaway-cost, неприемлемо (отвергнутый вариант B, §«Доказательство»). |
| Б2 | Дедуп `update_id` **синхронно в контроллере, до enqueue**: `SET tg:update:<channelId>:<update_id> 1 NX EX 600`. NX вернул не-OK → `return {ok:true}` без enqueue. | Гарантия однократной обработки при at-least-once доставке/гонке/двух репликах. Быстрый ack обрывает шторм ретраев; дедуп — корректность поверх него (нужны **оба**, см. §«Доказательство»). TTL 600 с перекрывает окно ретраев прокси. |
| Б3 | Воркер с самого начала умеет **оба канала** (`kind: 'telegram' | 'max'`), переключаясь по `job.data.kind`; грузит `Channel` по `channelId`, вызывает `adapter.ingestUpdate` → `conversational.dispatchInbound`. | Verify secret уже сделан в контроллере до enqueue — воркер доверяет job. Один воркер на оба канала = меньше дублирования; MAX-паритет (C7) = только переключить MAX-контроллер на enqueue. |
| Б4 | MAX-ключ дедупа: `max:update:<channelId>:<mid>`; если `mid` отсутствует — fallback `max:update:<channelId>:ts<timestamp>:<chatId>`; если и того нет — **дедуп пропускаем** (fail-open, обрабатываем). | У MAX нет `update_id`; `message.body.mid` — стабильный id сообщения ([max.types.ts:71](../../backend/src/modules/conversational/adapters/max-bot/max.types.ts#L71)). Быстрый ack (главный фикс) работает для MAX независимо от качества ключа. |
| Б5 | Любой сбой Redis/enqueue в контроллере → **fail-open: вернуть 200**, залогировать, метрика. Дедуп при сбое Redis считается «не дубль» (обрабатываем). | Лучше редкий дубль, чем потеря всех сообщений при недоступном Redis. Возврат не-200 заставил бы прокси ретраить → риск нового шторма. Тот же fail-open-паттерн, что в мосте ([assistant-channel.bridge.ts:199-204](../../backend/src/modules/concierge/services/assistant-channel.bridge.ts#L199)). |
| Б6 | Анти-флуд — **гейт на входе `handleAssistantTurn`, ДО запуска агента** (не только перед `sendChatReply`): per-binding счётчик `concierge:outrate:<bindingId>` (`INCR`, `EXPIRE 60` при первом). Превышен лимит → ход пропущен целиком (агент не запускается, ответ не шлётся), метрика+лог. | Экономит и токены, и доставку (не «уже сожгли LLM, а потом не отправили»). Per-binding — потому что в инциденте всё было один binding/conversation/user. Без стоп-слов: пользователь их не знает, защита работает сама в коде. |
| Б7 | Лимит анти-флуда — крутилка **AdminSetting `assistant.channel.max_replies_per_minute`, дефолт 3**, через `cfg.getDynamic<number>(...)` с code-fallback. | Крутилки идут в AdminSetting, не в ENV/хардкод (правило проекта). Дефолт 3: человек не нуждается в >3 ответах помощника в минуту в одном чате; это потолок-предохранитель, при норме не срабатывает. Поднять до большого числа = фактически выключить. |
| Б8 | **Новых feature-флагов не вводим.** Ф1/Ф2 — багфикс (строго лучше прежнего, Ship-On — флаг «понаблюдаем» запрещён). Ф3 — крутилка-лимит (Ship-On, работает с дефолтом). | Откат async→sync вернул бы петлю — kill-switch на это был бы footgun. Откат через `git revert`, не через флаг. |

---

## Доказательство выбора (почему фикс реально уберёт петлю)

**Вопрос владельца: «убедись, что это всё поможет».** Разбор по механике (подтверждён кодом и прод-логами из анализа §8.1):

**Почему быстрый ack обрывает петлю.** Триггер ретрая прокси — **истечение его таймаута ожидания 200** на синхронном запросе (обработка 20–30 с > таймаута). Если контроллер возвращает 200 за ~1 мс (после verify+дедуп+enqueue), таймаут прокси **никогда не наступает** → прокси **не ретраит**. Петля «не успели → повтор» исчезает структурно. Прод-данные подтверждают механизм: лавина затухла ровно когда 401 сделал ответ быстрым (быстрый ответ → прокси доволен → нет повтора).

**Почему нужен ещё и дедуп (а не только ack).** Telegram гарантирует **тот же `update_id`** при повторной доставке. Даже при быстром ack возможна повторная доставка по другим причинам: at-least-once семантика Telegram/прокси, две реплики backend за балансировщиком, доставка-в-полёте на момент выката. Дедуп `SET NX` гарантирует, что **один `update_id` = один прогон агента**, независимо от числа доставок. Итог: **ack убирает шторм, дедуп убирает двойную обработку — нужны оба** (ack — первичный фикс петли, дедуп — корректность поверх него).

**Третий слой (бонус, без отдельного кода-решения):** jobId очереди = `<kind>inbound_<channelId>_<update_id>` — BullMQ не создаст дубль job с тем же jobId в окне `removeOnComplete`. Это естественная страховка поверх Redis-дедупа.

**In-process воркер не мешает.** LLM-вызовы — это сетевые `await` (event-loop не блокируется), а HTTP-ответ возвращается ДО постановки работы воркеру. Даже в одном процессе webhook отвечает мгновенно; durability/concurrency очереди работают как у `conversational.send`.

### Состязательная таблица: вынос обработки

| Критерий | A. BullMQ-очередь `conversational.inbound` (выбран) | B. Детач/`setImmediate` после 200 |
|---|---|---|
| Обрывает петлю (быстрый 200) | ✅ да | ✅ да |
| Durability при рестарте/краше | ✅ job в Redis, переживёт | ❌ работа в полёте теряется |
| Backpressure при всплеске | ✅ `concurrency`-кап | ❌ неограниченная параллельность тяжёлых LLM-прогонов |
| Retry транзиентных сбоев | ✅ есть | ❌ нет |
| Наблюдаемость (метрики/состояния job) | ✅ есть | ❌ опаковый |
| Консистентность с кодбазой | ✅ как `conversational.send` | ⚠️ новый паттерн |
| Простота | ⚠️ +2-3 файла | ✅ ~5 строк |

→ A. Единственный плюс B — простота, но цена (неограниченная параллельность + потеря при рестарте) недопустима для пути, где только что был runaway-cost. Это и рекомендация старого ТЗ (вариант «б»).

### Challenge-loop
- **Корень, не симптом?** Да: чиним механизм (синхронность + отсутствие дедупа), а не конкретную фразу/тип события. Любой медленный ход (ASR голоса, документ, медленный LLM — риск C1) теперь не вызовет шторм.
- **Самое эффективное?** Да: одна очередь+воркер закрывает оба канала; анти-флуд — дешёвый Redis-счётчик. Без преждевременной оптимизации (нет шардирования/отдельного процесса — воркеры и так in-process).
- **Нет кода ради кода?** Нет: переиспользуем готовый паттерн `conversational.send`; ни одного нового флага; ни одного мёртвого задела.

---

## Scope

**Входит:**
- Новая BullMQ-очередь `conversational.inbound` (константа+payload, обёртка-сервис, in-process воркер) — по образцу `conversational.send`.
- Telegram-контроллер: дедуп `update_id` (Redis `SET NX`) + быстрый ack + enqueue вместо синхронных `ingestUpdate`/`dispatchInbound` на всех трёх входах (`@Post()`, `@Post('s/:secret')`, `@Post(':tenantId')`).
- MAX-контроллер: тот же паттерн (дедуп по `mid`, enqueue), + инжект `RedisService`/`BusinessMetricsService`.
- Анти-флуд на входе `handleAssistantTurn` в мосте + крутилка AdminSetting `assistant.channel.max_replies_per_minute`.
- Метрики `conversational_inbound_deduped_total{kind}`, `assistant_channel_flood_suppressed_total{kind}`.
- Регистрация новых провайдеров в `conversational.module.ts`.

**Не входит (явно):**
- **Любые промпты/классификатор** (`*.prompt.ts`, `classify.prompt.ts`, SYSTEM-тексты) — БАГ №2 закрыт ТЗ 2026-06-14, петля от них не зависит.
- **R7** (flash validate-fail → fallback удлинял ход, анализ §8.1) — это LLM-роутер-резильентность, отдельная тема (ТЗ `2026-06-05-llm-router-resilience-*`), не раздуваем.
- **C5** (блокировка бота не останавливает уже запущенную генерацию) — нужен предварительный вызов Telegram API на статус блока на каждый ход; первичный вектор расхода (петля) убивается Ф1+Ф3. Вынести в `second-brain/04_не-сделано` как future (строка `assistant-skip-generation-if-blocked`).
- **Широкий анти-флуд на весь outbound** (cron/event-loop через `conversational.send`) — риск подавить легитимные уведомления; в инциденте флуд шёл из агентного пути (мост), его и гейтим. Future, если всплывёт другой источник.
- **A5** (confirm для `create_event`/`create_meeting` из болтовни) — отдельная продуктовая история, не про петлю.

**Граничные контракты:**
- `concierge-respond.prompt.ts` / `classify.prompt.ts` — **read-only**, не редактировать.
- `ChannelRegistry`/адаптеры `send()` — не трогаем (это outbound); inbound-воркер вызывает `adapter.ingestUpdate` напрямую через инжект концретных адаптеров.

---

## Контракты (дословно для копипасты)

### Очередь `conversational.inbound`

Новый файл `backend/src/modules/conversational/queue/conversational-inbound-queue.ts`:
```ts
/**
 * BullMQ-очередь INBOUND-обработки для ConversationalModule (анти-петля,
 * ТЗ 2026-06-16). Webhook кладёт сюда сырой update и сразу отвечает 200;
 * тяжёлую обработку (ingestUpdate с LLM + dispatchInbound → агент) делает
 * воркер асинхронно. Образец — conversational.send.
 *
 * jobId = `<kind>inbound_<channelId>_<dedupKey>` — третий слой дедупа
 * поверх Redis SET NX в контроллере.
 */
export const CONVERSATIONAL_INBOUND_QUEUE = 'conversational.inbound';

export interface ConversationalInboundJobData {
  /** Канал, через который пришёл update (для повторного резолва Channel). */
  channelId: string;
  kind: 'telegram' | 'max';
  /** Сырой update как пришёл в webhook (после verify secret). */
  rawUpdate: unknown;
  /** tenantId если известен (legacy telegram / max), иначе резолвится из отправителя. */
  tenantId?: string;
}
```

### Дедуп + ack в контроллере (Telegram `processUpdate`)

Заменить тело после verify secret (сейчас [:317-354](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-webhooks.controller.ts#L317)) на:
```ts
// 2. Дедуп update_id (Redis SET NX). Fail-open при сбое Redis.
const updateId = args.body?.update_id;
if (typeof updateId === 'number') {
  const dedupKey = `tg:update:${args.channel.id}:${updateId}`;
  try {
    const set = await this.redis.client.set(dedupKey, '1', 'EX', 600, 'NX');
    if (set === null) {
      this.metrics.incConversationalInboundDeduped({ kind: 'telegram' });
      return { ok: true }; // дубль — мгновенный ack, без обработки
    }
  } catch (err) {
    this.logger.warn(/* … */); // fail-open: продолжаем как не-дубль
  }
}

// 3. Enqueue сырого update + быстрый ack. Fail-open при сбое enqueue.
try {
  await this.inboundQueue.enqueueInbound({
    channelId: args.channel.id,
    kind: 'telegram',
    rawUpdate: args.body,
    ...(args.tenantId ? { tenantId: args.tenantId } : {}),
    dedupKey: typeof updateId === 'number' ? String(updateId) : undefined,
  });
} catch (err) {
  this.logger.error(/* … */); // 200 всё равно, чтобы прокси не ретраил шторм
}
return { ok: true };
```
> `ingestUpdate`/`dispatchInbound` из контроллера **удаляются** — переезжают в воркер.

### Воркер (оба канала)

Новый файл `backend/src/modules/conversational/queue/conversational-inbound.worker.ts` — по образцу `conversational-send.worker.ts` (in-process `Worker`, обёрнут `PipelineRunner`, `concurrency` из конфига). Логика `process(job)`:
1. Загрузить `Channel` по `job.data.channelId` (если нет/неактивен → no-op + лог).
2. Выбрать адаптер по `job.data.kind` (инжект `TelegramBotChannelAdapter` и `MaxBotChannelAdapter`).
3. `const inbound = await adapter.ingestUpdate({ update: job.data.rawUpdate, tenantId: job.data.tenantId, channel })`.
4. `if (!inbound) return;`
5. `await this.conversational.dispatchInbound(inbound)`.
6. Любая ошибка — лог + проброс (BullMQ зафиксирует failed; ретраи inbound не делаем — `attempts: 1`, как у send, чтобы не множить агентные прогоны).

### Анти-флуд (мост)

В начале `handleAssistantTurn` ([assistant-channel.bridge.ts:188](../../backend/src/modules/concierge/services/assistant-channel.bridge.ts#L188)), сразу после `if (msg.type !== 'assistant_turn') return;`:
```ts
// Анти-флуд: per-binding потолок ответов/мин. Гейт ДО агента — экономим
// токены и доставку. Fail-open при сбое Redis.
if (msg.originChannelBindingId) {
  const limit = await this.resolveMaxRepliesPerMinute(); // getDynamic, default 3
  const key = `concierge:outrate:${msg.originChannelBindingId}`;
  try {
    const n = await this.redis.client.incr(key);
    if (n === 1) await this.redis.client.expire(key, 60);
    if (n > limit) {
      this.metrics.incAssistantChannelFloodSuppressed({ kind: 'telegram' });
      this.logger.warn({ bindingId: msg.originChannelBindingId, n, limit },
        'assistant_turn подавлен анти-флудом (> лимита/мин в один чат)');
      return; // агент не запускается, ответ не шлётся
    }
  } catch { /* fail-open: продолжаем */ }
}
```

### Метрики (по образцу `getOrCreateCounter`, [business-metrics.service.ts:1682](../../backend/src/common/metrics/business-metrics.service.ts#L1682), [:2681](../../backend/src/common/metrics/business-metrics.service.ts#L2681))
```ts
// conversational_inbound_deduped_total{kind} — дубль update отсечён на входе.
// assistant_channel_flood_suppressed_total{kind} — ход подавлен анти-флудом.
incConversationalInboundDeduped(args: { kind: string }): void { /* .inc({kind}) */ }
incAssistantChannelFloodSuppressed(args: { kind: string }): void { /* .inc({kind}) */ }
```

### Крутилка
- AdminSetting key `assistant.channel.max_replies_per_minute`, дефолт **3**, чтение через `cfg.getDynamic<number>('assistant.channel.max_replies_per_minute', 3)` с defensive try/catch и code-fallback (паттерн [concierge.service.ts:685](../../backend/src/modules/concierge/services/concierge.service.ts#L685)). Строка в `docs/operations/feature-flags.md` (раздел крутилок).

---

## Границы фичи
- ✅ **Always:** дедуп+ack на всех входах обоих каналов; fail-open при сбое Redis; in-process воркер; переиспользование паттерна `conversational.send`.
- ⚠️ **Ask first:** менять дефолт лимита анти-флуда ≠ 3; вводить BullMQ-side `attempts > 1` для inbound (риск умножения агентных прогонов); широкий анти-флуд на весь outbound.
- 🚫 **Never:** трогать `*.prompt.ts`/`classify.prompt.ts`/SYSTEM; вводить новый feature-флаг «понаблюдаем→включим»; возвращать не-2xx из webhook при сбое обработки; `setImmediate`/детач вместо очереди; стоп-слова в логике.

---

## Фазы (dependency-ordered)

Граф: **Ф1 → Ф2** (Ф2 переиспользует очередь+воркер из Ф1). **Ф3** независима (можно параллельно с Ф1/Ф2). Порядок коммитов: Ф1 → Ф2 → Ф3.

### Ф1 — Очередь `conversational.inbound` + воркер + Telegram-контроллер (быстрый ack + дедуп) 🔴 КОРЕНЬ
**Цель.** Webhook Telegram отвечает 200 за миллисекунды; тяжёлая обработка — в воркере; дубль `update_id` отсекается на входе.
**Входит.** Файл очереди (контракт выше); обёртка `enqueueInbound` (в `conversational-queue.service.ts` добавить второй `Queue`, либо новый `ConversationalInboundQueueService` — **рекомендация: новый сервис**, чтобы не смешивать inbound/outbound ответственность); воркер (оба `kind`); правка `processUpdate` (дедуп+ack+enqueue, удалить синхронные ingest/dispatch); регистрация провайдеров в `conversational.module.ts:179` (рядом с `ConversationalSendWorker`); метрика `incConversationalInboundDeduped`.
**Что НЕ входит.** MAX-контроллер (Ф2); анти-флуд (Ф3); промпты.
**Файлы.** `queue/conversational-inbound-queue.ts` (new), `queue/conversational-inbound-queue.service.ts` (new), `queue/conversational-inbound.worker.ts` (new), `adapters/telegram-bot/telegram-webhooks.controller.ts`, `conversational.module.ts`, `common/metrics/business-metrics.service.ts`.
**Acceptance.**
- Греп: `CONVERSATIONAL_INBOUND_QUEUE = 'conversational.inbound'` существует; `ConversationalInboundWorker` в `providers` модуля.
- `processUpdate` НЕ содержит `await this.adapter.ingestUpdate` и `await this.conversational.dispatchInbound` (грепом подтвердить отсутствие); содержит `this.redis.client.set(` с `'NX'` и `enqueueInbound(`.
- Unit: повтор того же `update_id` → второй вызов не делает enqueue (мок очереди вызван 1 раз), метрика deduped инкрементнута; сбой Redis (`set` бросает) → enqueue всё равно вызван (fail-open).
- Unit воркера: `process(job)` с валидным update → `adapter.ingestUpdate` + `dispatchInbound` вызваны; `inbound===null` → `dispatchInbound` НЕ вызван.
- `bun run typecheck` + `lint` + `build` зелёные; `bunx vitest run` новых spec зелёный.

Закрывает: R1, R2, R3, R6.

### Ф2 — MAX-контроллер: паритет (дедуп по `mid` + ack + enqueue)
**Цель.** Тот же анти-петля-паттерн на втором канале (C7).
**Входит.** Инжект `RedisService`+`BusinessMetricsService`+`ConversationalInboundQueueService` в `MaxWebhooksController`; дедуп `max:update:<channelId>:<mid>` (fallback по timestamp/chatId; нет ключа → fail-open); enqueue с `kind:'max'`; удалить синхронные `ingestUpdate`/`dispatchInbound`.
**Что НЕ входит.** Изменение `MaxBotChannelAdapter.ingestUpdate` (воркер вызывает как есть).
**Файлы.** `adapters/max-bot/max-webhooks.controller.ts`, `conversational.module.ts` (если нужны новые импорты в DI — уже в модуле).
**Acceptance.**
- Греп: `MaxWebhooksController` инжектит `RedisService` и `ConversationalInboundQueueService`; `receive` содержит `enqueueInbound(` с `kind: 'max'` и НЕ содержит `await this.conversational.dispatchInbound`.
- Unit: дубль по `mid` → один enqueue; update без `mid` и без `timestamp` → enqueue без дедупа (fail-open, метрика deduped НЕ инкрементнута).
- typecheck+lint+build+vitest зелёные.

Закрывает: R4 (паритет MAX).

### Ф3 — Анти-флуд в мосте + крутилка + метрика
**Цель.** Любая будущая петля в агентном пути упирается в потолок N ответов/мин на чат; агент не запускается сверх лимита.
**Входит.** Гейт в начале `handleAssistantTurn` (контракт выше); метод `resolveMaxRepliesPerMinute` (`getDynamic`, default 3, code-fallback); метрика `incAssistantChannelFloodSuppressed`; строка крутилки в `docs/operations/feature-flags.md`.
**Что НЕ входит.** Стоп-слова; широкий outbound-лимит; промпты.
**Файлы.** `concierge/services/assistant-channel.bridge.ts`, `common/metrics/business-metrics.service.ts`, `docs/operations/feature-flags.md`.
**Acceptance.**
- Греп: `concierge:outrate:` и `incAssistantChannelFloodSuppressed` в `assistant-channel.bridge.ts`; никаких стоп-слов («стоп»/«хватит») в новой логике.
- Unit: при лимите 3 — 4-й ход в ту же минуту в один binding → `concierge.process` НЕ вызван, ответ НЕ отправлен, метрика инкрементнута; сбой Redis (`incr` бросает) → ход обработан как обычно (fail-open).
- typecheck+lint+build+vitest зелёные.

Закрывает: R5.

---

## Требования (EARS)
- **R1.** Когда webhook получает update, система shall вернуть HTTP 200 ДО запуска `ingestUpdate`/`dispatchInbound` (тяжёлая обработка — в очереди `conversational.inbound`).
- **R2.** Если `update_id` (Telegram) уже виден в окне 600 с, то система shall вернуть 200 без повторной обработки и инкрементнуть `conversational_inbound_deduped_total`.
- **R3.** Если Redis недоступен на дедупе/enqueue, то система shall вернуть 200 и (для дедупа) обработать update как не-дубль (fail-open), залогировав сбой.
- **R4.** Когда update приходит на MAX-webhook, система shall применить тот же ack+дедуп (ключ по `mid`/fallback) и enqueue с `kind:'max'`.
- **R5.** Если в один `originChannelBindingId` за 60 с уже было ≥ `assistant.channel.max_replies_per_minute` ходов помощника, то система shall не запускать агента и не отправлять ответ для последующих ходов в этом окне, инкрементнув `assistant_channel_flood_suppressed_total`.
- **R6.** Когда воркент `conversational.inbound` обрабатывает job, система shall выполнить `ingestUpdate`→`dispatchInbound` ровно один раз на job (`attempts: 1`, без BullMQ-side retry).

---

## Pre-mortem / Риски
- **Дубль при гонке двух реплик до `SET NX`.** SET NX атомарен в Redis — выигрывает одна реплика; вторая получает `null` → ack без обработки. Закрыто.
- **Потеря сообщения при недоступном Redis (fail-open enqueue упал).** Редко (Redis down = более крупный инцидент). Лог+метрика; не возвращаем не-200 (иначе шторм). Принято.
- **`attempts:1` теряет job при краше воркера в полёте.** Осознанно: ретрай агентного прогона опаснее (двойной ответ + расход), чем потеря одного хода. Как у `conversational.send`.
- **Анти-флуд подавит легитимный быстрый диалог.** Лимит 3/мин на чат для ассистента — заведомо выше нормального темпа; крутилка тюнится по проду.
- **Ревью-аспекты (`strict-production-review-gate`):** идемпотентность дедупа; нет проброса не-2xx; fail-open ветки; tenant-скоупинг ключей (через `channelId`/`bindingId`); отсутствие правок промптов (грепом).

---

## Порядок выката и `ASSISTANT_CHANNEL_ROUTING_ENABLED`
- Флаг сейчас **ВКЛ**, и петля воспроизводима. **Рекомендация:** выкатить Ф1+Ф2+Ф3 одним релизом и оставить флаг ВКЛ — петля убрана в корне, выключать не нужно. **Если выкат откладывается** — как немедленную страховку временно выставить `ASSISTANT_CHANNEL_ROUTING_ENABLED=false` (аварийный откат на узкий free_note-роутер), вернуть ВКЛ после выката фикса. [ASSUMPTION: владелец предпочтёт выкатить фикс, а не жить с выключенным помощником; решение — за владельцем при выкате.]

## Prod-операции (Шаги `docs/operations/prod-deploy-log.md`)
- **ENV:** новых нет.
- **Шаг 12 (smoke):** новая BullMQ-очередь `conversational.inbound` — добавить grep-проверку, что воркер поднялся (лог `ConversationalInboundWorker запущен`).
- **AdminSetting:** `assistant.channel.max_replies_per_minute=3` — code-fallback, seed не обязателен; опц. строка в Шаг 7 для видимости в админке.
- Прочее: `docker compose up -d --build backend`.

## DoD
- [ ] Ф1–Ф3 реализованы; `typecheck`(вкл. `.spec`)+`lint`+`build`+`vitest` зелёные.
- [ ] Грепом подтверждено: webhook'и не вызывают синхронно `dispatchInbound`; промпты/классификатор не изменены (`git diff` не трогает `*.prompt.ts`/`classify.prompt.ts`).
- [ ] `second-brain/03_processes/telegram-inbox-ingestion.md` обновлён (новый асинхронный путь через очередь).
- [ ] `second-brain/01_projects/workers-queues.md` + `ai-jobs.md` — новая очередь/воркер.
- [ ] `docs/operations/feature-flags.md` — строка крутилки; `prod-deploy-log.md` Шаг 12.
- [ ] `second-brain/04_не-сделано/README.md` — строки future (C5 `assistant-skip-generation-if-blocked`, широкий outbound-лимит).
- [ ] Рефлексия в `second-brain/05_история/`.

## Итог
_(заполняет tz-orchestrator после реализации)_ — реализовано целиком / частично, что осталось.
