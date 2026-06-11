---
type: analysis
status: research-complete
feature: telegram-agentic-interface
date: 2026-06-11
snapshot_date: 2026-06-11
owner: Сергей (sergrv80) — продуктовые решения по Telegram-каналу Коры
related:
  - second-brain/01_projects/conversational-channels.md
  - second-brain/06_marketing/competitors.md
  - plans/tz/2026-06-10-cabinet-fixes-master.md
  - plans/tz/2026-06-11-autonomy-w4-intake-autoaccept-all-channels.md
---
> Цель разбора: понять, почему Telegram-бот Коры ведёт себя «тупо» (молчит, отвечает не на то), что у нас УЖЕ есть для «умного» бота, как делают умных Telegram-ассистентов другие, и доказать минимальное верное решение — превратить Telegram в полноценный канал к мозгу Коры.
> **Простое объяснение для владельца (Точка А → Точка Б) → парный файл** [2026-06-11-telegram-pomoshnik-tochka-A-tochka-B.md](plans/analysis/2026-06-11-telegram-pomoshnik-tochka-A-tochka-B.md).
> Следующий шаг → ТЗ: разбивается на ТЗ по шагам, см. раздел «Рекомендация» (сначала `plans/tz/...-telegram-stop-silence-and-briefs.md`).

> **⚑ РЕШЕНИЕ ВЛАДЕЛЬЦА (2026-06-11): Точка Б = ЕДИНЫЙ помощник-мозг, Telegram и кабинет — окна к нему.** «Вносим изменение → вносим в помощника, и оно работает во всех окнах». Поэтому путь **«латать Telegram отдельными интентами» (вариант А в матрице) ОТВЕРГНУТ как ЦЕЛЬ** — он плодит второй мозг (та же болезнь chat-v2 ≠ concierge, что сейчас). Унификация на помощнике — согласованная ЦЕЛЬ; «большой движок разом» отвергнут как СПОСОБ (Ship-On + горячая зона). Путь — фазами: Шаг 1 заплатки (стоп-молчание+брифы) → Шаг 2 native-инструменты помощника → Шаг 3 открыть помощника в Telegram (узкий безопасный набор) → Шаг 4 расширение. Подробности — в PLAIN-файле выше.

---

## 0. TL;DR (главный вывод после состязательной перепроверки)

**Корень «тупого Telegram» структурный, но боль лечится не структурно.** В Коре два раздельных «мозга»:
- **Concierge** — настоящий агент с инструментами (19 штук: встречи, события календаря, поиск свободного слота, задачи, клоны ролей, пульс сотрудника, здоровье команд и т.д.), с RBAC, undo-логом, подтверждением мутаций. **Доступен только в кабинете** (поток событий SSE).
- **chat-v2** — read-only вопрос-ответ (Q&A) по графу знаний. **Именно сюда** уходит свободный вопрос из Telegram.

Telegram-бот гоняет текст через узкий классификатор намерений и **никогда не вызывает агента с инструментами**. Отсюда ощущение «тупости».

**НО** (ключевая поправка red-team): 70-80% конкретной боли владельца («молчит», «отвечает не на то», «нет понятных отчётов») — это **три дешёвые заплатки уровня конфиг+рендер**, а не агентная архитектура:
1. chat-ответ помечен как `sensitive`, а эффективный потолок и Telegram-канала, и привязки in_app — `internal`. **Прод-логи (2026-06-11, diag.ts) показывают: ответ блокируется на ОБОИХ каналах → 0 каналов → `status=failed`** — пользователь не получает ответ ни в Telegram, ни в кабинете (полная тишина, не «рассинхрон»). Чинится понижением класса chat-ответа до `internal`.
2. Из 14 типов проактивных уведомлений, маршрутизируемых в Telegram, **читаемо рендерятся только 7**; остальные 8-10 (включая сам вопрос утреннего чек-ина, недельную сводку, пульс целей, итоги месяца) приходят как голое «Уведомление: operations.weekly_digest». Чинится дописыванием веток рендера.
3. Свободная заметка (`free_note`) уходит в граф **без подтверждения пользователю** («записал в память»). Чинится одной строкой.

**Рекомендация (скорректирована red-team): фазами, заплатки-first, узко.** Сначала Ф0/Ф1 (остановить молчание + сделать брифы видимыми) — дни, Ship-On-нативно, ноль риска для web-чата. Действия из Telegram (создать задачу/встречу и т.п.) — отдельная узкая фаза **только после подтверждения спроса**, и через **тонкий headless-адаптер к существующему concierge с УЗКИМ telegram-whitelist (~6-7 инструментов «своё»), НЕ все 19**. Большой «единый агентный движок» (вариант C) — северная звезда архитектуры, но НЕ задача на сейчас (нарушает Ship-On, не отделяется тонко, падает в горячую зону). «Подтвердить 32 пачкой» — выкинуть из scope (ложная хотелка). Руководительскую аналитику из публичного Telegram — отложить (RBAC-поверхность).

**🔴 Блокер перед ТЗ:** подтвердить 2 значения ENV на проде (`CONCIERGE_ENABLED`, `DATACLASS_OUTBOUND_GATING_ENABLED`) и `max_data_class` Telegram-канала в БД тестовой Org. Если gating на проде ВЫКЛЮЧЕН — диагноз молчания меняется (см. §11, развилка Р-0).

---

## 1. Рамка проблемы

**Кто страдает:** рядовой сотрудник (задаёт вопрос/ставит задачу через Telegram — получает молчание) и руководитель (хочет спросить «что с менеджером X» и получить понятный отчёт — не может).

