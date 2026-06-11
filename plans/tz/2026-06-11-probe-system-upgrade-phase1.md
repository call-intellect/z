---
type: tz
status: ready-to-implement
feature: probe-system-upgrade-phase1
date: 2026-06-11
owner: sergrv80 (владелец продукта Кора)
relates_to:
  - plans/analysis/2026-06-11-proactive-clarifying-questions-probe-research.md
  - plans/tz/2026-06-11-cabinet-leftovers-ui-probe-chat.md
  - plans/analysis/2026-06-10-notifications-probe-subsystem.md
---
> Анализ: `plans/analysis/2026-06-11-proactive-clarifying-questions-probe-research.md` (research-complete, §8 Фаза 1, §9 промпты A/B, §10 принятые решения Р1–Р5) · Статус согласования: 2026-06-11 (владелец делегировал выбор, решения доказаны в §10).

# ТЗ: Probe-система — Фаза 1 (политика инициирования + формулировка)

**Принцип.** Корень жалобы «вопросы probe не понравились» — НЕ только текст, а отсутствие политики инициирования (модели «стоит ли спрашивать»). Лечим дешёвым пакетом правил+промпт (~80% эффекта), который ОДНОВРЕМЕННО собирает калибровочные данные для будущей Фазы 2 (LLM-judge). Каждое решение доказано в анализе §10. **Не оптимизируй scope по-своему** — порядок фаз доказан (мета-доказательство §10): тяжёлый LLM-judge/VoI сейчас НЕ вводим, он без калибровочных данных врёт.

---

## REALITY-CHECK (что уже есть/сделано — НЕ переделывать)

Проверено по коду и git-журналу 2026-06-11 (ветка `feature/meeting-cabinet-fixes-2026-06-10`, коммиты `a088e25d`/`dbde0d57`):

| Что | Статус по факту | Вывод для этого ТЗ |
|---|---|---|
| **Адресация probe субъекту** (`resolveProbeRecipients`, `probe-recipient.util.ts`, kill-switch `PROBE_SUBJECT_ADDRESSING_ENABLED`) | ✅ Сделано §3 Ф1 `a088e25d` — probe «про X» → `[субъект, глава отдела, owner]` | **НЕ трогаем.** Граничный контракт §G1. Адресация из плана-анализа (п.4) уже закрыта. |
| **Правило «без кодов/ID» в `probe-formulate` SYSTEM** | ✅ Добавлено §3 Ф2 `dbde0d57` (4-я строка SYSTEM) | Поверх: Ф1 переписывает SYSTEM целиком (вариант §9-B), правило сохраняется и усиливается. |
| **Fallback `humanizeProbeFallback`** (`probe-dispatcher.worker.ts:35`) — чистит cuid, обрезает | ✅ «Человечнее payload.message» §3 Ф2 | Поверх: Ф1 заменяет на per-reason заготовленный вопрос (всё ещё показывает шаблон — это и есть остаток). |
| **Единый бюджет между источниками** | ⚠️ Частично: `ProbeService.filterByRateLimit` (`probe.service.ts:221`) — rate-limit per-user (5/час, 20/день) УЖЕ общий по `userId` независимо от эмиттера. НО при превышении **ДРОПАЕТ** probe (`status='dropped_rate_limit'`, `probe.service.ts:118-131`), не откладывает; нет «касание-капа»; нет приоритизации при лимите. | Ф3: превратить «дроп при лимите» в «отложить в дайджест» + касание-кап + immediate-исключение по окну. Бюджет не вводим заново — он есть. |
| **Quiet hours инфраструктура** | ⚠️ ENV `PROBE_QUIET_HOURS_DEFAULT_TZ_OFFSET_MIN=180` есть; `ConversationalService` учитывает preferences (комментарий `probe-dispatcher.worker.ts:59`) | Ф3 опирается на существующее, тихие часы заново не строим. |
| **Голосовой ответ / классификатор ответа** | ✅ `PROBE_VOICE_INPUT_ENABLED`, `PROBE_RESPONSE_CLASSIFY_ENABLED`, `probe-response-classify.prompt.ts` | Ф6 встраивается в существующий `probe-response.handler.ts`. |
| **`requiresFollowup` из классификатора** | ⚠️ Возвращается, но **игнорируется** (`probe-response.handler.ts:211` — деструктурируется, не используется) | Re-ask петля — **НЕ Фаза 1** (Фаза 3, §10 Р3). Не трогаем. |

**Промпт `probe-formulate` сейчас (подтверждено):** `backend/src/modules/knowledge-core/prompts/probe-formulate.prompt.ts` — SYSTEM 4 строки (с правилом «без кодов»), USER-шаблон **всё ещё подаёт машинные коды** `Источник: специалист <emittedByService>` + `Причина: <reason>` (строки 45-47) — противоречие SYSTEM, корень «модель не понимает». Schema `probe_formulate_v2 {question}`. Берётся из код-константы напрямую в `probe-dispatcher.worker.ts:237` (НЕ через prompt-registry).

**Параллельная сессия активна** (коммиты сегодня: промпты-MASTER few-shot, ASR-тайминги, кабинет-волна-1). Это ТЗ — только документ; при реализации `tz-orchestrator` обязан `git fetch` + свериться, не трогать файлы вне списка ниже.

---

## Цель + Зачем

**Болезненное состояние:** probe-вопросы воспринимаются как «глупые» — формулировка генеричная (модель не понимает контекст), вопросы идут не вовремя и без меры (дроп вместо отложить, нет окна по типу), ответ уходит «в пустоту» (нет видимого следствия → отвечаемость падает). Доказательная база — анализ §5, §6.

**Чем решение лучше (research-цитаты):** few-shot+персона в промпте формулировки (MS Copilot declarative instructions `[verified]`), окно полезности по типу пробела (Ask-Early-Late-Right `[verified]`), батч вместо дропа против fatigue (EMA: батч −50% частоты, −6.5 стресса; >10/час → −52% отклика `[triangulated]`), видимое следствие — главный драйвер отвечаемости (WorkTango; реакция в 5 дней → +20% `[triangulated]`).

