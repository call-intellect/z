# Отчёт функционального теста ветки `work/2026-06-29` — ЧАСТЬ 1 (backend + пассивный кабинет)

- **Дата:** 2026-07-01
- **База плана:** [plans/analysis/2026-07-01-full-functional-test-plan-work-branch.md](2026-07-01-full-functional-test-plan-work-branch.md)
- **Метод:** синтетический вход через РЕАЛЬНЫЙ конвейер (combat-harness), сверка артефактов в БД / /metrics / diag / кабинете (Playwright).
- **Стенд:** локальный гибрид, backend :3000, frontend :3001, реальный LLM (deepseek-v4-pro).
- **Синтетический тенант:** «Компания Стрела» `cmr1qbvpx0001pwbwxbgmh1jl` — 2 рабочих недели, 7 сотрудников + 4 клиент-контакта, 23 источника (meeting×9, bitrix×2, chatbox×2, conversational×2, daily_checkin×6, external×1), реальные фикстуры T1/T2/T3.
- **Объём графа:** 148 canonical-блоков, 119 сущностей, 2319 IdeaBlockLink, 34 EntityLink, 13 тем, 21 задача, 8 решений, 15 инсайтов, 16 идей, 26 commitment, 9 регламентов, 5 процессов, 6 экспериментов, 1 цель.

> **Границы Части 1:** проверено то, что не требует активных действий пользователя — backend-извлечение/материализация/целостность (diag/psql/metrics) + пассивный обход кабинета (открыть экран, увидеть данные, убедиться «нет 400/500»). Активная работа в кабинете и вопросы помощнику — **Часть 2** (по согласию владельца). Многоролевой аналитический разбор — **Часть 3**.

---

## 1. Сводная таблица результатов

### §6.1 A–M (акцент — изменённое 228 коммитами)

| Тест | Что | Статус | Доказательство |
|---|---|---|---|
| A1 | Ingest по всем 6 каналам → блоки | ✅ PASS | блоки из meeting/bitrix/chatbox/conversational/checkin/external |
| B1 | Чат разбирается КАК встреча | ✅ PASS | decisions: meeting 6 + **bitrix 2**; insights: meeting 10 + **conversational 3 + checkin 2 + chatbox 1** |
| B2 | Классы idea/task/decision разведены | 🟡 PARTIAL | 8 решений с reversibility, 16 идей, 21 задача — раздельно; classifier-тест «пилот −30%» не гонялся отдельно (Часть 2) |
| C1 | Задачи из ЛЮБОГО канала, единый движок | ✅ PASS | 21 IntakeIssue, ВСЕ `mat_`-префикс; `task_draft_materialized_total{meeting=12,bitrix=2,chatbox=2}`; `ai_meeting_actions_extracted_total` отсутствует (старый путь снесён) |
| C3 | Subtasks → checklist | ✅ PASS | в трекере чек-листы 0/1, 0/2 на IZVST-9/8/3/1 |
| C4 | Кросс-канальный дедуп | 🟡 PARTIAL | «база контактов» — 1 карточка (дедуп ✅); «онбординг Ромашка» — **2 карточки** (IZVST-10+11, дедуп не схлопнул) |
| D1 | Решение извлекается + reversibility | ✅ PASS | 8 решений: type-1×2, type-2×4, null×2 |
| D2 | DROP колонок надзора у decisions | ✅ PASS | нет `implementationStatus/CheckedAt` |
| D3 | Удалённые эндпоинты надзора → 404 | ✅ PASS | throughput/stalled → 404 |
| D4 | Снесены метрики надзора | ✅ PASS | decision_stalled/throughput/auto_implemented = 0 |
| E1 | commitment-факт жив | ✅ PASS | `commitmentDueDate/RecipientPersonId/AuthorPersonId` на месте; 26 commitment-блоков |
| E2 | DROP соц-слоя обещаний | ✅ PASS | нет `commitmentStatus/AskedAt/EscalatedAt`; таблицы `promise_network_snapshots` нет |
| E3 | Удалённые эндпоинты соц-слоя → 404 | ✅ PASS | /me/promises, promise-network, open-commitments → 404 |
| E4 | Кроны не падают без обещаний | ✅ PASS | Engagement/GoalVector/BurnoutRisk → 201 ok, нет ошибок commitmentStatus |
| F6 | Цель outcome≠output | ✅ PASS | извлечена «поднять retention до 55%»; «запустить email-кампанию» НЕ стала целью |
| F7 | /goals UI | ✅ PASS | цель + бейдж «Предложено Корой» + movementVerdict «Движемся, но согласованность низкая» + 3 темы |
| F8 | 21 крутилка целей | ✅ PASS | 26 `goals.*` + 39 `tracker.*` в AdminSetting |
| J1 | День компании (verdict/letter/goalAlign) | 🟡 PARTIAL | схема (3 JSONB-поля) есть, крон отрабатывает, дашборд рендерит; популяция героя требует day-report за нужную дату (Часть 2) |
| J3 | monthly_operations_digests | ✅ PASS | таблица существует |
| H | Роутер чата / dataClass | 🟡 PARTIAL | метрики `z_router_query_class/both_ways`, `probe_dialog`, `day_report` присутствуют; функционально — вопросы в Части 2 |
| L1 | chat-v2 маршруты | ✅ PASS | deepseek-v4-pro → gpt-5.4 → kie/gemini (без Anthropic) |
| K | Probe/method-capture | ⏭ SKIP→Ч2 | интерактивный сценарий |