**Две конкурирующие формулировки проблемы:**
- **(A) Симптом:** «Telegram-бот тупой — молчит и отвечает не на то». Лечение симптома: починить конкретные точки молчания.
- **(B) Структурная причина:** «Telegram подключён к read-only мозгу (chat-v2), а не к агенту с инструментами (concierge); канал-слой — параллельный узкий роутер, а не тонкий адаптер над единым ядром». Лечение причины: свести Telegram к адаптеру над агентным ядром.

**Iceberg (симптом vs корень):** корень — B (структурный раскол). Молчание и узость — его симптомы. НО (важный вывод red-team): большая часть видимой боли — это **не сам раскол**, а несколько независимых дефектов доставки/рендера, которые накопились вокруг него и чинятся точечно. То есть «починить корень B» ≠ «убрать боль владельца» — боль убирается дешевле, чем корень.

**Метрика «решено»:**
- Доля вопросов из Telegram, на которые пришёл ответ **в Telegram** (а не молчание / только в кабинет) → цель ~100%.
- Доля проактивных уведомлений, приходящих в Telegram читаемым текстом (сейчас 7/14 ≈ 50%) → цель 100%.
- Возможность из Telegram выполнить базовое действие «своими руками» (создать задачу/встречу, посмотреть свой день) без захода в кабинет.

---

## 2. Дерево вопросов (MECE) — этапы потока = каркас будущих фаз

1. **Вход (inbound):** приём текста/голоса/reply/forward/документа → резолв субъекта (binding → user + Org). *(в основном готово)*
2. **Понимание (routing):** классификация намерения → решение «ответить из памяти / выполнить действие / записать». *(узкий switch, не агент)*
3. **Действие (tools):** реестр инструментов + исполнение с RBAC, подтверждением мутаций, откатом. *(есть только в кабинете)*
4. **Ответ (outbound):** возврат ответа **в тот же канал**, поток/чанкинг. *(ломается на dataClass-фильтре)*
5. **Проактив (Кора → человек):** видимые планы/сводки/отчёты/напоминания + on-demand сводка руководителю. *(7/14 типов невидимы)*
6. **Память:** контекст диалога (per-channel) + долгая память (граф, per-Org). *(граф есть; континуити диалога в Telegram нет)*
7. **Безопасность/идемпотентность:** недоверенный ввод, policy-авторизация, дедуп `update_id`, secret-token webhook. *(частично)*

Каждая ветвь — кандидат в отдельную фазу ТЗ. Ветви 4 и 5 (молчание + невидимые брифы) — самые дешёвые и самые болезненные → идут первыми.

---

## 3. Что у нас есть сегодня (teardown нашего кода)

### 3.1 Два «мозга» — функционально

| | **Concierge** (агент с инструментами) | **chat-v2** (то, что слышит Telegram) |
|---|---|---|
| Что делает | Понимает запрос → **вызывает инструменты** (действия и чтение) → отвечает | Только **отвечает** по графу знаний с цитатами |
| Действия (создать/отменить/назначить) | да — 19 инструментов | нет |
| RBAC / undo / подтверждение | да (проверка прав, лог отката, флаг confirm) | н/п |
| Где доступен | **только кабинет** (поток событий SSE) | любой канал через намерение `chat_query` |
| Технический taskType | `concierge-respond` | retrieval + синтез (`factual`/`synthetic`/`clone_style`) |