**Метрика «решено»** (Ф0-style, наблюдаем прод): рост `probe_recipient_engagement_rate` (отвечаемость), падение доли `probe_response_unclear_total` от ответов, замена `probe_rate_limit_dropped` на отложенный-в-дайджест (новая метрика), рост `probe_answer_ack` (видимое следствие доставлено).

---

## Доказательство выбора (ссылка)

Полная матрица вариантов (A: только промпт+правила / B: +LLM-judge / C: +VoI+обучение) с состязательным red-team — анализ §7. Вывод: **Фаза 1 = вариант A** (доказано §10 Р1–Р5 + мета-доказательство). LLM-judge/VoI/re-ask/семантический-дедуп — **вне Фазы 1** (см. «Дальнейшие фазы»). Здесь не пересматриваем.

---

## Scope

### Входит (6 под-фаз)
- **Ф1** — переписать `probe-formulate` (промпт §9-B: персона+цель+правила+few-shot+self-check), убрать машинные коды из USER (словарь `reason→reasonLabel`), schema v2→v3, per-reason fallback вместо сырого `humanizeProbeFallback`.
- **Ф2** — маппинг `reason → {window, recheck}` (тип пробела: immediate/deferrable + предикат «повод ещё актуален»). Подготовка к Ф3/Ф4.
- **Ф3** — батч-дайджест probe: при deferrable-окне ИЛИ превышении бюджета — НЕ дроп, а отложить и слать дайджестом 1–2×/день; immediate (priority high / immediate-окно) — точечно сразу; касание-кап N. Крутилки — AdminSetting.
- **Ф4** — recheck повода перед dispatch (answer-first lite): перед отправкой перечитать исходную сущность; если пробел уже закрылся сам — отменить probe (`status='suppressed_stale'`).
- **Ф5** — adaptive fatigue: игнор/no-answer → снижать частоту для этого человека + cooldown темы (48ч) + лог `accept/ignore` как сигнал (калибровочные данные для Фазы 2).
- **Ф6** — видимое следствие: после ответа — уведомление-подтверждение «ваш ответ записан в память» + контекст объекта (кабинет/текст) + строка в дайджесте.

### Не входит (см. «Дальнейшие фазы»)
- LLM-judge ценности вопроса (Фаза 2 — нужны калибровочные данные из Ф5; §10 Р3).
- Семантический дедуп через pgvector (Фаза 2).
- Re-ask петля + использование `requiresFollowup` + память предпочтений тона (Фаза 3, §10).
- Полноценный graph-answer-search «вывести ответ из графа» в стиле Glean (Ф4 делает только lite-recheck повода — полный поиск дорог/неоднозначен для 15 источников, отложен в Фазу 2).
- Адресация probe (уже сделана §3 Ф1 — граничный контракт §G1).
- Изменения в `probe-response-classify`, голосовом вводе, quiet-hours (используем как есть).

---

## Граничные контракты с другими ТЗ / кодом

- **§G1 — Адресация (`resolveProbeRecipients`, kill-switch `PROBE_SUBJECT_ADDRESSING_ENABLED`).** Реализована §3 Ф1 `a088e25d`. Это ТЗ её **не меняет**. Ф3 (выбор получателя дайджеста) использует уже выбранного `selectedRecipientId`/`recipientCandidates[0]` — ту же логику, что dispatcher. Батчинг группирует по `recipientUserId`, не переопределяя адресацию.
- **§G2 — `ConversationalService.sendNotification`.** Контракт: `sendNotification(input: SendNotificationInput): Promise<Notification>`, валидирует `payload` по `eventType` через `event-payload.registry.ts`. Новые eventType (Ф3 дайджест, Ф6 подтверждение) ОБЯЗАНЫ зарегистрировать Zod-схему в `registry` (`event-payload.registry.ts:381`), иначе допускается любой JSON (нежелательно). Не реализуем сам транспорт — он есть.
- **§G3 — AdminSetting крутилки.** Читать через `TypedConfigService.getDynamic<T>(key, envFallbackKey?, default)` (async, `typed-config.service.ts:2568`; образец — `documents` геттер :1206). Регистрировать ключ в `admin-setting-schema-registry.ts` (`POSITIVE_INT` и т.п., :28/:64). Параметры бюджета/окон/времени дайджеста — туда, НЕ ENV (`feedback_admin_settings_not_env_or_code`).
- **§G4 — daily-digest как ОБРАЗЕЦ (не зависимость).** `operations/services/daily-digest.service.ts` — эталон двухстадийного дайджеста с идемпотентностью `@@unique`, upsert, `deliveredAt`, fallback. Probe-дайджест — отдельный механизм (per-recipient, не per-Org), но повторяет паттерн. Не встраивать probe в daily-digest (разные адресаты/назначение).

---

## Принятые решения (Б-нумерация, с обоснованием)