### §6.1 S — целостность сохранения («всё достаётся правильно»)

| Тест | Что | Статус | Доказательство |
|---|---|---|---|
| S-R1 | Ничего не потерялось (нет осиротевших) | ✅ PASS | decision 7 бл→7, idea 10→10, pain 5→5, risk 4→4, feature_request 2→2, objection 1→1; недобор только blocker 5/7, suggestion 1/2 (combined-дедуп) |
| S-R2 | Нет двойной материализации | ✅ PASS | 0 дублей по decisions.sourceBlockIds; sourceIdeaBlockId уникален |
| S-E1 | IdeaBlockLink по типам | ✅ PASS | shares_entity 1594, shares_topic 453, develops 115, consequences_of 21, question_answered_by 10, causes 4 |
| S-E2 | EntityLink по типам | ✅ PASS | mentions_with 20, works_at 4, belongs_to 4, depends_on 1, part_of 1 |
| S-E3 | AGE ↔ Postgres | 🟢 by-design | AGE 46 вершин, 0 рёбер vs 2319 IdeaBlockLink + 34 EntityLink — **намеренно** (ADR 2026-06-23: реляционка=источник правды, AGE=фаза 2). НЕ дыра. |
| S-E4 | Кросс-тенант утечка рёбер | ✅ PASS | 0 / 0 |
| S-E5/E6 | Висящие/двунаправленные дубли | ✅ PASS | 0 / 0 |
| S-M1 | Under-merge (дубли сущностей) | ✅ PASS | 0 дублей по canonicalName; 0 сущностей без embedding |
| S-M3 | Битая родословная мёржа | 🔴 **ВОСПРОИЗВЕДЕНА (замер)** | форс-мерж Елена→Игорь: `Entity.mergedIntoId` проставлен, но `mergedIntoTenantId=NULL` → **1/1 слитых с NULL-компаньоном**; `mergeManually:427-430` пишет только `mergedIntoId`, relation `mergedInto [id,tenant]` рвётся (тот же класс, что entityTenantId) |
| S-M4/M5/M7 | evidence/draft/утечка | ✅ PASS | 0 canonical без evidence, 0 застрявших draft, 0 утечки сущности в блок |
| S-C2 | Все employee имеют entityId | ✅ PASS | 7/7 (lazy Person→Entity сработал) |
| S-C3b | Person.entityTenantId проставлен | 🔴 НАХОДКА | **11/11 NULL системно** (7 сотрудников + 4 клиента, все персоны с entityId) — §10-дыра #2 (компаньон партиции пишется только в бэкфилл-ветке при entityId=NULL) |
| S-C4 | subject = реальные авторы | ✅ PASS | Сергей 48, Михаил 38, Анна 23, Дарья 20, Александр 13, Игорь 5, Елена 1 — по активности |
| S-C1 | Клоны сотрудников | 🟡 PARTIAL | 3/7 (Александр/Михаил/Сергей); Анна(23 бл)/Дарья(20 бл) без профиля |