Источник: [concierge.service.ts](backend/src/modules/concierge/services/concierge.service.ts), [service-map-generator.service.ts](backend/src/modules/concierge/services/service-map-generator.service.ts), [chat-v2.module.ts:54-103](backend/src/modules/chat-v2/chat-v2.module.ts#L54). `[verified: код Z, 2026-06-11]`

### 3.2 Инструменты concierge (19 штук) — технический разрез

Реестр статический ([service-map-generator.service.ts:89-528](backend/src/modules/concierge/services/service-map-generator.service.ts#L89)); декоратор `@ConciergeTool` + авто-скан помечены как «vNext» и **не реализованы** (греп `@ConciergeTool` по контроллерам = 0). Список: `list_meetings`, `create_meeting`, `cancel_meeting`, `search_knowledge`, `ask_chat_v2`, `list_tasks`, `create_event`, `list_my_events`, `list_user_events`, `find_free_slot`, `delete_event`, `ask_role_clone`, `list_clones`, `get_person_pulse`, `list_overdue_promises`, `get_sprint_status`, `get_team_health`, `infer_table_schema`, `list_ignored_probe_questions`. `[verified]`

**Технические слабости агента (важны для выбора варианта):**
- **Эмуляция tool-use регексом, НЕ native function-calling.** Системный промпт просит модель вернуть строку `{"tool_call": {...}}`, ответ парсится жадным регексом `\{[\s\S]*"tool_call"[\s\S]*\}` ([concierge.service.ts:124-126, 813](backend/src/modules/concierge/services/concierge.service.ts#L813)). При невалидном JSON — молча трактуется как финальный текст (инструмент тихо не вызовется). `[verified]`
- **Подтверждение мутаций — только флаг на фронте.** `requiresConfirm` кладётся в SSE-событие, но бэкенд **не останавливается и не ждёт** — инструмент исполняется тут же ([concierge.service.ts:547-575](backend/src/modules/concierge/services/concierge.service.ts#L547)). `[verified]`
- **Исполнение инструмента — loopback-HTTP на себя с проброшенной cookie сессии** ([tool-router.service.ts:153-163](backend/src/modules/concierge/services/tool-router.service.ts#L153)). Зависит от `baseUrl` + `authCookie` из HTTP-запроса. `[verified]`
- **Баг:** `list_overdue_promises` указывает на несуществующий роут `GET /api/v1/dashboard/commitment-reliability` → **404** даже в кабинете (греп: такого `@Get` нет). `[verified — подтверждено двумя независимыми агентами]`

**Барьеры подключить concierge к Telegram (почему «не бесплатно»):** нет cookie/сессии (бот авторизует по `ChannelBinding` + magic-link), нет `baseUrl`/`req`, поток SSE vs одно сообщение, отдельное хранилище диалога (`ConciergeConversation` vs `ChannelBinding`), вход через guard-ы контроллера. Нужен **headless-адаптер**: резолв userId/tenantId из binding, сервисный auth вместо cookie, сбор потока в один текст. `[verified]`

### 3.3 Telegram сегодня — узкий роутер (но уже не пустой)

Свободный текст → классификатор на **9 категорий** ([classify.prompt.ts:27](backend/src/modules/dialog-layer/prompts/classify.prompt.ts#L27)), адаптер сворачивает их в **6 веток** ([telegram-bot.adapter.ts:538-592](backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts#L538)):
- `chat_query` → chat-v2 (read-only ответ);
- `task` → **создаёт задачу** (`handleCreateTask`); `show_tasks` → **список «мои задачи»**; `daily_plan_morning`/`daily_report_evening` → **чек-ин**; `free_note` → запись в граф **без ответа**.
- Плюс уже работают: reply на уведомление о задаче (статус/коммент/новая задача), forward→задача, документ→граф, голос→ASR(Vox)→классификация.

**Поправка red-team:** вчерашний коммит (`§2 гейт намерения`) уже добавил `task`/`show_tasks` — часть «тупости» убрана **без всякого ядра**. Так что «подключить действия» — это доводка работающего набора, а не пустое поле. `[verified: git, telegram-bot.adapter.ts:548-562]`

### 3.4 Два доказанных механизма молчания

**Кейс A — «Нужно больше информации» (реакция на уведомление-подтверждение):** не вопрос → классифицируется как `note` → сворачивается в `free_note` → `ConversationalFreeNoteBridge.handleFreeNote` пишет заметку в граф и **не шлёт ни слова** ([conversational.module.ts:65-86](backend/src/modules/conversational/conversational.module.ts#L65)). Заметка **не теряется** — теряется только ack. `[verified]`

**Кейс B — «Встреча с Александром, расскажи чем у них компания?»:** маршрутизация и генерация ответа **исправны** (chat-v2 возвращает текст-отказ «Недостаточно данных…», не исключение). Ломается **доставка**: `sendChatReply` помечает ответ `dataClass='sensitive'` ([conversational.service.ts:424](backend/src/modules/conversational/conversational.service.ts#L424)), а Telegram-канал `maxDataClass='internal'` ([telegram-bot.adapter.ts:79](backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts#L79)). Фильтр `canEmit`→`checkLattice` (`sensitive=2 > internal=1`) отбрасывает Telegram ([dataclass-policy.service.ts:455-463](backend/src/modules/knowledge-core/services/dataclass-policy.service.ts#L455)). `[verified]`

**🔴 Прод-подтверждение (diag.ts, 2026-06-11, трейс по webhook Telegram `requestId=DFukxIMwoUa_`):** для запроса из Telegram блокируются **ОБА** канала — `channel=telegram_bot#c1h847` (`payload=sensitive > sink.maxDataClass=internal`) И `channel=in_app#pw8rdn` (тот же reason). У привязки in_app эффективный потолок = `min(channel=private, binding.maxDataClass=internal)` = `internal`, поэтому `sensitive` режется и тут. Итог в логах: `sendNotification: ни одного канала для user=... eventType=chat.answer ... → status=failed`. **Значит ответ не доходит НИКУДА — ни в Telegram, ни в кабинет** (это сильнее, чем «рассинхрон канала»: полная тишина). Gating на проде **ВКЛЮЧЁН** (WARN `blocked outbound emit` идёт постоянно). `[verified: прод-логи 2026-06-11]`

→ **Цель фикса Ф0:** chat-ответ должен иметь `dataClass` не выше `internal` (большинство ответов — не приватные факты о людях), чтобы пройти и в Telegram, и в in_app. Для редких `private`-фактов о конкретном человеке — subject-ACL в `canEmit` уже есть.

**Прочие ветки молчаливого отброса push-доставки в Telegram** (усугубляют, но не первичны): дневной бюджет push (по умолчанию 5/день/человек), тихие часы (по умолчанию 22:00–08:00, ответ chat не critical), eventType-deny/`disabledUntil` в преференсах, реальная ошибка `handleChatQuery` (логирует «пользователь не получит ответ»). `[verified: notification-budget.service.ts, conversational.service.ts:1083-1102]`

### 3.5 Проактивный outbound — половина невидима

В Telegram маршрутизируется **14 типов** уведомлений ([EVENT_TYPE_CHANNEL_POLICY](backend/src/modules/conversational/conversational.service.ts#L90)), но `renderText` ([telegram-bot.adapter.ts:1254-1322](backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts#L1254)) рендерит только **7**: `probe.question`, `specialist.probe`, `chat.answer`, `curation.pending`, `system.message`, `checkin.ack`, `meeting.invite`. Остальные **8-10** падают в `default: «Уведомление: <eventType>»` — без текста:

| Невидимое в Telegram | Что это | Цитата |
|---|---|---|
| `checkin.prompt` | **сам вопрос утреннего/вечернего чек-ина** | daily-checkin-prompt.cron.ts |
| `operations.weekly_digest` | недельная сводка операционного директора | operations-weekly-digest.cron.ts |
| `goals.pulse` | пульс целей за неделю | goals-pulse.cron.ts |
| `operations.monthly_recap` | итоги месяца (что сделала Кора) | value-recap.cron.ts |
| `proactive.notification` | личный «бриф дня», каскад обещаний, знание-под-риском и т.д. | 6 cron-ов |
| `event.reminder` | напоминание о событии календаря | event-reminders.worker.ts |
| `issue.mention` | @-упоминание в задаче | comments.service.ts |
| `idea.status_changed`, `support.*` | смена статуса идеи, тикеты поддержки | — |

Единственный корректный проактив — утренний дайджест задач, и то потому что cron **жульничает**, отправляя под `system.message` (который рендер умеет) ([telegram-digest.cron.ts:247](backend/src/modules/conversational/adapters/telegram-bot/telegram-digest.cron.ts#L247)). `[verified]`

→ **Это и есть «нет понятных планов и отчётов в Telegram»** — данные генерируются (`title`/`body`/`actionUrl` лежат в payload), но не рендерятся. Чинится дописыванием веток (можно одной универсальной «если есть `title`+`body` → отрисовать + ссылка из `actionUrl`»). `[verified]`

### 3.6 «Ждёт вашего подтверждения: 32» — как устроено

Фраза — из часового cron-а `pending-actions-reminder.cron.ts` (отправляется как `system.message` со ссылкой `Открыть: /actions`). «32» = `PendingActionsService.getCount` по **4 провайдерам**: probe (вопросы AI), conflict (конфликты — только owner/admin), intake (входящие задачи — только owner/admin), curation (решения/карточки на модерацию). `[verified: pending-actions.service.ts:80-105]`

**Пакетное «подтверди 32» текстом из Telegram невозможно по природе данных:** probe — это 32 разных вопроса (нужно 32 разных ответа), conflict — выбор «какая версия верна», intake — триаж (проект/исполнитель/срок). One-tap-подтверждаемо реально только `curation` (light). Из Telegram сегодня можно текстом ответить только на **один конкретный probe** через reply-match по `externalMessageId` ([telegram-bot.adapter.ts:1231](backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts#L1231)). `[verified]`

---

## 4. Ландшафт аналогов (РФ + зарубеж) — два контура

### 4.1 Зарубежные продукты (функциональный разрез + что перенять)

| Продукт | Что умеет (простым языком) | Что перенять для Z |
|---|---|---|
| **Lindy** (lindy.ai) | exec-ассистент над почтой/календарём; **утренний бриф в 7:00**; «черновик → твоя подпись» на исходящих | Модель «узкий надёжный цикл (бриф→задачи→календарь) важнее ширины каталога»; гейт подтверждения только на исходящих. `[verified: lindy.ai, zapier.com/blog/lindy-review, 2026]` |
| **Martin** (trymartin.com) | JARVIS-стиль, мультиканал (звонок/SMS/WhatsApp/Slack), один номер = один вход; проактивный daily update | «Одна сущность-ассистент, много каналов входа» = ваш «один user = одна Org, magic-link». `[verified: docs.trymartin.com, 2026]` |
| **Cleo** (meetcleo.com) | chat-first вертикальный (финансы), характер/тон («roast mode»), 8M+ юзеров | chat-first + вертикаль + характер держат массовую retention (drive-of-usage). `[verified: thepennyhoarder.com, 2026]` |
| **mymeet.ai** (РФ) | встречи→транскрипт→структурный отчёт→AI-чат по встрече; без графа компании | Зрелый UX «чат по встрече»; Кора шире (граф + память за уволившихся). `[verified: mymeet.ai, 2026]` |
| **SingularityApp** (РФ) | таск-менеджер с двумя режимами: **Ask** (Q&A, без действий) и **Agent** (создаёт/правит задачи, план); переключаемые GigaChat/YandexGPT/Ollama | **Сознательный сплит read-only vs action** — рыночное подтверждение, что «дать всё одним агентом» не нужно. `[verified: singularity-app.ru/blog, cnews.ru 2025-12-22]` |

**Вывод по продуктам (усилен red-team):** лучшие практики = **узкий action-набор + сильный проактивный бриф**, НЕ «дай любой инструмент компании». Обзоры Lindy за 3 месяца теста: реальная ценность = узкий надёжный цикл, «всё» рассыпается на сложных цепочках. `[verified: vellum.ai/blog/best-lindy-ai-alternatives-2026, salesrobot.co, 2026]`

### 4.2 Open-source на GitHub (технический разрез, маппинг на стек Z)

| Репо | Звёзды | Стек | Ключевой паттерн под Z |
|---|---|---|---|
| **opencode-telegram-bot** | 790 | TS + grammY | human-in-the-loop + **input-flow-control** (пока идёт уточняющий диалог — принимаем только ответ на вопрос); голос. `[verified]` |
| **NanoGemClaw** | 18 | TS + grammY + sqlite-vec | **3-слойная память** + **hybrid RAG (embedding + FTS5 + RRF)** + единая Zod-валидация входов инструментов. `[verified]` |
| **Teleton** | 79 | TS + grammY | **observation masking** (сжатие старых результатов инструментов, ~90% экономии контекста) + access-policy для рискованных действий. `[verified]` |
| **ClawStart** | 0 (учебный) | TS + Telegraf | native function-calling loop; **`text-embedding-3-small` совпадает 1-в-1 с Z**; pre-check «нужен ли контекст» перед RAG. `[verified]` |
| **grammY** | 3.6k | TS (Node+Deno) | фреймворк-база под 3 из 4 проектов; **conversations-plugin** под probe-диалоги. `[verified]` |
| nanobot / OpenClaw / QwenPaw | 44k / 195k / 17.4k | Python | только идеи (логику **портировать в TS** по принципу 7): `ask_user` (probe), three-layer channel/brain/body, tool-guard + MCP-whitelist. `[verified/claimed]` |

**Топ-3 повторяющихся паттерна:** (1) native function-calling loop + ленивый контекст + компакция; (2) hybrid retrieval (вектор + полнотекст, слитые через RRF) поверх двухуровневой памяти; (3) слой безопасности инструментов (per-tool whitelist + единая schema-валидация + access-policy на рискованное). `[verified]`

⚠ Под Z НЕ брать: голосовой вывод/TTS (text-only), бот-как-user-account (GramJS — у нас глобальный бот по magic-link, только личка). `[inferred, на основе feedback Z]`

### 4.3 Инженерные паттерны (верифицированные факты, критичные для архитектуры)

- **DeepSeek и OpenAI-proxy поддерживают native function-calling** через OpenAI-формат `tools`/`tool_calls` (+ strict mode beta у DeepSeek). `[verified: api-docs.deepseek.com/guides/function_calling, 2026-06]`
- **Наш `llm-router` УЖЕ это умеет:** `call()` принимает `params.tools`, пробрасывает в провайдер с `tool_choice='auto'`, парсит `tool_calls`; DeepSeek-сервис и OpenAI-proxy-сервис реально мапят tools (боевой код, не заглушка). `[verified: llm-router.service.ts:1006-1013/1774-1777, deepseek.service.ts:186-224, openai-proxy.service.ts:89-97]`
- **RU-LLM (импортозамещение):** GigaChat Pro/Max и YandexGPT 5 Pro поддерживают function-calling в OpenAI-подобной форме, **НО без parallel tool calls; YandexGPT `tool_choice` только `auto`/`none` (forced нет)**. → для RU-провайдеров закладывать только последовательный (sequential) tool-loop + `auto`. `[verified: developers.sber.ru/docs (2026-02-02), aistudio.yandex.ru, litellm #19625, langchainjs #7562]`
- **Telegram-стриминг без SSE:** `sendMessageDraft` (нативный стриминг, доступен всем ботам с Bot API 9.5, 2026-03-01) или `editMessageText` с троттлингом + `sendChatAction: typing`. Лимиты: ~30 msg/сек на бота, ~1 msg/сек в чат, 4096 символов (entity-aware чанкинг). `[verified: core.telegram.org/bots/api-changelog, /bots/faq]`
- **Безопасность мутаций (OWASP AI Agent):** авторизацию проверяет policy-сервис, а не модель; весь контент канала — недоверенный (в конец user-блока); per-tool scoping (read vs write); human sign-off только на HIGH/CRITICAL; идемпотентность по `update_id`; secret-token на webhook. `[verified: OWASP AI Agent Security Cheat Sheet, 2026]`
- **Память:** граф знаний Коры (IdeaBlock/Entity/Theme + pgvector) — это де-факто долгая память (аналог temporal knowledge graph / Zep). Для диалога нужен только слой short-term (суммаризация истории) — не строить отдельную подсистему. `[verified/inferred]`

---

## 5. Gap-таблица «лучший аналог × Z»

| Возможность | Лучший аналог (как) | Что у Z сейчас | Дельта (что делать) |
|---|---|---|---|
| Спросить из Telegram и получить ответ ТАМ ЖЕ | Lindy/Martin — ответ в тот же канал | Ответ генерится, но уходит в кабинет (рассинхрон канала) | **Ф0:** понизить dataClass chat-ответа до канала-источника |
| Понятные планы/отчёты в Telegram | Lindy — утренний бриф; узкий проактив | Бриф генерится, но 7/14 типов невидимы | **Ф1:** дорендерить 8-10 eventType (включая `checkin.prompt`) |
| Подтверждение получения заметки | большинство ботов шлют ack | `free_note` молчит | **Ф0:** одна строка ack |
| Поставить задачу из чата | OK Bob / SingularityApp Agent | **уже есть** (`task`→IntakeIssue) | доводка |
| Создать встречу/событие, найти слот | Martin/OK Bob | есть как инструменты concierge, но только в кабинете | **Ф2 (узко):** прямой маршрут или headless-адаптер |
| Управлять календарём из чата | NanoGemClaw, Chrony, Toki | инструменты есть (in-app) | **Ф2 (узко)** |
| «Что с менеджером X» из Telegram | — (нишево) | инструменты есть, но RBAC `person:read` открыт менеджерам → небезопасно в публичном канале | **отложить** до строгого ресурс-гейта (см. §10) |
| Подтвердить pending пачкой | — | невозможно по природе 3/4 источников | **выкинуть из scope** |
| Native function-calling (надёжные действия) | ClawStart/индустрия | транспорт готов в router; concierge гонит regex-эмуляцию | **Ф3 (северная звезда):** перевести concierge на native tools in-place |
| Голосовой ВВОД | NanoGemClaw, opencode-bot | **уже есть** (Vox ASR) | — |

---

## 6. Матрица вариантов решения

Критерии — ограничения Z: Ship-On (готово→ON сразу), риск для работающего web-чата, конфликт с горячей зоной (169 коммитов/3 автора за 3 дня), покрытие боли владельца, RBAC-безопасность из публичного канала, объём работ.

| Критерий | **A — заплатки** | **B — headless-адаптер к concierge (узкий whitelist)** | **C — единое агентное ядро (handleTurn + ReplySink + ConfirmPort)** |
|---|---|---|---|
| Ship-On-совместимость | ✅ каждая заплатка готова→ON сразу | 🟡 средняя фича, выкатывается целиком | ❌ большой рефактор, живёт за флагом неделями (нарушает принцип 8) `[verified: red-team]` |
| Риск для web-чата | ✅ не трогает concierge | 🟡 трогает tool-router (loopback→in-process) | ❌ переписывает исполнение инструментов работающего чата (правился вчера, prompt-cache настроен) `[verified: git]` |
| Конфликт с горячей зоной | ✅ изолированные правки | 🟡 пересекается с inbound | ❌ эпицентр (`telegram-bot.adapter`/`conversational.service` правились вчера) `[verified: git log]` |
| Покрытие боли владельца | ✅ ~70-80% («молчит», «нет отчётов») `[inferred: red-team оценка]` | + мульти-действия из чата | + всё, но большей частью не запрошено |
| RBAC-безопасность | ✅ ничего нового наружу | 🟡 требует узкого telegram-whitelist (НЕ 19) | 🟡 та же оговорка |
| Объём | дни | 1-2 недели | недели, в горячей зоне |
| Закрывает корень B (структурный раскол) | нет (симптомы) | частично | да (но дорого/рискованно сейчас) |

**ADR (доказательство выбора):**
- **Контекст Z:** Ship-On запрещает полу-готовый функционал за флагом; зона горячая (3 автора параллельно); web-чат живой; боль владельца на 70-80% — дефекты доставки/рендера, а не отсутствие агента.
- **Альтернатива C (steelman):** «правильная» индустриальная архитектура (одно ядро + тонкие адаптеры, подтверждено Mastra/OpenAI SDK). Но: нарушает Ship-On, concierge не отделяется тонко (`baseUrl`/`authCookie`/loopback/470-строчный `process()` с квотами/метриками/PRM), дестабилизирует работающий чат, падает в горячую зону. Цена регрессии > ценности.
- **Альтернатива B (steelman):** переиспользовать существующий concierge через тонкий sink, без абстрактного ядра. Дешевле C, сразу вскроет — нужны ли вообще все 19 инструментов (скорее всего нет → узкий whitelist). Но даже B оправдан **только после** того, как заплатки покажут, что узкого набора мало.
- **Решение (с учётом решения владельца 2026-06-11):** ЦЕЛЬ — **единый помощник-мозг** (унификация на concierge, открытом в Telegram как окно). ПУТЬ — фазами: Шаг 1 = заплатки A (стоп-молчание + видимые брифы, сразу, ноль риска) → Шаг 2 = native-инструменты помощника → Шаг 3 = открыть помощника в Telegram (механизм B, эволюционно: добавить service-auth рядом с cookie-loopback, узкий whitelist) → Шаг 4 = расширение. **«Дублировать интенты в Telegram» отвергнуто** (второй мозг — текущая болезнь); **«большой движок разом» (C big-bang) отвергнут как СПОСОБ**, но унификация (его цель) достигается инкрементально через B.

---

## 7. Рекомендация — фазами, заплатки-first, узко

> Разбивается на отдельные ТЗ. Сначала Ф0+Ф1 одним ТЗ (дешёвые, высокоэффективные); Ф2 — отдельным ТЗ по спросу; Ф3 — отдельным research+ТЗ, не сейчас.

**Ф0 — Остановить молчание (Ship-On-нативно, дни). 🔴 Сначала подтвердить прод-ENV (Р-0).**
1. Вернуть chat-ответ **в тот же канал**: понизить `dataClass` chat-ответа до `internal` (или до потолка канала-источника) в [chat-v2.module.ts:74](backend/src/modules/chat-v2/chat-v2.module.ts#L74)/[conversational.service.ts:424](backend/src/modules/conversational/conversational.service.ts#L424). Большинство ответов — не приватные факты о людях; для `private`-фактов механизм subject-ACL в `canEmit` уже есть.
2. ack на `free_note` («Записал в память Коры») в bridge/адаптере.
3. (опц.) reply-без-match на наше уведомление — отвечать подсказкой, а не молчать.

**Ф1 — Понятные планы и отчёты в Telegram (Ship-On-нативно, дни).**
- Дорендерить 8-10 невидимых eventType в `renderText` ([telegram-bot.adapter.ts:1254](backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts#L1254)) — приоритет: `checkin.prompt` (видимый вопрос чек-ина), `operations.weekly_digest`, `goals.pulse`, `operations.monthly_recap`, `event.reminder`, `issue.mention`, `idea.status_changed`. Универсальная ветка «есть `title`+`body` → отрисовать + ссылка из `actionUrl`» закрывает большинство одним махом.
- Результат: «Lindy-style» проактивный бриф в Telegram почти бесплатно (Кора его уже генерирует).

**Ф2 (Шаг 2) — Надёжные инструменты помощника (native function-calling).**
- Перевести concierge с regex-эмуляции tool-use на **native function-calling** — транспорт в `llm-router` УЖЕ готов (`params.tools`→провайдер→`tool_calls`), concierge просто его не использует. Делать **инкрементально, in-place** (не big-bang). Для RU-fallback (GigaChat/YandexGPT) — только **sequential** tool-loop + `tool_choice='auto'` (parallel/forced у RU-провайдеров нет, verified). Это фундамент, чтобы открыть помощника в Telegram надёжно.

**Ф3 (Шаг 3) — Открыть помощника (concierge) в Telegram — окно к ЕДИНОМУ мозгу.**
- Telegram ходит к **тому же** `ConciergeService`, что и кабинет, через **сервисный путь исполнения инструментов** (резолв userId/tenantId из `ChannelBinding`, сервисный auth вместо cookie-loopback, сбор ответа в одно текстовое сообщение). **НЕ дублировать интенты** в Telegram — это создало бы второй мозг (отвергнуто владельцем).
- Сначала — **узкий безопасный набор ~6-7 инструментов «своё»** (см. §10), отдельный telegram-whitelist ≠ полному concierge-whitelist. Подтверждение мутаций — текстом (zero-button); недеструктивные — через `undoableVia` (откат вместо подтверждения).
- Риск, который снимаем аккуратно (red-team): сервисный путь трогает `ToolRouter` (его использует работающий web-чат) — добавляем **режим service-auth рядом** с cookie-loopback, не переписывая существующий, + не лезем в горячую зону большой стройкой.

**Ф4 (Шаг 4, потом) — Расширение.** Больше действий, руководительские запросы (после строгого ресурс-гейта), другие каналы. Любое умение добавляется **в помощника один раз** → работает во всех окнах.

---

## 8. Минимальный безопасный tool-набор для Telegram (если дойдём до Ф2)

Concierge **не обходит RBAC** (`tool-router` проверяет права по userId перед каждым вызовом). Но маппинг ресурс→роль местами слаб для публичного канала:

| Инструмент | Безопасен в Telegram | Почему |
|---|---|---|
| `list_my_events`, `list_tasks`, `list_meetings` (своё) | ✅ | self-scope |
| `create_event`, `create_meeting` (своё, undoable) | ✅ | write на своё, есть откат |
| `find_free_slot`, `search_knowledge`, `ask_chat_v2` | ✅ | read |
| **`get_person_pulse`** | ⚠️ **НЕ давать** | гейтится `person:read`, который в Z открыт **всем менеджерам** → LLM-агент в публичном Telegram по свободному тексту вытащит «настроение и риски Ивана». Дать только после перевода на строгий ресурс (`dashboard_operations`). `[verified: policy.csv:177]` |
| `get_team_health`, `list_overdue_promises`, `list_ignored_probe_questions` | ❌ отложить | гейтятся `dashboard_operations` (owner/admin) — рядовой и так 403; НЕ продавать как «руководитель спросит из Telegram», пока нет доверенного director-контекста |

→ **Telegram-whitelist должен быть отдельным и ≠ полному concierge-whitelist.** Тащить все 19 в публичный канал = расширять attack-поверхность (инъекция, чужой чат) ради сценариев, которые либо 403, либо опасны. `[verified: red-team scope-pragmatist]`

---

## 9. Что НЕ делать (вынесено из scope состязательной проверкой)

- ❌ **Большой «единый агентный движок» одним заходом (C big-bang) сейчас** — нарушает Ship-On, дестабилизирует web-чат, конфликтует с горячей зоной. (Сама ЦЕЛЬ-унификация на помощнике принята — достигаем её инкрементально через Шаги 1-3, не переписыванием разом.)
- ❌ **Дублировать действия Telegram отдельными интентами как постоянное решение** — создаёт второй мозг (та же болезнь chat-v2 ≠ concierge). Открываем помощника, а не плодим параллельную логику.
- ❌ **«Подтвердить 32 pending пачкой» из Telegram** — невозможно по природе 3/4 источников; противоречит вашему же принципу «никаких human-in-loop на каждый чих, 30 человек будут соглашаться не вникая» ([[feedback_no_human_in_loop_for_clone_learning]]). Реалистично — текстовый ответ на ОДИН probe (уже работает).
- ❌ **Все 19 инструментов + руководительская аналитика в публичном Telegram** — RBAC-поверхность; узкий whitelist «своё».
- ❌ **Голосовой вывод/TTS в Telegram** — нарушает text-only ([[feedback_concierge_text_only_output]]).
- ❌ **Inline-кнопки в системных/probe-диалогах** — zero-button, подтверждение текстом ([[feedback_probe_no_buttons_text_voice_only]]).

---

## 10. Открытые вопросы владельцу (каждый — с рекомендацией)

- **Р-0 (РЕШЕНО прод-проверкой 2026-06-11):** gating на проде **ВКЛЮЧЁН**; `chat.answer` (sensitive) режется и на `telegram_bot`, и на `in_app` (оба эффективный потолок `internal`) → **0 каналов → `status=failed`** (трейс по webhook Telegram, см. §3.4). Значит Ф0-пункт «понизить dataClass chat-ответа до `internal`» — **подтверждённо корректный и критичный** фикс (а не «бесполезный, если gating OFF»). Остаточно непроверено: фактический `CONCIERGE_ENABLED` рантайма (по коду+файлу — ON) — не блокирует Ф0/Ф1.
- **Р-1 (scope):** ограничиваемся ли Ф0+Ф1 (стоп-молчание + видимые брифы) как самостоятельным релизом? **Рекомендация: да** — это 70-80% боли за дни, Ship-On-нативно, ноль риска. *Почему:* действия из Telegram — отдельная, более рискованная фаза; начинать с дешёвого высокоэффективного.
- **Р-2 (как делать Ф2):** прямые интенты поверх классификатора **или** headless-адаптер к concierge (вариант B)? **Рекомендация: headless-адаптер с узким whitelist** — переиспользует готовые инструменты и RBAC, не плодит логику. *Почему:* точечные интенты дублируют то, что в инструментах уже есть; адаптер сразу вскроет реальный нужный набор.
- **Р-3 (руководительская аналитика):** нужна ли «что с менеджером X» именно из Telegram в Ф2? **Рекомендация: отложить** до перевода `get_person_pulse` на строгий ресурс-гейт. *Почему:* сейчас `person:read` открыт менеджерам — давать это LLM-агенту в публичном канале небезопасно.
- **Р-4 (RU-fallback действий):** закладывать ли в Ф3 действия на RU-LLM (GigaChat/YandexGPT)? **Рекомендация: да, но только sequential tool-loop + `auto`** (без parallel/forced — их у RU-провайдеров нет). *Почему:* импортозамещение — приоритет Z; ограничение проектируем сразу, чтобы tool-loop не сломался при маршрутизации на RU-провайдер.

---

## 11. Допущения и риски

| Допущение / риск | Ось | Уверенность | Как проверить |
|---|---|---|---|
| На проде оба ENV в дефолте (ON/ON) → оба кейса молчания воспроизводятся | feasibility | средняя | Р-0 (прод-чек ENV + метрика) |
| Понижение dataClass chat-ответа до `internal` не раскрывает приватных фактов о людях | desirability/safety | средняя | ревью типов ответов chat-v2; для `private` — subject-ACL уже есть |
| Узкого набора (Ф0+Ф1) владельцу хватит, спрос на действия (Ф2) надо подтверждать | desirability | средняя | наблюдать после Ф1; не строить ядро «на всякий случай» |
| Рефактор в горячей зоне даст конфликты | feasibility | высокая | git показал 169 коммитов/3 автора за 3 дня; держать Ф0/Ф1 в изолированных файлах |
| RU-LLM tool-calling незрелый (нет parallel/forced) | feasibility | высокая `[verified]` | sequential-loop + провайдер-капабилити-флаги |

---

## 12. Ограничения и непроверенное

- **`[verified: прод 2026-06-11]` `DATACLASS_OUTBOUND_GATING_ENABLED` = ON** и **Кейс B воспроизводится на живых данных** — прод-логи (diag.ts) показывают `blocked outbound emit` для `chat.answer` на `telegram_bot` И `in_app` → `status=failed`. Диагноз Кейса B подтверждён не только кодом, но и боевыми трейсами.
- **`[unverified]` `CONCIERGE_ENABLED` рантайма** — по коду+файлу `.env` дефолт ON, но рантайм-env контейнера прямо не читался (мог прийти из CI/secret-manager). Не блокирует Ф0/Ф1 (они не про concierge); важно для Ф2 (где переиспользуется concierge).
- **`[claimed]` Точные имена параметров `sendMessageDraft`** (`draft_id` и т.п.) — из вторичных источников; перед реализацией сверить с core.telegram.org/bots/api (раздел методов отдавался усечённым).
- **`[claimed]` Часть продуктовых заявлений** (Lindy/Martin «делают всё», точность mymeet «98%») — маркетинг вендоров; в матрицу не как измеренный факт.
- **OSS-звёзды** — на дату обращения 2026-06-11.

---

## 13. Источники

**Наш код `[verified]`:** concierge.service.ts, service-map-generator.service.ts, tool-router.service.ts, concierge.controller.ts; conversational.service.ts, conversational.module.ts, adapters/telegram-bot/{telegram-bot.adapter.ts, telegram-bot-message.handler.ts, telegram-digest.cron.ts}; chat-v2.module.ts, chat-v2.service.ts; dialog-layer/{query-classifier.service.ts, prompts/classify.prompt.ts}; knowledge-core/services/dataclass-policy.service.ts; ai/services/{llm-router.service.ts, deepseek.service.ts, openai-proxy.service.ts}; pending-actions/*; common/config/{env.schema.ts, typed-config.service.ts}; rbac/policies/policy.csv.

**Внешние `[verified]`:** [api-docs.deepseek.com/guides/function_calling](https://api-docs.deepseek.com/guides/function_calling) · [core.telegram.org/bots/api-changelog](https://core.telegram.org/bots/api-changelog) · [core.telegram.org/bots/faq](https://core.telegram.org/bots/faq) · [OWASP AI Agent Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html) · [mastra.ai/blog/building-multi-user-multi-channel-agents](https://mastra.ai/blog/building-multi-user-multi-channel-agents) · [openai.github.io/openai-agents-python/sessions](https://openai.github.io/openai-agents-python/sessions/) · [developers.sber.ru GigaChat functions](https://developers.sber.ru/docs/ru/gigachat/guides/functions/overview) · [aistudio.yandex.ru function-call](https://aistudio.yandex.ru/docs/en/ai-studio/operations/generation/completions-function.html) · GitHub: opencode-telegram-bot, NanoGemClaw, Teleton, ClawStart, grammY · [singularity-app.ru/blog](https://singularity-app.ru/blog/ai-assistent-v-singularityapp/) · [lindy.ai](https://www.lindy.ai/) · [vellum.ai/blog/best-lindy-ai-alternatives-2026](https://www.vellum.ai/blog/best-lindy-ai-alternatives-2026).

**`[claimed]`:** OpenClaw (195k★, разборы), Lindy/Martin вендорские заявления, mymeet «98%».

---

## 14. Метод

Исследование: vexp-демон выключен → код читался напрямую (Grep/Read). Fan-out 8 суб-агентов (4 по коду Коры: судебка молчания, инвентаризация возможностей, внутренности агента + Action Center, проактивный outbound; 4 внешних: OSS/GitHub, зарубежные продукты+паттерны, РФ-рынок+RU-LLM, архитектура «мессенджер как фронт агента»). Состязательный второй проход — 3 red-team-агента с независимым retrieval (архитектурный скептик, верификатор фактов, прагматик по объёму), которые **существенно скорректировали** рекомендацию: с «единое ядро C как цель» на «заплатки A сейчас + узкий B по спросу + C как северная звезда», вынесли из scope пакетное подтверждение и широкий tool-доступ, выявили блокер-развилку прод-ENV (Р-0). Воспроизведение в проде не делалось (нужно явное разрешение владельца).