| # | Решение | Обоснование (Почему) |
|---|---|---|
| **Б1** | Промпт §9-B (полный few-shot), НЕ §9-A | §10 Р1: корень «модель не понимает»; few-shot обязателен (MS Copilot `[verified]`); CLAMBER-возражение не применимо (formulate не гейтит). §9-A — code-fallback на Ollama. |
| **Б2** | `probe-formulate` крутить на capable-модели, A как code-fallback | §10 Р1: длинный промпт хуже на tertiary Ollama (`feedback_ollama_tertiary_only_deepseek_flash_cheap`). `taskType='probe-formulate'` уже маршрутизируется через `LlmRouterService`; модель — через реестр маршрутов, не в коде. |
| **Б3** | Машинные коды убрать из USER, заменить `reasonLabel` (рус. ярлык) | Корень противоречия: SYSTEM запрещает коды, USER их подаёт. Словарь `reason→reasonLabel` в коде (≈30 кодов, статичен). |
| **Б4** | Бюджет НЕ вводим заново — он есть (per-user rate-limit). Меняем «дроп» на «отложить в дайджест» | REALITY-CHECK: `filterByRateLimit` уже общий по userId. Gap = дропает. Не плодить второй бюджет. |
| **Б5** | Окно по типу — статичный маппинг `reason→window` в коде, дефолт `deferrable` | ~30 reason-кодов, маппинг детерминирован (Ask-Early-Late-Right `[verified]`); не БД, не AdminSetting (это логика, не крутилка). Пороги-числа (касание-кап, час дайджеста) — AdminSetting. |
| **Б6** | Ф4 = recheck ПОВОДА перед dispatch, НЕ полный graph-answer-search | Challenge-loop: полный поиск ответа в графе для 15 разнородных источников — дорого/неоднозначно, преждевременно. Recheck по `contextCardId` (перечитать сущность) — дёшево (1 read by id), бьёт реальный кейс «пробел закрылся между suggest и dispatch». Полный поиск → Фаза 2. |
| **Б7** | Видимое следствие = подтверждение «ответ записан» + контекст объекта, НЕ реальный дифф графа | Граф обновляется асинхронно (воркеры) — синхронного диффа нет. Честное подтверждение + название объекта (`contextCardTitle`) даёт 80% эффекта «видимого следствия» (WorkTango). |
| **Б8** | Батч-механизм — новый `ProbeStatus='queued_digest'` + `ProbeDigestCron`, БЕЗ новой Prisma-модели для probe | Probe уже персистятся в `ProbeEvent`. Дайджест — это группировка при доставке, не новая сущность. Cron собирает `queued_digest` по recipient → один notification → `dispatched`. |

---

## Совместимость с prompt caching (обязательно для LLM-фич)

Ф1 правит `probe-formulate` SYSTEM — **разовый сброс кэша**, далее стабильно (как отмечено в §3 Ф2). Требование: новый SYSTEM (промпт §9-B с few-shot) **стабилен** (без переменных), все переменные данные (`reasonLabel`, `message`, объект, подсказки) — в КОНЦЕ USER (`feedback_llm_prompts_cache_friendly`). Few-shot-примеры — в SYSTEM (кэшируются). Ф6/Ф3 (дайджест) если используют LLM для связного текста — стабильный SYSTEM, данные в конце user (как `daily-digest.prompt.ts`).

---

## Границы фичи

✅ **Always:** менять только файлы probe-модуля и `probe-formulate.prompt.ts`; новые крутилки → AdminSetting; новый флаг → строка в `docs/operations/feature-flags.md`; идемпотентность дайджеста (повторный прогон cron = no-op по уже отправленному).
⚠️ **Ask first:** любое изменение `resolveProbeRecipients`/адресации (§G1, чужой scope); любое изменение схемы `ProbeEvent` сверх `status`-enum и одного поля; ввод нового LLM-вызова на КАЖДЫЙ probe (бьёт по бюджету — это путь к Фазе 2, не Ф1).
🚫 **Never:** включать LLM-judge/VoI/re-ask в Фазу 1; трогать `probe-response-classify`; вводить inline-кнопки в probe (`feedback_probe_no_buttons_text_voice_only`); слать probe-подтверждение голосом (только текст, `feedback_concierge_text_only_output`); `process.env.*`/`new PrismaClient()`/`prisma migrate`.

---

## Требования (EARS)

- **R1.** Когда `ProbeDispatcherWorker` формулирует вопрос, система shall передавать в `probe-formulate` USER человеческий `reasonLabel` (рус.) вместо машинных `emittedByService`/`reason`, и не должна включать в USER ни одного машинного кода/идентификатора.
- **R2.** Система shall использовать SYSTEM-промпт `probe-formulate` варианта §9-B (персона+цель+правила+few-shot+self-check), стабильный для prompt-caching.
- **R3.** Если LLM `probe-formulate` упал/выключен, then система shall брать заготовленный человеческий вопрос по `reason` из словаря `PROBE_REASON_FALLBACK`, а НЕ сырой `humanizeProbeFallback(message)`; если для `reason` заготовки нет — generic «Можете уточнить, пожалуйста?».
- **R4.** Система shall классифицировать каждый `reason` как `immediate` или `deferrable` по статичному маппингу `PROBE_REASON_WINDOW` (дефолт `deferrable`).
- **R5.** Когда probe `deferrable` И получатель уже исчерпал часовой ИЛИ суточный бюджет (`filterByRateLimit`), then система shall ставить probe в `status='queued_digest'` (НЕ `dropped_rate_limit`).
- **R6.** Когда probe `immediate` (или `priorityHint >= 0.7`), then система shall слать его точечно немедленно (как сейчас), минуя дайджест.
- **R7.** `ProbeDigestCron` каждые N часов shall собирать `queued_digest` probe по `recipientUserId`, формировать один notification-дайджест (≤ `probe.digestTouchCap` пунктов, дефолт 5) и помечать вошедшие probe `status='dispatched'`; повторный прогон по уже отправленным = no-op.
- **R8.** Перед dispatch система shall перечитывать исходную сущность по `contextCardId`+`reason` и, если предикат `PROBE_REASON_RECHECK` показывает, что пробел закрылся, помечать probe `status='suppressed_stale'` и не слать.
- **R9.** Когда получатель проигнорировал probe (no-answer до expiry), then система shall снижать его частотный бюджет на следующий период (adaptive fatigue) и не повторять ту же тему (`contentHash`) в течение `probe.topicCooldownHours` (дефолт 48).
- **R10.** Система shall логировать исход каждого probe (`answered`/`ignored`) в метрику-сигнал для будущей калибровки (Фаза 2).
- **R11.** Когда пользователь ответил на probe (`notification.responded`), then система shall слать ему подтверждение-уведомление `probe.answer_acknowledged` с человеческим текстом «ваш ответ записан в память компании» + название объекта (из `contextCardTitle`), и не должна слать его голосом.
- **R12.** Все числовые пороги (касание-кап, час дайджеста, cooldown темы) shall читаться через `getDynamic` (AdminSetting → ENV → default), не хардкодиться.