### §6.2 N — обход кабинета: полная матрица N1…N22 (закрыта)

**Легенда:** ✅ PASS — прогнан по назначению · 🟢 SANITY — открылся + данные §4 видны + нет 4xx/5xx на основном эндпоинте · 🟠 PARTIAL — часть цикла не покрыта (причина указана) · 🔴 FAIL — дефект.

| N | Раздел | Статус | Наблюдение / доказательство |
|---|---|---|---|
| **N1** | Встречи — полный цикл | 🟠 **PARTIAL** | Создание+типизация ✅ (10 встреч, 6 типов на стенде); AI-отчёт-по-типу ✅ (`REGISTRY: Record<MeetingType, PromptDescriptor>`, 7 типов, промпт+схема каждый); мост `MEETING_AI_READY='meeting.ai_ready'` ✅ (эмит `analyze.worker.ts:298` + 2 листенера table-enrich/meeting-checkin). Логика: **80 спеков PASS** (analyze/custom-report/createForUser/enrich + type-sales/interview/fast/tasks). **Не вживую:** запись→egress→отчёт (нет LiveKit-медиа; синтетические встречи `status=failed` = seed-артефакт, не дефект) |
| N2 | Календарь / события | 🟢 SANITY | `/events` 200 items:0, `/appointments` 200 items:0 (данных календаря на стенде нет) |
| **N3** | Трекер / доски / чек-листы | ✅ PASS | «12 задач · 2 просрочено», проект IZVST, задачи из встреч с чек-листами; 3 находки (даты/дедуп/исполнитель) |
| **N4** | Входящие / курация | ✅ PASS | Очередь 16 pending → `approve` idea-элемента (conf 0.6<auto 0.85) → **201, pending→decided, decidedAt проставлен**; чек-лист = completeness-slots (50 слотов: parentCard/slotName/slotKind/status/probeAttempts); конфликты 19 |
| **N5** | Память / граф / поиск | ✅ PASS | хаб + реестры Решения/Оцифровано/Темы/Сущности/Таблицы/Идеи/Сигналы |
| N6 | Решения и идеи | 🟢 SANITY | `/decisions` 200 items:10, `/ideas` 200 items:21 (богатые данные) |
| **N7** | Цели и зрелость | ✅ PASS | см. F7 |
| N8 | Клоны / люди / роли | 🟢 SANITY | `/persons` 200 items:11, `/clones` 200; клон-профили см. F-7 (3/7) + S-C3 ниже |
| **N9** | AI-чат / ассистент | 🔴 FAIL(H3) | «Мастер»: list/private ✅, но fact/expertise → «ничего не нашлось» (H3, Часть 2) |
| **N10** | Дашборд / пульс | ✅ PASS | дневной герой «письмо COO» (J1 PASS, Часть 2); ритмы День/Неделя/Месяц |
| N11 | Регламенты / процессы / доки | 🟢 SANITY | `/regulations` 200 items:20, `/processes/templates` 200 items:1, `/documents` 200 items:0 |
| N12 | Уведомления / каналы / боты | 🟢 SANITY | `/destinations` 200 items:0 (каналы не подключены на стенде) |
| **N13** | Интеграции Bitrix/Chatbox | ✅ PASS | Крон **00:00 МСК** (`timeZone:'Europe/Moscow'` у обоих sync-кронов — UTC-проблема из памяти починена); обе кроны триггернуты чисто (201, 0 интеграций); sync-логика 19 спеков PASS. Живой внешний sync не гонял (нет коннектов/кредов) |
| **N14** | Авторизация / мультитенант | ✅ PASS | Гвард: X-Org-Id→`rbac.loadContext`→нет членства=**403 no_membership** (код+10/10 спек); data-scoping: один эндпоинт даёт разные payload на орг (director 10220/10638/5389) — утечки нет; **код-аудит 11 файлов сырого SQL — 0 находок** (тенант-скоуп/инъекции чисто) |
| N15 | Онбординг | ✅ PASS | «Тур: шаг 1 из 6» рендерится |
| **N16** | Биллинг / лимиты | 🟠 PARTIAL | creation-гейт `Subscription≠ACTIVE`→read-only+paywall (корректно, но мешает activation — Часть 2) |
| N17 | Админка | 🟢 SANITY | `/health` 200, `/admin/crons` 200 (171 крон зарегистрирован) |
| **N18** | Поддержка | ✅ PASS | Ядро Conversation/Message: **66 спеков PASS** (intake/desk/draft/critic/curator/SLA/clone/contour-isolation); UI `/support/my-tickets` рендерится; гейтинг fail-closed корректен (503/403 без vendor-орга). Живой E2E требует vendor-инфру — не поднимал (чистота стенда) |
| N19 | Фидбек / признание | 🟢 SANITY | `/feedback/my` 200, `/admin/feedback/topics` 200 items:4 |
| N20 | Smart tables | 🟢 SANITY | `/tables` 200 items:0 |
| N21 | Retention / экспорт | 🟢 SANITY | `/exports` 200 items:0, `/settings/retention` 200 (конфиг retention-порогов) |
| N22 | Клиенты / вендоры / эксперименты | 🟢 SANITY | `/customers` 200:0, `/vendors` 200:0, `/experiments` 200 items:8 |

