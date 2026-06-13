# Реестр флагов — Z / Кора

> **Правило (CLAUDE.md принцип 8 «Ship-On»): выкатываем включённым.**
> Готовая фича идёт в прод СРАЗУ включённой. «Дефолт OFF, владелец включит потом» и фаза «понаблюдаем → включим» — **запрещены**: не готова включиться, значит не готова к выкату.
>
> Это **единственное место**, где видно ВСЕ флаги системы и их состояние. Любой новый флаг = новая строка здесь (часть чек-листа завершения работы). Открыл этот файл — видишь всю картину, без археологии по коммитам.

## Как читать типы

| Значок | Тип | Кто и когда трогает |
|---|---|---|
| 🔴 **A — аварийный рубильник** (kill-switch) | Фича РАБОТАЕТ (ON). Рубильник существует только чтобы экстренно выключить при аварии. | Никто в обычной жизни. Только дежурный при инциденте. **Владельца не касается.** |
| 🟢 **C — решение владельца** | Нельзя включить «просто так» — нужен твой бизнес-параметр (сумма лимита, матрица «кто кого видит»). | **Только ты.** Каждый такой флаг — с явным вопросом ниже. |
| 💳 **Т — тарифный** | Включается по продаже, отдельно для каждой компании. | Продажи / админ, точечно по клиенту. |
| ⚪ **Долг** | Выкачено выключенным по СТАРОМУ правилу (до Ship-On). Разовый разбор: включить готовое или признать незрелым. | Разобрать один раз, дальше по Ship-On такого не появляется. |

---

## 🟢 Требуют ТВОЕГО решения (тип C) — без тебя не включить

Это два изменения, которые меняют что видят/могут люди или тратят деньги. Их нельзя «просто включить» — нужен твой параметр, иначе можно отрезать людям доступ или заблокировать работу.

### 1. Блокировка бюджета на ИИ — `llm.budget.enforce_enabled`
- **Сейчас:** ВЫКЛ (только наблюдение). Расходы на ИИ считаются и пишутся в лог, но **ничем не ограничены** — перерасход возможен.
- **Что при ВКЛ:** при достижении жёсткого лимита новые запросы к ИИ отклоняются. Перерасход невозможен.
- **Что жду от тебя:** реши поведение при превышении — (А) жёстко блокировать / (Б) переключать на дешёвую модель / (В) только слать предупреждение. И сумму месячного лимита. Без этого включать опасно (можно остановить работу компании).

### 2. Разграничение доступа к знаниям — `KNOWLEDGE_ACCESS_ENFORCEMENT`
- **Сейчас:** `off`. Все видят все знания, как раньше. Группы доступа созданы, но ни на что не влияют.
- **Что при ВКЛ (`enforce`):** доступ реально режется — например, логист не видит знания «для Совета директоров». Владелец/админ/супер-админ всегда видят всё.
- **Что жду от тебя:** (1) решение — нужно ли вообще разграничение сейчас; (2) проверить матрицу «какая группа что видит» в админке (`/company-admin/access-groups`), иначе люди мгновенно потеряют доступ к нужному. Промежуточный режим `shadow` (считает, но не режет) — допустим как разовая сверка матрицы силами разработчика, не как бесконечное ожидание.

### 3. Контроль класса данных для ИИ — `DATACLASS_POLICY_ENFORCEMENT`
- **Сейчас:** `shadow` (считает нарушения, не блокирует).
- **Что при `enforce`:** запрещает слать неподходящие данные в неподходящую ИИ-модель (например, чувствительное — не за рубеж).
- **Статус:** **отложено твоим решением** (приватность сейчас не приоритет). Лежит в наблюдении осознанно — это ОК, помечено.