---

## Фазы

Граф зависимостей: **Ф1** (независима) · **Ф2** → {**Ф3**, **Ф4**} · **Ф5** (независима) · **Ф6** (независима). Волны: W1=Ф1; W2=Ф2; W3={Ф3, Ф4, Ф5, Ф6} параллельно.

---

### Ф1 — Переписать `probe-formulate` (промпт §9-B + reasonLabel + schema v3 + per-reason fallback)  `[x]`

**Цель:** закрыть корень «модель не понимает, что получает». Realizует R1, R2, R3.

**Файлы (перечитать перед правкой — номера на 2026-06-11):**
- `backend/src/modules/knowledge-core/prompts/probe-formulate.prompt.ts` — `PROBE_FORMULATE_SYSTEM_PROMPT` (:30), `PROBE_FORMULATE_USER_TEMPLATE` (:37, подаёт коды :45-47), `PROBE_FORMULATE_JSON_SCHEMA`/`_SCHEMA_NAME` (:62/:76).
- `backend/src/modules/probe/probe-dispatcher.worker.ts` — `formulate()` (:217), вызов template (:237-247), `humanizeProbeFallback` (:35), fallback-цепочка (:223).
- Новый файл: `backend/src/modules/probe/probe-reason-labels.ts` — словари `PROBE_REASON_LABEL` и `PROBE_REASON_FALLBACK`.

**Что входит:**
1. Завести `PROBE_REASON_LABEL: Record<string, string>` — машинный `reason` → рус. ярлык ситуации (полный список reason — анализ §2). Примеры: `'decision.overdue' → 'решение просрочено'`, `'regulation.missing_owner' → 'у регламента нет ответственного'`, `'temporal.fact_stale_contradiction' → 'факт устарел / расхождение'`, `'idea.status_unclear' → 'идея зависла в обсуждении'`. Дефолт для незнакомого reason — `'требуется уточнение'`.
2. Завести `PROBE_REASON_FALLBACK: Record<string, string>` — заготовленный человеческий вопрос на случай падения LLM (для топ-reason; дефолт `'Можете уточнить, пожалуйста?'`).
3. Переписать `PROBE_FORMULATE_SYSTEM_PROMPT` = дословно вариант §9-B (анализ §9, блок «Вариант B → SYSTEM»). Стабильный, few-shot в SYSTEM.
4. Переписать `PROBE_FORMULATE_USER_TEMPLATE`: убрать `Источник: специалист …` и `Причина: <reason>`; первым подавать `Тип ситуации: <reasonLabel>` + `Суть находки: <message>` + `Объект: <kind> «<title>»` + служебная подсказка (как §9-B USER). Переменные — в конце.
5. Поднять schema до `probe_formulate_v3` (`PROBE_FORMULATE_SCHEMA_NAME='probe_formulate_v3'`), форма `{question}` без изменений (версия следует за сменой контракта USER — правило версионирования в шапке файла промпта).
6. `formulate()` в dispatcher: резолвить `reasonLabel = PROBE_REASON_LABEL[probe.reason] ?? 'требуется уточнение'`, передавать в template; fallback-вопрос = `PROBE_REASON_FALLBACK[probe.reason] ?? 'Можете уточнить, пожалуйста?'` (НЕ `humanizeProbeFallback(message)`).

**Что НЕ входит:** изменение `LlmRouterService`/выбора модели (capable-модель — конфиг маршрута, не код Ф1); изменение schema-формы ответа; адресация.

**Контракт — финальный текст промпта (КАНОН, копировать байт-в-байт; это единственный источник, анализ §9-B — черновик):**

`PROBE_FORMULATE_SYSTEM_PROMPT` (стабильный, few-shot внутри — кэшируется):
```
# Кто ты
Ты — голос «Коры», памяти компании. Внутренние наблюдатели Коры находят в знаниях компании пробелы и противоречия и присылают тебе служебный сигнал. Твоя единственная задача — превратить сигнал в ОДИН короткий, тёплый человеческий вопрос тому, кто может закрыть пробел.

# Что держать в голове
- Зачем спрашиваем: ответ человека попадёт в память компании и достроит её знания. Плохой вопрос → человек не ответит → пробел останется.
- Кому пишем: обычный сотрудник или руководитель, НЕ инженер. Он не знает внутренних кодов, названий таблиц, английских названий систем.
- Как ответит: свободным текстом или голосом, без кнопок. Значит вопрос должен предполагать короткий ответ своими словами.

# Что делает вопрос хорошим (соблюдай ВСЕ пункты)
1. Конкретность: называй точный объект человеческими словами («решение перейти на нового подрядчика», а не «решение» и не «decision»).
2. Одна мысль: ровно один вопрос, ≤200 символов, без вступлений, без «здравствуйте» и «спасибо».
3. Отвечаемость за 10–15 секунд по памяти, без похода в документы.
4. Чистый русский: ни одного кода, идентификатора (длинного набора букв/цифр), логина, английского слова или названия сущности (CompanyProfile, Document, Role и т.п.) — даже если они есть во входных данных, не переноси их в вопрос.
5. Тон тёплый и уважительный, не упрёк и не приказ: «Что сейчас с этим решением?», а не «Почему вы просрочили?».
6. Без вариантов ответа и без перечисления подсказок — человек отвечает своими словами.
7. Если входной текст уже сформулирован как вопрос — улучши и сократи его, не копируй дословно.

# Примеры (плохо → хорошо)
СИГНАЛ — решение просрочено · «Решение "Перейти на нового подрядчика по логистике" просрочено (дедлайн 1 мая). Что с ним сейчас?»
ПЛОХО: «По decision 3-3 статус overdue, обновите.»  ПЛОХО: дословная копия шаблона.
ХОРОШО: «Решение перейти на нового подрядчика по логистике должно было исполниться к 1 мая. На каком оно сейчас этапе?»

СИГНАЛ — у регламента нет ответственного · «У регламента "Согласование отпусков" нет ответственного.»
ХОРОШО: «У регламента по согласованию отпусков не указан ответственный. Кто за него отвечает?»

СИГНАЛ — факт устарел / расхождение · «"Адрес склада" — раньше: "ул. Ленина 5", сейчас: "ул. Мира 10". Что верно?»
ХОРОШО: «По адресу склада расхождение: раньше — улица Ленина 5, сейчас — улица Мира 10. Какой адрес актуальный?»

СИГНАЛ — идея зависла · «Идея "Запустить реферальную программу" в обсуждении больше 30 дней — что решили?»
ХОРОШО: «Идея про реферальную программу обсуждается уже больше месяца. К чему в итоге пришли?»

СИГНАЛ — у компании не описаны миссия/видение/стратегия · «CompanyProfile без Mission/Vision/Strategy.»
ПЛОХО: «CompanyProfile без Mission/Vision/Strategy — заполните.»
ХОРОШО: «У компании пока не описаны миссия и стратегия. Расскажете в двух словах, к чему вы идёте?»

# Перед ответом
Проверь свой вопрос по пунктам 1–7. Если остался хоть один код, английское слово или второй вопрос — перепиши.

Верни строго JSON по схеме на русском.
```