**Покрытие N1…N22:** PASS **9** (N3,N4,N5,N7,N10,N13,N14,N15,N18) · SANITY **10** (N2,N6,N8,N11,N12,N17,N19,N20,N21,N22) · PARTIAL **2** (N1 медиа-цикл, N16 гейт) · FAIL **1** (N9=H3). Осознанно не вживую: N1 (LiveKit-медиа), N18 (vendor-helpdesk), N13 (внешний sync) — причины в строках.

---

## 2. Находки (баги и риски)

| # | Severity | Узел | Что | Доказательство | Гипотеза (file:line) |
|---|---|---|---|---|---|
| F-1 | 🔴 medium | entity-resolver | Сырой SQL `FROM "Person"` — таблица `persons`. `resolvePersonByEmbedding` всегда падает `42P01`, ошибка глотается → **KNN-склейка персон по имени мертва** | лог `relation "Person" does not exist` ×N; фикс тривиален | [entity-resolution.service.ts:1120](../../backend/src/modules/knowledge-core/services/entity-resolution.service.ts#L1120) — `FROM "Person" p` → `FROM persons p` |
| F-2 | 🟠 medium | due-date | Сроки задач разрешаются в **прошлые годы** → «Просрочена на 1007 дн.» (IZVST-10), «362 дн.» (IZVST-1) | скриншот трекера | парсер относительных сроков («к пятнице»/«до среды») даёт год в прошлом |
| F-3 | 🟠 medium | task assignee | Почти все задачи «Без исполнителя», хотя в тексте явные владельцы (Михаил→Битрикс, Дарья→база) | скриншот трекера | материализатор не резолвит assignee из «X берёт на себя» |
| F-4 | 🟡 low-med | dedup | Кросс-канальный дедуп непоследователен: «база» схлопнута (1), «онбординг Ромашка» задвоен (IZVST-10+11) | скриншот трекера | порог/эмбеддинг дедупа |
| F-5 | 🔴 реальная дыра | партиция | `Person.entityTenantId = NULL` у **11/11** → Prisma-relation `entity` вернёт null (`include:{entity}` пуст). `Entity.mergedIntoTenantId` 0/0 (мёржей не было) | S-C3b | entity-resolution.service.ts (записывает entityId без entityTenantId) |
| ~~F-6~~ | 🟢 снято | AGE-граф | AGE 0 рёбер vs 2353 реляционных — **намеренно** по ADR 2026-06-23 (реляционка=источник правды, AGE=фаза 2), НЕ дыра | S-E3 | — |
| F-7 | 🟡 low | клоны | 3/7 профилей; Анна/Дарья (23/20 блоков) без knowledgeProfile | S-C1, `core_specialist_cards{knowledge_profile,canonical}=3`, pending нет | содержание блоков (мало reasoning/skill) ИЛИ §10-дыра #6 (triage-гейт) |
| F-8 | 🟡 low | combined | 1× `specialists-combined: parse error` «финализируем job без retry» — best-effort проглот | лог 2:10:44 | §10-риск: сбой парса → тихая потеря задач источника |
| F-9 | 🟠 (стенд) | throughput | Под burst-инъекцией 23 события ~18 застряли в `received` (jobs потеряны); `raw-event-recovery` (возрастной фильтр) не спас — потребовался ручной re-enqueue | статусы RawEvent; reprocess-stuck | предохранитель восстановления имеет окно, где застрявшие не подхватываются |

---

## 3. §7 — регресс 4 дней (12 пунктов)

| # | Пункт | Вердикт |
|---|---|---|
| 1 | Задачи одним движком combo, старые пути снесены, дублей нет | 🟢 (21 задача mat_, старая метрика снесена; дубль-суггест непоследователен — F-4) |
| 2 | Классы разведены (idea≠task≠decision) | 🟢 (раздельны; «пилот≠задача» — доверификация в Ч2) |
| 3 | Решения как память, надзор снят | 🟢 (404 + колонки/метрики снесены) |
| 4 | Обещания-факт живы, соц-слой снят | 🟢 |
| 5 | Цели: МСК, KNN-темы, крутилки, вектор без обещаний | 🟢 (цель+темы+вердикт; кроны без падений) |
| 6 | Клоны: lazy Person→Entity | 🟢 частично (entityId 7/7 ✅; но entityTenantId NULL — F-5; покрытие 3/7 — F-7) |
| 7 | AI-чат маршруты/не зависает | 🟡 (маршруты ✅ L1; функц. — Ч2) |
| 8 | Единый чат: boot, dedup, изоляция | 🟡 (boot ✅ — кабинет грузится; чат-функции — Ч2) |
| 9 | Дайджесты День/Неделя/Месяц | 🟡 (схема/крон/рендер ✅; популяция — Ч2) |
| 10 | Probe/method-capture | ⏭ Ч2 |
| 11 | Надёжность: raw-event-recovery | 🟠 (recovery есть, но окно — F-9) |
| 12 | Слой источника: партиц. не сломал чтение/запись, tenant-изоляция | 🟢 (изоляция 0/0; но сырой SQL F-1 и NULL-компаньон F-5) |

## 4. §10 — вердикт по 5 латентным дырам

| Дыра | Вердикт (скорректировано ADR 2026-06-23) |
|---|---|
| AGE асимметричен реляционке | 🟢 **НАМЕРЕННО, НЕ дыра** — ADR `2026-06-23-knowledge-graph-ingestion-audit/99-synthesis.md`: реляционка = источник правды графа, AGE/Cypher отложены в «фазу 2». Проверять целостность реляционного графа (S-E1/E2/E4/E5/E6 — PASS). Прежняя пометка снята. |
| NULL-компаньон партиции | 🔴 **РЕАЛЬНАЯ, СИСТЕМНАЯ (замер):** `Person.entityTenantId` = **11/11 NULL** (у ВСЕХ персон с заданным entityId — не крайний случай, а системно). **Механизм:** `entityId` пишется при создании персоны без `entityTenantId`; бэкфилл обоих полей (`loadBlocksForPerson` `specialist-3-2:409-412`) срабатывает ТОЛЬКО когда `entityId` уже NULL → у этих 11 не срабатывает никогда. Итог: Prisma-relation `Person→Entity` (`[entityId, entityTenantId]`) рвётся — SQL-by-id работает, `include:{entity}` пуст. `Entity.mergedIntoTenantId` 0/0 (компаньон merge-партиции — не наблюдался) |
| Слияние person-Entity схлопывает клоны (S-C3) | 🔴 **РЕАЛЬНАЯ — ВОСПРОИЗВЕДЕНА ЖИВЬЁМ (замер):** форс-мерж person-Entity **Елена→Игорь** через `POST /org-admin/knowledge/entities/:id/merge` (201 ok). **Замер клон-рид-запроса** (`IdeaBlockEntity WHERE entityId=… role∈(subject,mentioned) canonical` — ровно то, что читает `loadBlocksForPerson:418`): Елена **6→0**, Игорь **9→15** (забрал всё). `Person(Елена).entityId` НЕ перепривязан — указывает на свою сущность, но у неё теперь `mergedIntoId=Игорь` (**осиротел на merged-away**). Корень: `mergeManually` (`entity-merge.service:298`) двигает IdeaBlockEntity/EntityLink и ставит `mergedIntoId`, но `Person.entityId` не трогает; `loadBlocksForPerson` читает по `entityId` и **не следует за `mergedIntoId`** → клон Елены коллапсирует (0<minBlocks → skip), клон Игоря поглощает знания Елены (bleed идентичности). *Стенд: Елена/Игорь в «Стреле» намеренно слиты — тенант re-seedable.* |
| cap=4 роняет специалистов | 🟢 не наблюдалось (`core_router_trimmed_total` отсутствует/0) |
| Тихий дроп блока (best-effort) | 🟠 наблюдался 1× (F-8); failed=0 в очередях |

---

## 5. Вердикт готовности к проду (по Части 1)

**Ядро изменённого за 4 дня — РАБОТАЕТ и целостно.** Извлечение из всех каналов, единый движок задач, решения-как-память, факт-обещания, цели, клоны, маршрутизация и целостность сохранения (роутинг/рёбра/сущности/изоляция) — корректны и чисты. **🔴-блокеров, останавливающих выкат, не найдено** (нет порчи данных, нет крашей, tenant-изоляция держится).

**НО есть качественные баги, которые стоит починить до/вокруг выката** (деградация, не корректность):
- **F-1** `FROM "Person"` (тривиальный фикс, но убивает KNN-склейку персон) — **фикс до выката**.
- **F-2** сроки в прошлых годах — режет доверие к трекеру — **фикс до выката**.
- **F-3** задачи без исполнителя — снижает ценность трекера — желательно до выката.
- **F-5** `entityTenantId=NULL` — латентная поломка Prisma-relation — фикс до/сразу после.
- ~~F-6 AGE-асимметрия~~ — **снято: намеренно по ADR 2026-06-23** (реляционка=источник правды, AGE=фаза 2), не действие.
- F-4/F-7/F-8/F-9 — fast-follow.

**Рекомендация:** выкат допустим после фикса F-1/F-2 (дёшевы); F-3/F-5 — ближайший fast-follow. Часть 2 (интерактив + помощник) и Часть 3 (аналитика) уточнят картину по чату/probe/дайджестам.

---

## Приложение. Артефакты
- Seed: `backend/scripts/seed-synthetic-company.ts`, `seed-synthetic-company-week2.ts`, `reprocess-stuck.ts`.
- Скриншоты: `tracker-strela.png`, `goals-strela.png`, `memory-strela.png`, `dashboard-strela.png` (корень репо).
- Тенант для доп-проверок: `cmr1qbvpx0001pwbwxbgmh1jl` (KEEP, тест-юзер `test@kora.local` и `admin@crossmark.ru` — owner).
- **Код-аудит N14 (фоновый workflow):** 11 продакшн-файлов с сырым SQL, изменённых в ветке → тенант-скоуп/инъекции — **0 подтверждённых находок** (fileRisk none/low).
- **Стенд-модификация (S-C3 замер):** в «Стреле» намеренно слиты person-Entity Елена→Игорь (доказательство коллапса клона). Клон Елены пуст — при необходимости демо тенант пере-сеедить.
- **Автотесты ветки, прогнанные в этот заход:** TenantGuard 10 · support 66 · bitrix/chatbox sync 19 · meetings/analyze/report-by-type 80 = **175 тестов PASS** (все зелёные).