### 4. Какая Org — вендорский деск поддержки — `feature.support_desk` + `support.vendor_org_id`
- **Сейчас:** не задано. Без двух параметров деск не работает (seed'ы — no-op, приём отдаёт 503).
- **Что при ВКЛ:** включаешь вендор-эксклюзивный entitlement `feature.support_desk` **только своей Org** (через `OrgEntitlement.featureOverrides`) и задаёшь AdminSetting `support.vendor_org_id` = id этой Org. После этого обращения всех клиентов Коры приходят в единый деск этой Org, а из её закрытого контура собирается клон поддержки.
- **Что жду от тебя:** id вендор-Org (наша компания) и галочка-членство сотрудников поддержки в группе-контуре (через `POST /support/admin/agents`). Не продаётся клиентам — деск приёма только наша Org (Р-3). (ТЗ support-desk-clone-and-closed-contour Ф1)

---

## ⚪ Долг прошлого — РАЗОБРАН 2026-06-08 (ТЗ enable-shipped)

ТЗ `plans/tz/2026-06-08-enable-shipped-features-by-default.md` (коммит `bb7701dc`) перевёл 4 готовые фичи в **ВКЛ по умолчанию** — включаются сами на `docker compose up` (ENV-дефолт + patch `patch-enable-shipped-flags.ts` для существующего прода, уважает admin-override). Остался один осознанно-OFF (решение владельца).

### ✅ Работает по умолчанию (с 2026-06-08)

| Флаг | Тип | Как включается | Откат |
|---|---|---|---|
| `feature.tables_text_to_schema` | AdminSetting | seed-дефолт true + patch | человек подтверждает превью схемы (галлюцинация не создаётся молча); риск смягчён. AdminSetting → false |
| `knowledge.meetingTasksToTrackerOnly` | AdminSetting | seed-дефолт true + patch | из встречи одна задача (Issue); `assigneeRaw`/`sourceQuote` станут null. AdminSetting → false |
| `CONCIERGE_DIALOG_LAYER_ENABLED` | ENV (code-default) | code-default ON | kill-switch: `=false` в `.env` + рестарт |
| `knowledge.curationAutotuneEnabled` | AdminSetting (code-fallback) | code-fallback true + patch; с 2026-06-12 и seed-дефолт true (autonomy W3) | базовый kill-switch порогов и так активен. AdminSetting → false |

### ⏸️ Остаётся OFF — осознанное решение владельца

_(пусто — все доставки в Telegram авторизованы владельцем 2026-06-08, см. ниже)_

---

## 🔴 Аварийные рубильники (тип A) — работают, тебя не касаются

Фичи включены и работают. Рубильник существует только на случай аварии. Действий не требуется.

| Флаг | Сейчас | Что выключает рубильник (только при аварии) |
|---|---|---|
| `RECORDING_FASTSTART_ENABLED` | 🟢 ВКЛ | Видео встреч стартует в плеере сразу (без долгой «крутилки»). |
| `graph.ageEnabled` / `GRAPH_AGE_ENABLED` | 🟢 ВКЛ | Граф знаний пишется в графовую базу. Выкл → только обычная база. |
| `chatbox.enabled` | 🟢 ВКЛ | Синхронизация переписок ChatBox в память. Выкл → синк замирает. |
| `RECORDING_TRACK_RECONCILE_ENABLED` | 🟢 ВКЛ | Надёжная сверка аудиодорожек записи. |
| `knowledge.subjectAttributionEnabled` | 🟢 ВКЛ | Привязка авторства знаний (оживление клонов). |
| `knowledge.commitmentAuthorAttributionEnabled` | 🟢 ВКЛ | Привязка автора обещаний (план-факт). |
| `notifications.daily_budget.enabled` | 🟢 ВКЛ | Дневной бюджет push-уведомлений (не заваливать человека). Выкл → push не ограничивается. (TZ-1 Ф0 daily-value) |
| `notifications.binding_campaign.enabled` | 🟢 ВКЛ | Кампания привязки Telegram-канала (приглашение + напоминание сотрудникам без привязки). Выкл → приглашения не шлются. (TZ-1 Ф0) |
| `operations.daily_digest.deliver_to_telegram` | 🟢 ВКЛ | Ежедневный отчёт COO доставляется в Telegram. Владелец авторизовал доставку в ТГ 2026-06-08 (батч daily-value). Выкл → отчёт только в кабинете. |
| `goals.pulse.deliver_to_telegram` | 🟢 ВКЛ | Еженедельный пульс целей доставляется в Telegram. Владелец авторизовал доставку в ТГ 2026-06-08 (батч daily-value). Выкл → пульс только в кабинете. |
| `operations.customer_risk_radar.enabled` | 🟢 ВКЛ | Дневной радар клиентов под риском (cron 21:00 → COO-дайджест «Клиенты под риском» + push ответственному менеджеру). Выкл → снимки не строятся, пушей нет. (TZ-1 Ф1 daily-value) |
| `operations.personal_daily_brief.enabled` | 🟢 ВКЛ | Персональный дневной бриф «Твой день» (cron каждый час, утреннее окно по таймзоне сотрудника → push через бюджет). Выкл → брифы не строятся и не шлются. (TZ-1 Ф2 daily-value) |
| `operations.knows_who.enabled` | 🟢 ВКЛ | Помощник «кто знает X» (семантический поиск носителя знания по блокеру/вопросу через skill-профили). Выкл → `/me/knows-who` и skill-подсказка в брифе возвращают пусто. (TZ-1 Ф2 daily-value) |
| `operations.blocker_synthesis.enabled` | 🟢 ВКЛ | Накопительный синтез блокеров (cron 22:00 → статусы new/recurring/resolved + бизнес-удар + мост хроники в инсайт-радар). Выкл → синтез не строится, мостов в Insight нет. (TZ-1 Ф3.A daily-value) |
| `operations.decision_controller.enabled` | 🟢 ВКЛ | Контролёр внедрения решений (cron 06:00 → решения без задач/результатов старше N дней → stalled + push ответственному + агрегат «% доведённых»). Выкл → статусы внедрения не пересчитываются, пушей нет. (TZ-1 Ф3.B daily-value) |
| `operations.promise_cascade.enabled` | 🟢 ВКЛ | Каскад обещаний (cron 08:00 → просроченное обещание с зависимостью → дневной алерт автору и руководителю). Выкл → каскадные алерты не шлются. (TZ-1 Ф3.C daily-value) |
| `ideas.feed.enabled` | 🟢 ВКЛ | Лента идей `GET /ideas/top` (ре-ранк weight+свежесть+цель) + авто-продвижение статуса идеи при закрытии связанной задачи (через `tracker.event_occurred`). Выкл → `/ideas/top` отдаёт топ без авто-морфинга статусов. (TZ-1 Ф4.A daily-value) |
| `insights.recheck.enabled` | 🟢 ВКЛ | Re-check митигированных инсайтов в insight-clusterer cron (повтор паттерна старше `insight.recheck_days` → возврат в active). Выкл → митигированные инсайты не перепроверяются. (TZ-1 Ф4.B daily-value) |
| `operations.knowledge_at_risk.enabled` | 🟢 ВКЛ | Еженедельный синтез знание-под-риском × уход человека (cron пн 05:00 → снимок + push РУКОВОДИТЕЛЮ носителя; носителю — ничего, этика). Выкл → снимки не строятся, пушей нет. (TZ-1 Ф4.C daily-value) |
| `operations.team_capacity.enabled` | 🟢 ВКЛ | Capacity-агрегат по командам (`GET /dashboard/operations/team-capacity` + строка в COO-дайджесте: перегруз/недогруз по отделам). Выкл → endpoint/строка не считаются. (TZ-1 Ф4.D daily-value) |
| `operations.onboarding_ramp.enabled` | 🟢 ВКЛ | Онбординг-рамп новичка (cron 07:00 → молчащий новичок старше `onboarding.silent_days` → push руководителю + новичку «спроси у памяти»). Выкл → рамп не считается, пушей нет. (TZ-1 Ф4.E daily-value) |
| `operations.value_recap.enabled` | 🟢 ВКЛ | Месячная витрина value-recap (cron 1-го числа → build за прошлый месяц на твёрдых данных + push-first владельцу/COO). Выкл → витрина не строится, пушей нет. (TZ-1 Ф5 daily-value) |
| `chat_v2.feedback.enabled` | 🟢 ВКЛ | Оценка ответов AI-чата (палец вверх/вниз на ChatV2Message, web + Telegram/in_app) — несущая часть helped-rate месячной витрины. Выкл → `POST /chat-v2/messages/:id/feedback` отдаёт 403, оценка не собирается. (TZ-1 Ф5 daily-value) |
| `dashboard.main_rework.enabled` | 🟢 ВКЛ | Новая компоновка главной директора — первый экран ≤7 величин (Польза/Настроение/Обещания/Висящие решения/Компас/AI-сводка/Top-1 риск) + единый компас + «Что узнали» + сворачивание виджетов знаний в drill-down. Бэкенд всегда считает `valueStrip`; флаг едет в DTO как `mainReworkEnabled` и гейтит только инфо-перекомпоновку первого экрана на фронте (современный визуал выкатывается безусловно). Выкл → прежняя раскладка первого экрана. (ТЗ-2 Ф1 daily-value-dashboards) |
| `operations.dashboard_rework.enabled` | 🟢 ВКЛ | Новая раскладка COO-дашборда — capacity по командам, «сколько закрыли» (resolved-зеркало блокеров/конфликтов), хронические блокеры с «Причиной», приём переносов. Едет в overview DTO как `reworkEnabled`, гейтит инфо-перекомпоновку на фронте (визуал безусловно). Выкл → прежняя раскладка COO. (ТЗ-2 Ф2 daily-value-dashboards) |
| `operations.per_person_self_view.enabled` | 🟢 ВКЛ | Self-view недельного план-факта рядовому — `GET /api/v1/me/weekly-per-person` (своя строка + средняя надёжность команды для стрелки «я vs команда»). Выкл → endpoint отдаёт пустой self DTO. (ТЗ-2 Ф4 daily-value-dashboards) |
| `me.daily_value_widgets.enabled` | 🟢 ВКЛ | 4 виджета ежедневной ценности в `/me` (память помогла / мой план-факт / судьба идей / признания) + self-эндпоинты `GET /me/ideas`, `GET /me/recognitions`. Выкл → эндпоинты отдают пустой список (виджеты graceful-empty). (ТЗ-2 Ф5 daily-value-dashboards) |
| `operations.portfolio_health.enabled` | 🟢 ВКЛ | Дашборд здоровья портфеля целей: cron пн 05:00 пишет недельный `PortfolioHealthSnapshot`, `GET /operations/portfolio-health` (healthScore 0–100 + светофор + распределение по статусам + MoSCoW-разрез + дельта неделя-к-неделе). Выкл → cron не пишет, endpoint отдаёт пустой скелет. (ТЗ-2 Ф6.A daily-value-dashboards) |
| `documents.ai_attribution.enabled` | 🟢 ВКЛ | LLM-подсказка атрибуции загруженного документа: после парсинга документа БЕЗ явной атрибуции (`docType` и `attachedThemeId` оба пусты) дешёвый классификатор `document-attribution-suggest` предлагает смысловой тип + тему графа и пишет их в `Document.suggested*` (человек подтверждает в UI — авто-применения нет, Р3). Выкл → подсказка не строится, `suggested*` остаются пустыми. (ТЗ-4 Ф10 manual-document-upload) |
| `meeting_upload.enabled` / `MEETING_UPLOAD_ENABLED` | 🟢 ВКЛ | Ручная загрузка встреч (`POST /meetings/upload` — видео/аудио ≤2 ГБ → ingest → диаризация → разметка спикеров → анализ). Выкл → создание новой загрузки отклоняется кодом `UPLOAD_DISABLED`; уже принятые загрузки доезжают. AdminSetting-ключ (ENV — fallback). (ТЗ-5 Ф6 meeting-upload-diarization) |
| `MEETING_VISIBILITY_ENABLED` | 🟢 ВКЛ | «Кому видно» встречу: хост задаёт аудиторию (`owner_only`/`participants` дефолт/`custom`/`org`) — кому видна встреча, тому видны видео/запись/расшифровка/отчёт (6 READ-поверхностей через `canView`). Выкл → аварийный откат к legacy owner-only (встречу видит только создатель), на всех затронутых поверхностях. ENV-рубильник (`cfg.meetingVisibilityEnabled`, zBool default true). Действий владельца НЕ требует. (ТЗ meeting-visibility-who-can-see Ф6) |
| `QUERY_PLAN_EXTRACTION_ENABLED` | 🟢 ВКЛ | Query Understanding Волна 1: извлечение структуры запроса (dialog-extract-plan) + recall-safe структурный фильтр chat-v2. OFF → чат работает как раньше (чистый смысловой top-K). (ТЗ query-understanding-tier0-tier1) |
| `SUPPORT_DESK_ENABLED` | 🟢 ВКЛ | Встроенная служба поддержки (приём обращений клиентов → деск → ответы сотрудников → закрытый контур памяти → клон-черновик). Выкл → `POST /support/tickets` отдаёт `SUPPORT_DESK_DISABLED` (503), деск замирает. ENV-рубильник. (ТЗ support-desk-clone-and-closed-contour Ф1) |
| `SUPPORT_CURATOR_ENABLED` | 🟢 ВКЛ | Ночной куратор контура поддержки (`@Cron('0 3 * * *')` → анализ дневных сигналов → keep/fix/merge/archive по блокам контура за debate-гейтом, только soft-archive). Выкл → cron no-op, база контура не пересобирается. ENV-рубильник. (ТЗ support-desk-clone-and-closed-contour Ф4) |
| `LLM_DEEPSEEK_FORCE_TOOL_CHOICE_ENABLED` | 🟢 ВКЛ | Форс вызова synthetic-tool (`tool_choice:{type:function}`) для НЕ-thinking DeepSeek-моделей при autoConvert (json_schema→tool), чтобы flash возвращал структуру, а не прозу. Guard в `deepseek.service` сам откатывает на `auto` при format-400 и не форсит thinking-модели. Выкл → поведение `auto` (модель может вернуть прозу). ENV-рубильник. (retest3 Ф2 #56/Р2) |
| `LLM_MAIN_REPORT_PRIMARY` | 🟢 `deepseek` | Основной провайдер ГЛАВНОГО отчёта встречи (`LlmFallbackService`): `deepseek` (Ship-On — кэш DeepSeek + per-agent pro-модель, каскад DeepSeek→MiniMax→OpenAI). Рубильник-откат: `=minimax` → прежний каскад MiniMax→OpenAI. ENV-enum (`minimax`/`deepseek`). (retest3 Ф5 #51/Р3) |
| `aiFeatures.clientProtocolEnabled` / `CLIENT_PROTOCOL_ENABLED` | 🟢 ВКЛ | Нейтральный ПРОТОКОЛ встречи наружу для клиента (`client-meeting-split`, free-text Markdown): для клиентских типов (sales/customer_success/partner/custdev) `analyze.worker` дополнительно генерит протокол БЕЗ внутренних оценок (граница D6) и мержит в `AiResult.structuredData.client_protocol_md`. Выкл → протокол не генерится, основной отчёт по типу не затрагивается. AdminSetting-ключ (ENV — fallback). (Волна 4 B0 master-prompt-fleet) |
| `aiFeatures.docCompilerEnabled` / `DOC_COMPILER_ENABLED` | 🟢 ВКЛ | Агент-компилятор `contentMd` орг-документа (`compile-org-document`, tool-use): на verdict merge/extension от `regulation-dedupe` специалист 3.1 собирает структурный документ по шаблону типа (regulation/process/policy/instruction; режимы СОЗДАНИЕ/ДОПОЛНЕНИЕ, маркеры) вместо plain-update поля + инкремент `version`. Выкл → legacy plain-update поля (dedupe-путь не ломается). Best-effort: при ошибке компилятора — fallback к существующему телу. ENV-рубильник. (Волна 6 Стадия C A7 master-prompt-fleet) |
| `CHECKIN_GRAPH_INGEST_ENABLED` | 🟢 ВКЛ | Мост ежедневный чек-ин → knowledge-core (`CheckinIngestService`): на событие `checkin.created` завершённый чек-ин (план/отчёт) кладётся в `RawEvent(sourceType='daily_checkin', dataClass='sensitive')` → block-ingest (граф знаний). Best-effort, рядом с `CheckinSentimentAnalyzerWorker`. Рубильник на случай инцидента в block-ingest, действий владельца не требует. Выкл → чек-ины в граф не попадают (sentiment/обработка чек-ина не затронуты). ENV-рубильник (`betaOps.checkinGraphIngestEnabled`, zBool default true). (ТЗ daily-checkin-to-graph-bridge) |
| `PROBE_SUBJECT_ADDRESSING_ENABLED` | 🟢 ВКЛ | Адресация уточняющих вопросов (probe) про сотрудника — самому сотруднику (само-подтверждение), затем главе его отдела, затем владельцу; НЕ владельцу напрямую. Выкл → прежнее поведение (глава отдела / админы, субъекту не шлётся). ENV-рубильник (`cfg.probe.subjectAddressingEnabled`, zBool default true). (ТЗ cabinet-leftovers §3 Ф1) |
| `CHAT_V2_STREAMING_ENABLED` | 🟢 ВКЛ | Стадии прогресса AI-чата через SSE («Понимаю → Ищу → Пишу») на `POST /chat-v2/messages/stream`. Выкл → эндпоинт отдаёт 503, фронт прозрачно откатывается на синхронный `/messages` (ответ приходит без стадий). Посимвольного стрима токенов нет (отдельный follow-up). ENV-рубильник (`cfg.chatV2.streamingEnabled`, zBool default true). (ТЗ cabinet-leftovers §4 Ф1) |
| `REGULATION_GATE_STRICT_ENABLED` / `aiFeatures.regulationGateStrict` | 🟢 ВКЛ | Строгий булев гейт `isOrgNorm` в regulation/policy/instruction-экстракторах — режет «не-нормы» (личные мнения, разовые факты) до записи орг-документа (промпты-MASTER A1.2). Выкл → recall-страховка: гейт мягкий, спорное пропускается в дедуп (риск шума, не пропуска нормы). ENV-рубильник (zBool default true). (Волна A1.2 master-prompt-fleet) |
| `CHATBOX_TASK_EXTRACTION_ENABLED` / `aiFeatures.chatboxTaskExtractionEnabled` | 🟢 ВКЛ | Извлечение задач из клиентской переписки (ChatBox Ф5): закрытая сессия → LLM-извлечение action items → `Task` с `sourceType='chatbox'`. Выкл → переписка по-прежнему мостится в граф, но задачи из неё не создаются. ENV-рубильник (zBool default true). (ТЗ chatbox-memory-finishing Ф5) |
| `TASKS_CROSS_SOURCE_DEDUPE_ENABLED` / `aiFeatures.tasksCrossSourceDedupeEnabled` | 🟢 ВКЛ | Межисточниковый дедуп задач (ChatBox Ф6): задача из переписки, семантически совпадающая с задачей из встречи/трекера (cosine ≥ порога), не плодит дубль. Выкл → дедуп между источниками не работает (возможны повторы «встреча + чат»). ENV-рубильник (zBool default true). (ТЗ chatbox-memory-finishing Ф6) |
| `operations.daily_digest.deliver_to_webpush` | 🟢 ВКЛ | Доставка утреннего exec web-push «Требует тебя сегодня: N» (`ExecMorningPushCron`, hourly, утреннее окно по таймзоне). Выкл → утренний exec-push не шлётся (без него Мобильная Кора работает, просто не напоминает). AdminSetting-ключ, ENV-fallback `OPS_DIGEST_DELIVER_TO_WEBPUSH=true`. (Мобильная Кора Ф7) |
| `probe.adaptiveFatigueEnabled` | 🟢 ВКЛ | Снижение частоты уточняющих вопросов (probe) тем, кто на них не отвечает (бюджет режется вдвое получателю с низким engagement). Выкл → все получают полный бюджет probe (без учёта вовлечённости). AdminSetting-ключ (code-default true). (probe Ф1) |
| `probe.digestEnabled` | 🟢 ВКЛ | Батч-дайджест отложенных probe (`ProbeDigestCron` собирает накопленные `queued_digest`-вопросы в одно сводное уведомление «Вопросы от Коры»). Выкл → дайджест не шлётся, отложенные probe копятся (не доставляются). AdminSetting-ключ (code-default true). (probe Ф1) |
| `REPORT_INGEST_ENABLED` | 🟢 ВКЛ | Мост отчёт встречи → граф знаний: по готовности быстрого AI-отчёта (`meeting.report-fast-ready`) его чистая выжимка + структурные выводы по типу кладутся в граф как **вторичный** источник (`RawEvent(sourceType='meeting_report')`). Выкл → отчёт в граф не попадает (граф питается только транскриптом, как раньше); сам отчёт пользователю не затрагивается. Рубильник на случай инцидента в block-ingest, действий владельца не требует. ENV-рубильник. (ТЗ report-to-graph-phase2 Ф3) |
| `CONCIERGE_NATIVE_TOOLS_ENABLED` | 🟢 ВКЛ | Native function-calling (встроенный вызов инструментов LLM) в помощнике-консьерже: tools уходят провайдеру через `LlmCallParams.tools` вместо regex-эмуляции `{"tool_call"}` в тексте. Выкл → прежняя текстовая эмуляция (откат бит-в-бит). ENV-рубильник (zBool default true). (ТЗ assistant-channels Ф3) |
| `ASSISTANT_CHANNEL_ROUTING_ENABLED` | 🟢 ВКЛ | Единый мозг помощника в каналах: свободный текст/голос из Telegram/MAX идёт как `assistant_turn` в ConciergeService (память диалога per-binding в Redis, 24ч). Выкл → прежний узкий классификатор free_note (аварийный откат); чек-ин и task-intent от флага не зависят. ENV-рубильник (zBool default true). (ТЗ assistant-channels Ф5) |
| `knowledge.curationConflictArbiterEnabled` | 🟢 ВКЛ | Ночной LLM-арбитр конфликтов знаний (`ConflictArbiterCron` 02:00): авто-резолв `keep_old`/`accept_new`/`merge` при консенсусе дебатов и confidence ≥ 0.7 (актор — владелец Org, post-hoc system.message); `evolving`/`escalate` остаются человеку. Выкл → все конфликты ждут ручного разбора, как раньше. AdminSetting-ключ (code-default true). (ТЗ autonomy W1) |
| `CLONE_RESPOND_GROUNDING_ENABLED` | 🟢 ВКЛ | Клон отказывается отвечать без опоры на наблюдения (анти-галлюцинация): пост-LLM гейт — ответ без единой валидной цитаты `[BLOCK:id]`/`[DECISION:id]` из subgraph заменяется программным отказом. Выкл → поведение до Э0.1 (ответ без опоры уходит пользователю как есть). ENV-рубильник (`cfg.skill.cloneRespondGroundingEnabled`, zBool default true). (ТЗ clone-persona-method-layer Э0.1) |
| `ROLE_PRINCIPLE_SYNTHESIS_ENABLED` / `knowledge.rolePrincipleSynthesisEnabled` | 🟢 ВКЛ | Reflection-слой клона: ночной cron (`RolePrincipleSynthesisCron`, 05:30) синтезирует из reasoning-блоков должности обобщённые принципы процесса (`RolePrinciple`) с grounding-ссылками. Выкл → принципы роли не синтезируются, persona продолжает работать без секции принципов. ENV-рубильник + AdminSetting (resolveSync, zBool default true). (ТЗ clone-persona-method-layer Э1.2) |
| `VALUE_MOTIVATION_DETECT_ENABLED` / `knowledge.valueMotivationDetectEnabled` | 🟢 ВКЛ | Детектор ценностей/мотивации в rebuild 3.7 (второй проход по тем же reasoning-группам): из явных trade-off («выбрал одно в ущерб другому») извлекаются черты `layer=value\|motivation` для клона. Выкл → профиль наполняется только layer=skill чертами (как до Э1.3). ENV-рубильник + AdminSetting (resolveSync, zBool default true). (ТЗ clone-persona-method-layer Э1.3) |
| `PROCESS_MARKER_DETECT_ENABLED` / `knowledge.processMarkerDetectEnabled` | 🟢 ВКЛ | Детектор конструктивных маркеров процесса в rebuild 3.7 (третий проход по тем же reasoning-группам): извлекаются повторяемые ПРИЁМЫ проработки решений («перечисляет критерии», «перепроверяет данными») → черты `layer=process_marker`; оценочные оси («избегает решений», «не решает сам») запрещены промптом и код-гардом. Выкл → профиль без process_marker-черт (как до Э2.1). ENV-рубильник + AdminSetting (resolveSync, zBool default true). (ТЗ clone-persona-method-layer Э2.1) |
| `PRACTICE_SKILLS_ENABLED` | 🟢 ВКЛ | Подмешивание выученных процедур (PracticeSkill) в ответы клона: retrieval по embedding'у вопроса добавляет в `clone-respond` секцию «известные процедуры» (active всегда + shadow по trafficShare). Выкл → процедуры в ответы клона не подмешиваются; extraction (ночное извлечение) и evaluator (promote/archive) этим флагом НЕ гейтятся и продолжают копить shadow. ENV-рубильник (zBool default true). Флаг Agents v2 C1 был default OFF до Ship-On — активирован ТЗ clone-persona-method-layer Э2.1. |
| `CDM_INTERVIEW_ENABLED` / `knowledge.cdmInterviewEnabled` | 🟢 ВКЛ | CDM-интервью носителя роли: Кора по свежим reasoning-кейсам сама задаёт носителю до 5 не наводящих вопросов ретроспективного разбора (Critical Decision Method — «почему выбрали этот вариант», «какие альтернативы отвергли») через probe (`skill.cdm_interview`); ответ (текст/голос) идёт в граф как high-priority reasoning (`signalTypeHint='reasoning'`). Выкл → Кора перестаёт задавать новые CDM-вопросы носителям; ответы на уже заданные вопросы продолжают обрабатываться (closing-loop probe не гейтится). Лимиты — AdminSetting `knowledge.cdmInterviewMaxQuestions` (5) / `knowledge.cdmInterviewCooldownDays` (7). ENV-рубильник + AdminSetting (resolveSync, zBool default true). (ТЗ clone-persona-method-layer Э3.1) |
| `PERSONA_LAYER_VALIDATION_ENABLED` / `knowledge.personaLayerValidationEnabled` | 🟢 ВКЛ | Еженедельная поведенческая оценка качества клона (`PersonaLayerValidationCron`, вс 07:00, после persona-build): на реальных кейсах роли LLM-судья (`persona-behavior-judge`) сравнивает ответы клона со старой persona v1 («только черты») и новой v2 (все слои метода) → метрика `clone_persona_layer_score{variant}` + лог; ничего не блокирует и не меняет (только наблюдение прод-качества, R10 — без human-approval). Выкл → еженедельная поведенческая оценка persona v1-vs-v2 не запускается; на работу клона не влияет. Число кейсов на роль — AdminSetting `knowledge.personaValidationCasesPerRole` (3). ENV-рубильник + AdminSetting (resolveSync, zBool default true). (ТЗ clone-persona-method-layer ВАЛ.1) |
| `dashboard.theme_silence.enabled` | 🟢 ВКЛ | Детектор молчащих тем (`@Cron('theme-silence-detector')`): тема графа без активности ≥ N недель → создаётся `Insight` «тема замолчала» (порог — крутилка `dashboard.theme_silence_weeks`, default 3). Выкл → cron no-op, инсайты о замолчавших темах не создаются; на остальное не влияет. AdminSetting-ключ (kill-switch, code-default true), действий владельца НЕ требует. (ТЗ cabinet-redesign-rhythms Ф8.2/8.1) |

> **Планируется (Ф5, отложена):** `SUPPORT_CLONE_AUTOSEND_ENABLED` — авто-отправка ответа клиенту клоном без человека за гейтом calibrated-уверенности+groundedness. В Ф1–Ф4 НЕ выкатывается: нужен отдельный owner-go (раскрытие AI клиенту, Р-5) + калибровка на исходах. До выката человек шлёт ВСЕГДА. (ТЗ support-desk-clone-and-closed-contour Ф5)

---

## 💳 Тарифные (тип Т) — включаются по клиенту

| Флаг | Сейчас | Кто включает |
|---|---|---|
| `feature.chatbox` | ВЫКЛ (по компании) | Продажи/админ точечно по клиенту, который купил интеграцию переписок. Не процессная боль. |

---

## ⚫ Экспериментальные — намеренно выключены (не готовы)

Это не «забытые», а незрелые. По Ship-On: когда дозреют — выкатятся сразу включёнными. Сейчас трогать не нужно.

`MAIL_INBOX_ENABLED` (задачи из писем) · `CLONE_V2_ENABLED` · `SPECIALISTS_COMBINED_ENABLED` · `BITEMPORAL_ENABLED` / `BITEMPORAL_SUPERSEDE_ENABLED` (версионирование знаний во времени) · `PROMPT_EVOLUTION_ENABLED` (авто-эволюция промптов, GEPA).

---

## 🎚️ Крутилки-лимиты (admin-editable, работают с дефолтом)

Это не флаги вкл/выкл, а числовые/списочные параметры с рабочими дефолтами — выкатываются СРАЗУ работающими (Ship-On соблюдён). Владелец/super_admin может изменить из админки (раздел AdminSetting), но действий для выката НЕ требуется. Реестр требует строку на каждый параметр.

| Ключ | Дефолт | Что регулирует | Где |
|---|---|---|---|
| `documents.maxSizeMb` | 50 | Потолок размера одного загружаемого документа (МБ) | Ручная загрузка `/documents` (ТЗ-4 Ф6) |
| `documents.maxFilesPerUpload` | 20 | Максимум файлов в одной операции загрузки | Ручная загрузка `/documents` (ТЗ-4 Ф3/Ф6) |
| `documents.acceptedFormats` | `pdf,docx,xlsx,pptx,md,txt,html,rtf,odt,csv` | Белый список расширений, принимаемых при загрузке | Ручная загрузка `/documents` (ТЗ-4 Ф6) |
| `billing.meetingUploadsPerMonth` | 20 | Месячный лимит ручных загрузок встреч на компанию (≥ лимита → `UPLOAD_QUOTA_EXCEEDED`); отдельно от грантов `MeetingsBalance`. ENV-fallback `BILLING_MEETING_UPLOADS_PER_MONTH` | Ручная загрузка встреч `POST /meetings/upload` (ТЗ-5 Ф6) |
| `support.vendor_org_id` | _(пусто)_ | **Параметр владельца:** id вендор-Org, в которую приходят обращения клиентов и где живёт закрытый контур поддержки. Пока пусто — все support-seed'ы no-op, деск не работает. См. §«Требуют твоего решения» №4 | Служба поддержки (ТЗ support-desk-clone Ф1) |
| `support_critic_min_groundedness` | 0.6 | Минимальный groundedness-балл черновика клона (truthful/total). Ниже → исход `clarify`/`escalate` вместо «ответить» (R-INV-5) | Клон-черновик поддержки (ТЗ support-desk-clone Ф3) |
| `support_promote_min_csat` | 4 | Минимальный CSAT (1..5) для промоута принятого ответа клона в контур памяти (гейт качества против само-отравления, R-INV-2) | Петля обучения поддержки (ТЗ support-desk-clone Ф3) |
| `knowledge.chatV2SynthesisTimeoutMs` | 90000 | Таймаут синтеза ответа AI-чата (мс), отдельный от глобального `LLM_ROUTER_DISPATCH_TIMEOUT_MS` — чтобы длинный синтез chat-v2 (~28с) не обрывался. AdminSetting (super_admin), code-default 90с | AI-чат chat-v2 (ТЗ cabinet-leftovers §4 Ф3) |
| `tasks.cross_source_dedupe_threshold` | 0.85 | Порог cosine-сходства, при котором задача из переписки считается дублем задачи из встречи/трекера и не создаётся повторно. Ниже порога — новая задача. AdminSetting (super_admin) | Межисточниковый дедуп задач (ТЗ chatbox-memory-finishing Ф6) |
| `chatbox.match.name_fuzzy_enabled` | true | Включает нечёткое сопоставление сотрудника по имени (а не только по email) при матчинге участников переписки ChatBox с `Person`. AdminSetting (super_admin) | Матчинг участников ChatBox (ТЗ chatbox-memory-finishing Ф1) |
| `operations.daily_digest.webpush_morning_hour` | 9 | Час утреннего окна exec-push «Требует тебя сегодня: N» (`ExecMorningPushCron` шлёт раз в сутки в этом локальном часу). AdminSetting (super_admin), ENV-fallback `OPS_DIGEST_WEBPUSH_MORNING_HOUR` | Утренний exec web-push (Мобильная Кора Ф7) |
| `probe.digestTouchCap` | 5 | Максимум отложенных probe в одном дайджесте «Вопросы от Коры» (остальное копится до следующего прогона). AdminSetting (super_admin) | Батч-дайджест probe (probe Ф1) |
| `probe.digestHourUtc` | 9 | Час суток (UTC), в который `ProbeDigestCron` фактически отправляет дайджест отложенных probe (сам cron тикает ежечасно). AdminSetting (super_admin) | Батч-дайджест probe (probe Ф1) |
| `probe.topicCooldownHours` | 48 | Окно «тишины» по теме probe (ч): после отправки/игнора probe по теме повтор по той же теме дропается на этот срок (`probe:cooldown:*`). AdminSetting (super_admin) | Adaptive fatigue probe (probe Ф1) |
| `knowledge.reportBlockConfidenceCap` | 0.6 | Потолок уверенности блока графа, извлечённого из AI-отчёта встречи (вторичный источник `meeting_report`): `confidence` report-блока ограничивается сверху этим значением (ГАРД A) — отчёт виден в поиске, но ранжируется ниже дословного транскрипта. AdminSetting (super_admin), code-fallback `0.6` | Отчёт встречи → граф (ТЗ report-to-graph-phase2 Ф4) |
| `probe.immediatePushMinPriority` | 70 | Минимальный priority (0–100) probe для немедленного пуша; ниже — вопрос уходит в ежедневный батч-дайджест, а не отдельным сообщением. AdminSetting (super_admin) | Доставка probe (ТЗ autonomy W0) |
| `probe.minValuePriority` | 30 | Гейт ценности probe: вопрос с priority ниже порога не задаётся вовсе (статус `dropped_low_value`). AdminSetting (super_admin) | Гейт ценности probe (ТЗ autonomy W2) |
| `knowledge.curationConflictArbiterMinConfidence` | 0.7 | Минимальная средняя confidence голосов-победителей дебата для авто-резолва конфликта арбитром; ниже → конфликт остаётся человеку. AdminSetting (super_admin) | LLM-арбитр конфликтов (ТЗ autonomy W1) |
| `knowledge.curationConflictArbiterBatchSize` | 20 | Лимит open-конфликтов на Org за один ночной проход арбитра. AdminSetting (super_admin) | LLM-арбитр конфликтов (ТЗ autonomy W1) |
| `pendingActions.reminderWindowEndHour` / `reminderStepHours` | 9 / 12 | Каденция напоминаний «Ждёт подтверждения»: дефолты 9/9/12 дают единственный слот 09:00 — одна сводка в день вместо пяти; срочное приходит сразу отдельно. AdminSetting (super_admin) | Напоминания pending actions (ТЗ autonomy W0) |
| `knowledge.curationAuditSampleRate` | 0.01 | Доля авто/провизорных решений курации в аудит-выборку (было 0.05 — меньше аудит-шума при сохранении сигнала autotune). AdminSetting (super_admin) | Аудит курации (ТЗ autonomy W3) |
| `dashboard.theme_silence_weeks` | 3 | Сколько недель тема графа должна молчать, чтобы детектор `theme-silence-detector` создал `Insight` «тема замолчала». AdminSetting (super_admin), code-fallback `3`. Сам детектор гейтится kill-switch `dashboard.theme_silence.enabled` (выше) | Детектор молчащих тем (ТЗ cabinet-redesign-rhythms Ф8.2/8.1) |
| `pendingActions.conflictTtlDays` | 14 | Срок жизни (дней) `ConflictItem` в очереди решений «Требует вас»: по истечении sweep-крон проставляет `expiresAt` и убирает протухший конфликт из очереди. AdminSetting (super_admin), code-fallback | Очередь решений (ТЗ cabinet-redesign-rhythms Ф4) |
| `pendingActions.intakeTtlDays` | 14 | Срок жизни (дней) `IntakeIssue` в очереди решений «Требует вас»: по истечении sweep-крон проставляет `expiresAt` и убирает протухшую входящую задачу из очереди. AdminSetting (super_admin), code-fallback | Очередь решений (ТЗ cabinet-redesign-rhythms Ф4) |

---

---

## 🔑 НЕ флаг, но ждёт прод-ENV: VAPID-ключи push (Мобильная Кора)

Это **не флаг вкл/выкл**, а ENV-секреты web-push. Их **наличие = включённая отправка** push в Мобильной Коре; **отсутствие = push молча no-op** (без ошибки, фича просто не шлёт уведомления). Действие владельца требуется: сгенерировать пару VAPID и положить в прод-`.env`.

| Ключ | Где | Что без него |
|---|---|---|
| `VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` · `VAPID_SUBJECT` | backend `.env` | сервер не подписывает и не отправляет web-push (отправка no-op) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | frontend build-ENV | браузер не оформляет подписку (PushSubscription не создаётся) |

Пара генерируется одним прогоном (`npx web-push generate-vapid-keys`); публичный ключ дублируется в backend и frontend, `VAPID_SUBJECT` = `mailto:`-адрес. До их установки Мобильная Кора работает без push (Ф0+Ф1 не зависят от push). См. `docs/operations/prod-deploy-log.md` Шаг 1.

---

## Итог: что реально на тебе

1. 🟢 **Блокировка бюджета** — выбери поведение (блок/деградация/алерт) и лимит.
2. 🟢 **Разграничение доступа** — реши, нужно ли сейчас, и проверь матрицу.
3. ⚪ **Долг** — включить готовое (таблицы после теста · одна задача из встречи · умный помощник).

Всё остальное работает само либо включается продажами. Больше «склада забытых флагов» не копится — новое выкатывается сразу включённым (принцип Ship-On).

---

_Поддержка файла: каждый новый флаг при разработке → строка сюда (тип, состояние, если решение владельца — что ждём). Часть чек-листа завершения работы в CLAUDE.md._