`PROBE_FORMULATE_USER_TEMPLATE` (все переменные — в конце, для кэша). Строка «Объект:» добавляется только если объект передан; блок «Служебная подсказка» — только если есть `suggestedActions`:
```
Тип ситуации: <reasonLabel>
Суть находки: <message>
Объект: <kind> «<title>»
Служебная подсказка (НЕ показывай и НЕ перечисляй человеку — используй только чтобы понять, о чём спросить):
  - <suggestedAction 1>
  - <suggestedAction 2>

Сформулируй один уточняющий вопрос. Верни JSON по схеме probe_formulate_v3.
```

> Машинные коды (`emittedByService`, сырой `reason`) в USER **отсутствуют** — вместо них `reasonLabel`. Это закрывает корневое противоречие (SYSTEM запрещал коды, а старый USER их подавал).

**Acceptance:**
- `grep -n "reasonLabel\|PROBE_REASON_LABEL" backend/src/modules/probe/` → найдено; `grep "Источник: специалист\|Причина:" probe-formulate.prompt.ts` → 0 совпадений.
- `grep "probe_formulate_v3" probe-formulate.prompt.ts` → найдено.
- В `formulate()` fallback больше не вызывает `humanizeProbeFallback` как источник вопроса (grep).
- Пример: probe `reason='decision.overdue'`, `message='Решение "Перейти на нового подрядчика" просрочено...'` → USER содержит `Тип ситуации: решение просрочено`, НЕ содержит `decision.overdue`/`3-3-decisions`.
- `bun run typecheck` + `bun run build` (backend) зелёные.
- Тест: `bunx vitest run backend/src/modules/ai/workers/...` нет; новый `probe-formulate-v3.prompt.spec.ts` — USER не содержит машинных кодов, SYSTEM стабилен между вызовами; `humanize-probe-fallback.spec.ts` (существующий, 5) — не сломан или обновлён под per-reason fallback.

**Закрывает:** R1, R2, R3.

---

### Ф2 — Маппинг `reason → {window, recheck}`  `[x]`

**Цель:** дать Ф3/Ф4 машинную классификацию пробела. Реализует R4 (+ предикаты для R8).

**Файлы:**
- Новый: `backend/src/modules/probe/probe-reason-policy.ts` — `PROBE_REASON_WINDOW: Record<string,'immediate'|'deferrable'>` и `PROBE_REASON_RECHECK: Record<string, (ctx)=>Promise<boolean>>` (предикат «пробел ещё актуален»).
- `backend/src/modules/probe/probe.service.ts` — `suggest()` (:55), место решения (после priority :159).

**Что входит:**
1. `PROBE_REASON_WINDOW`: immediate = `decision.missing_decider`, `decision.no_deadline_critical`, `decision.overdue`, `regulation.missing_owner`, `temporal.fact_stale_contradiction.escalated`, `commitment.silence_escalation`, `consistency_violation.*`, `goal.kr_checkpoint_suggested`; deferrable = всё прочее (дефолт). Источник классификации — Ask-Early-Late-Right: цель/владелец/критичное → рано; факты/обзор/идеи/навыки → можно отложить.
2. `PROBE_REASON_RECHECK`: для reason с `contextCardId` — предикат, перечитывающий сущность (напр. `decision.missing_decider` → `decision.decidedByPersonIds.length>0` ⇒ закрылся; `regulation.missing_owner` → владелец появился; `decision.overdue` → статус стал implemented/cancelled). Дефолт — `() => true` (актуален, не подавлять). Используется в Ф4.
3. Хелпер `probeWindow(reason): 'immediate'|'deferrable'` с дефолтом.

**Что НЕ входит:** само откладывание (Ф3) и подавление (Ф4) — здесь только данные/предикаты.

**Acceptance:**
- `grep "PROBE_REASON_WINDOW\|PROBE_REASON_RECHECK" backend/src/modules/probe/` → найдено.
- Unit: `probeWindow('decision.overdue')==='immediate'`, `probeWindow('idea.status_unclear')==='deferrable'`, `probeWindow('unknown.x')==='deferrable'`.
- `bun run typecheck` зелёный.

**Закрывает:** R4 (частично R8 — предикаты).

---

### Ф3 — Батч-дайджест probe (отложить вместо дропа + касание-кап + immediate-исключение)  `[x]`

**Цель:** убрать спам и потерю probe; deferrable сверх бюджета → дайджест, immediate → точечно. Реализует R5, R6, R7, R12.

**Зависит от:** Ф2 (`probeWindow`).

**Файлы:**
- `backend/prisma/schema.prisma` — enum `ProbeStatus` (рядом с `model ProbeEvent` :6413) — добавить значения `queued_digest`, `suppressed_stale` (Ф4 тоже). **Версионируемая миграция** (`prisma:migrate --name probe_status_digest`), prod-deploy Шаг 4.
- `backend/src/modules/probe/probe.service.ts` — `suggest()` ветка rate-limit (:111-132): для `deferrable` → `queued_digest` вместо `dropped_rate_limit`; `immediate` сохраняет текущее (drop при лимите допустим, но логировать).
- Новый: `backend/src/modules/probe/probe-digest.cron.ts` — `@Cron` (литерал, как `probe-priority.cron.ts:31`), собирает `queued_digest` по recipient, шлёт дайджест, помечает `dispatched`.
- Новый: `backend/src/modules/probe/prompts/probe-digest.prompt.ts` — опц. LLM для связного текста дайджеста (или детерминированная сборка списком, как fallback). Cache-friendly.
- `backend/src/modules/conversational/types/event-payload.registry.ts` (:381) — зарегистрировать `probe.digest` + Zod-схема.
- `backend/src/modules/admin/settings/admin-setting-schema-registry.ts` (:64) — `probe.digestTouchCap`, `probe.digestHourUtc` (`POSITIVE_INT`).
- `backend/src/modules/probe/probe.module.ts` (:34) — зарегистрировать `ProbeDigestCron`.

**Что входит:**
1. Enum `ProbeStatus` += `queued_digest`, `suppressed_stale`.
2. В `suggest()`: если `probeWindow(reason)==='deferrable'` и `filterByRateLimit` вернул пусто → создать `ProbeEvent(status='queued_digest')` (вместо `dropped_rate_limit`), без enqueue dispatcher. Если `immediate` → текущее поведение (enqueue).
3. `ProbeDigestCron` (каждые `probe.digestHourUtc`, дефолт 2×/день): по каждому recipient с `queued_digest` probe — взять до `probe.digestTouchCap` (дефолт 5) по приоритету, сформировать один notification `eventType='probe.digest'` (payload: список {вопрос, объект}), отправить через `ConversationalService.sendNotification`, пометить вошедшие `status='dispatched'` + `dispatchedNotificationId`. Идемпотентность: брать только `queued_digest` (уже отправленные = `dispatched`).
4. Крутилки через `getDynamic` (§G3).

**Что НЕ входит:** изменение immediate-пути dispatcher; адресация (берём существующего получателя); reused daily-digest (отдельный механизм, §G4).

**Контракт — Zod для `probe.digest`:**
```ts
const ProbeDigestPayloadSchema = z.object({
  items: z.array(z.object({
    question: z.string().min(1).max(400),
    objectTitle: z.string().max(200).optional(),
    probeEventId: z.string(),
  })).min(1).max(20),
  total: z.number().int().nonnegative(),
});
```

**Acceptance:**
- Миграция `prisma/migrations/*_probe_status_digest/` создана; `ProbeStatus` содержит `queued_digest`, `suppressed_stale`; `bun run prisma:generate` ОК.
- `grep "queued_digest" backend/src/modules/probe/probe.service.ts` → в ветке deferrable+лимит.
- `probe.digest` зарегистрирован в `event-payload.registry.ts` (grep).
- Сценарий (тест): deferrable-probe при исчерпанном лимите → `status='queued_digest'`, dispatcher НЕ вызван; cron собрал 3 probe одного recipient → 1 notification `probe.digest` с 3 items, 3 probe стали `dispatched`; повторный cron → 0 notification (no-op).
- immediate-probe при лимите → НЕ в дайджест (точечно/текущее).
- `bun run typecheck`/`build` зелёные.

**Закрывает:** R5, R6, R7, R12.

---

### Ф4 — Recheck повода перед dispatch (answer-first lite)  `[x]`

**Цель:** не слать probe, если пробел уже закрылся. Реализует R8.

**Зависит от:** Ф2 (`PROBE_REASON_RECHECK`).

**Файлы:**
- `backend/src/modules/probe/probe-dispatcher.worker.ts` — `process()` (:117), после проверки `status==='pending'` и `expiresAt` (:122-131), ДО `formulate()`.

**Что входит:**
1. Перед `formulate()`: если есть `PROBE_REASON_RECHECK[probe.reason]` — вызвать предикат (перечитать сущность по `contextCardId`). Если вернул `false` (пробел закрылся) → `ProbeEvent.status='suppressed_stale'`, метрика `probe_suppressed_stale_total`, return (не слать).
2. Best-effort: ошибка предиката → лог + продолжить отправку (не блокировать).

**Что НЕ входит:** полный graph-answer-search (Фаза 2); recheck в `suggest()` (только перед dispatch — там сущность свежее).

**Acceptance:**
- `grep "suppressed_stale\|PROBE_REASON_RECHECK" probe-dispatcher.worker.ts` → найдено.
- Сценарий (тест): probe `decision.missing_decider`, но `decision.decidedByPersonIds` уже непуст → `status='suppressed_stale'`, `sendNotification` НЕ вызван. Предикат бросил ошибку → probe всё равно отправлен (best-effort).
- `bun run typecheck` зелёный.

**Закрывает:** R8.

---

### Ф5 — Adaptive fatigue (игнор→снижение частоты + cooldown темы + лог сигнала)  `[x]`

**Цель:** не заваливать тех, кто не отвечает; собрать калибровочные данные для Фазы 2. Реализует R9, R10, R12.

**Файлы:**
- `backend/src/modules/probe/probe-priority.cron.ts` — `sweep()` (:32), где считается `engagement_rate` (:78-105) и помечается expired (:45-71).
- `backend/src/modules/probe/probe.service.ts` — `filterByRateLimit` (:221) — учесть adaptive-множитель; `computeContentHash` (:286) — тема для cooldown.
- `backend/src/common/metrics/business-metrics.service.ts` — новые сигнал-метрики (если нет): `probe_outcome_total{outcome=answered|ignored}`.
- `admin-setting-schema-registry.ts` — `probe.topicCooldownHours` (`POSITIVE_INT`, default 48), `probe.adaptiveFatigueEnabled` (kill-switch, ON).

**Что входит:**
1. Когда probe истёк без ответа (cron, :63-71) → инкремент `probe_outcome_total{outcome=ignored}`; когда отвечен (в `probe-response.handler`) → `{outcome=answered}` (R10 — калибровочные данные).
2. Adaptive множитель в `filterByRateLimit`: если `engagement_rate` получателя ниже порога (низкая отвечаемость) → эффективный бюджет снижается (меньше probe этому человеку). Простое правило, без LLM.
3. Topic cooldown: при `suggest()` после успешного dispatch — пометить тему (`contentHash`) в Redis с TTL `probe.topicCooldownHours`; в `suggest()` дедуп уже по `contentHash` (`probe.service.ts:76`) — расширить TTL на cooldown темы (отдельный ключ или удлинить dedup TTL для отвеченных тем).

**Что НЕ входит:** re-ask (Фаза 3); LLM-оценка (Фаза 2).

**Acceptance:**
- `grep "probe_outcome_total\|adaptiveFatigue\|topicCooldown" backend/src/modules/probe/` → найдено.
- Сценарий (тест): получатель с низким `engagement_rate` → `filterByRateLimit` отдаёт меньше слотов; та же тема (`contentHash`) в пределах cooldown → `suggest()` дропает по дедупу.
- `bun run typecheck` зелёный.

**Закрывает:** R9, R10, R12.

---

### Ф6 — Видимое следствие ответа  `[x]`

**Цель:** показать, что ответ не ушёл в пустоту (главный рычаг отвечаемости). Реализует R11.

**Файлы:**
- `backend/src/modules/probe/probe-response.handler.ts` — `handle()` (:59), после `ingestResponseAsRawEvent` (:108) и `incProbeClosed` (:118).
- `backend/src/modules/conversational/types/event-payload.registry.ts` — зарегистрировать `probe.answer_acknowledged` + Zod.

**Что входит:**
1. После успешного closing-loop — отправить получателю `sendNotification(eventType='probe.answer_acknowledged')` с человеческим текстом «Спасибо — ваш ответ записан в память компании» + (если есть) `«<contextCardTitle>»`. `dataClass` = как у исходного probe. Текст — русский, без кодов.
2. Best-effort: ошибка отправки подтверждения не валит closing-loop (он уже завершён).
3. (Дайджест-связь) если у получателя активен `probe.digest` — строка-подтверждение может включаться в следующий дайджест вместо отдельного notification (опц., если не усложняет; иначе отдельный notification).

**Что НЕ входит:** реальный дифф графа (Б7 — асинхронен); голосовое подтверждение (🚫).

**Контракт — Zod для `probe.answer_acknowledged`:**
```ts
const ProbeAnswerAckPayloadSchema = z.object({
  text: z.string().min(1).max(400),
  objectTitle: z.string().max(200).optional(),
  probeEventId: z.string().optional(),
});
```

**Acceptance:**
- `grep "probe.answer_acknowledged" backend/src/modules/probe/ backend/src/modules/conversational/` → найдено + зарегистрировано.
- Сценарий (тест): `notification.responded` для probe → отправлен `probe.answer_acknowledged` с русским текстом, содержащим `contextCardTitle`; ошибка отправки ack → closing-loop (RawEvent) всё равно выполнен.
- Текст не содержит латиницы/кодов (grep по тесту).
- `bun run typecheck`/`build` зелёные.

**Закрывает:** R11.

---

## Pre-mortem / Риски + ревью-аспекты

| Риск | Митигировать | Ревью-аспект (`strict-production-review-gate`) |
|---|---|---|
| Длинный SYSTEM хуже на дешёвой модели → плохой вопрос | capable-модель для `probe-formulate`; §9-A как code-fallback; наблюдать прод | Проверить, что модель маршрута — не tertiary Ollama |
| Батч задерживает критичный probe | `immediate`-окно + `priorityHint>=0.7` минуют дайджест (R6) | Проверить, что immediate-reason не попадают в `queued_digest` |
| Дайджест-cron дублирует отправку | брать только `queued_digest`, помечать `dispatched` атомарно (updateMany по id) | Идемпотентность cron — повторный прогон no-op |
| Recheck-предикат читает не ту сущность / падает | best-effort (ошибка → отправить); предикат только для reason с `contextCardId` | Tenant-изоляция re-read (по `tenantId`) |
| Cross-tenant утечка в дайджесте | группировка по `recipientUserId` в пределах `tenantId`; `@@index([tenantId,status])` уже есть | Каждый запрос дайджеста с `tenantId` |
| Новый eventType без схемы → любой JSON | зарегистрировать Zod в `event-payload.registry` (R обяз.) | grep незарегистрированных eventType |
| Миграция enum на проде | `ProbeStatus` += значения — безопасно (добавление); prod-deploy Шаг 4 | — |

---

## Idempotency / feature-flags / prod-deploy

- **Идемпотентность:** `ProbeDigestCron` — повторный прогон no-op (берёт только `queued_digest`). Никаких seed/patch/backfill в этом ТЗ.
- **Флаги (Ship-On, `feedback_ship_on_flags`):** `probe.adaptiveFatigueEnabled` (kill-switch, ON) — строка в `docs/operations/feature-flags.md`. Дайджест и промпт — без флага (чистая замена поведения). Если нужен аварийный рубильник на батчинг — `probe.digestEnabled` (kill-switch ON), тоже строка в реестр.
- **prod-deploy-log:**
  - **Шаг 4** (schema): `ProbeStatus` += `queued_digest`, `suppressed_stale` (миграция `*_probe_status_digest`).
  - **Шаг 1** (ENV/AdminSetting): новые AdminSetting-ключи `probe.digestTouchCap`, `probe.digestHourUtc`, `probe.topicCooldownHours`, `probe.adaptiveFatigueEnabled` (+ опц. `probe.digestEnabled`) — регистрация в `admin-setting-schema-registry.ts`; code-default есть, прод-действий по умолчанию не требуют.
  - **Шаг 12** (smoke): новый `ProbeDigestCron` — grep по логам «ProbeDigestCron», новый eventType `probe.digest`/`probe.answer_acknowledged` — Swagger/notification smoke.
- **Миграций кроме enum — нет.** Выкат: `docker compose up -d --build` + автоприменение миграции (`migrate deploy`).

---

## Чек-лист производных заметок second-brain (DoD)

- `second-brain/01_projects/` — probe-подсистема: обновить профильную заметку (политика инициирования, окно по типу, дайджест, видимое следствие).
- `01_projects/workers-queues.md` + `01_projects/ai-jobs.md` — новый `ProbeDigestCron`.
- `01_projects/api-layer.md` — новые eventType `probe.digest`, `probe.answer_acknowledged` (если фиксируем notification-контракты).
- `02_architecture/data-model.md` — `ProbeStatus` += значения.
- `docs/operations/feature-flags.md` — `probe.adaptiveFatigueEnabled` (+ опц. `probe.digestEnabled`).
- `docs/operations/prod-deploy-log.md` — Шаги 1/4/12 (см. выше).
- `second-brain/04_не-сделано/README.md` — строка: Фаза 2 (LLM-judge ценности) и Фаза 3 (re-ask+память) отложены с причиной (калибровочные данные/риск), ссылка на это ТЗ и анализ §10.

---

## DoD (общий)

`bun run typecheck` (вкл. `.spec`) / `lint` / `build` (backend) зелёные · новые vitest-тесты зелёные · existing `humanize-probe-fallback.spec`/`probe-recipient.util.spec` не сломаны · second-brain обновлён по таблице выше · prod-deploy-log обновлён · рефлексия записана · промпт cache-friendly подтверждён.

---

## Дальнейшие фазы (вне этого ТЗ — судьба хвостов)

- **Фаза 2** (отдельное ТЗ, за метрикой Ф5): LLM-judge ценности вопроса (матрица MN/CD/FA/NR, дешёвый deepseek-flash, калибруется на `probe_outcome_total` из Ф5) + семантический дедуп pgvector между источниками + полный graph-answer-search (Glean-стиль) в `suggest()`. Доказательство порядка — анализ §10 Р3.
- **Фаза 3** (отдельное ТЗ): re-ask петля (использовать `requiresFollowup`, максимум 1 повтор с цитатой, с сохранением контекста — иначе антипаттерн петли) + память предпочтений тона (LangGraph-Store-стиль). Анализ §10.

---

## Итог

**Реализовано целиком (2026-06-11, ветка `svdev`, коммиты `5ed78b54`..`fa950cd1`).** Все 6 под-фаз закрыты, R1–R12 выполнены.

| Фаза | Коммит | Что сделано |
|---|---|---|
| Ф1 | `5ed78b54` | Промпт §9-B (персона+few-shot, cache-friendly) + словари `PROBE_REASON_LABEL`/`PROBE_REASON_FALLBACK` + schema `v3` + per-reason fallback. R1–R3. |
| Ф2 | `cbe129b3` | `probe-reason-policy.ts`: `PROBE_REASON_WINDOW`/`probeWindow` + `PROBE_REASON_RECHECK` (предикаты по Decision/Idea/Regulation/Process/Policy, tenant-изолированно). R4. |
| Ф3 | `7c82a0f3` | enum `queued_digest`/`suppressed_stale` (миграция) + deferrable→`queued_digest` в `suggest()` И dispatcher + `ProbeDigestCron` + eventType `probe.digest` (Zod+рендер telegram/max-bot+label) + AdminSetting-крутилки. R5–R7, R12. |
| Ф4 | `9b5a026a` | recheck повода перед `formulate()` → `suppressed_stale`, best-effort. R8. |
| Ф5 | `8a993edc` | `probe_outcome_total{outcome,reason}` (answered/ignored) + adaptive множитель в `filterByRateLimit` (engagement из Redis) + topic cooldown (dispatcher+cron ставят, suggest дропает). R9, R10, R12. |
| Ф6 | `fa950cd1` | `ProbeResponseHandler` шлёт `probe.answer_acknowledged` (текст «ответ записан» + объект, только текст) + eventType (Zod+рендер+label). R11. |

**Верификация:** `typecheck`+`build`(+frontend) зелёные · ~57 probe-тестов + 167 conversational + 36 admin/metrics зелёные · `lint` 0 · документация second-brain/docs обновлена · рефлексия `05_история/2026-06-11-probe-system-upgrade-phase1.md`.

**Достроено сверх буквы scope (оркестраторская достройка «ничего не откладывать»):** (а) deferrable-дроп чинился в ДВУХ гейтах (suggest + dispatcher), не одном; (б) рендер новых eventType в telegram/max-bot адаптерах + поле `summary` для кабинета (ТЗ считал транспорт «готовым», но дефолт показывал машинный код eventType); (в) метрика `probe_outcome_total` (вместо переиспользования `probe_events_total`) для чистого калибровочного сигнала Фазы 2.

**Не сделано (по design — вне Фазы 1):** LLM-judge ценности, семантический дедуп pgvector, полный graph-answer-search (Фаза 2); re-ask петля + память тона (Фаза 3). Зафиксировано в `second-brain/04_не-сделано/README.md`.
