# Round-2 CPO: продукт Z, дифференциация, дорожная карта на 24 мес

> Автор: виртуальный CPO команды CEO Z.
> Дата: 2026-05-20.
> Контекст: round-1 marketing-digest + product-reality + plans-digest + market-web; второй мозг компании черновик; gap-анализ онтологии; knowledge-core реализация.
> Цель: описать продукт, который мы реально строим (а не маркетинговый идеал), его roadmap к 700 млн ₽/мес ARR за 24 мес, и дифференциаторы, которых нет у конкурентов.
> Метод: на каждый ключевой вопрос — 2–3 варианта, выбор, обоснование.

---

## Вопрос 1. ПРОДУКТ — что мы продаём (1 предложение)

### Вариант А — «AI-встречи с типами»
> «Z — российский AI-сервис видеовстреч, который понимает тип встречи (продажи, planning, custdev, интервью) и сразу выдаёт готовый рабочий артефакт под этот тип: протокол с задачами, отчёт по сделке, бриф, custdev-выводы.»

Плюсы: совпадает с тем, что реально работает сегодня (9 типов, 4-стадийный pipeline, отдельные дорожки). Понятно покупателю «как Granola, но с типами и под закон». Короткий sales cycle.
Минусы: AI-встречи стали commodity. Конкурируем с mymeet, Контур.Толк, МТС Линк, Я.Телемост — у всех уже есть AI-саммари. Потолок ARR ~150–250 млн ₽/мес, не 700.

### Вариант B — «Company Brain поверх встреч»
> «Z — второй мозг компании: ваши встречи, переписки и документы становятся живым графом знаний, из которого AI вытаскивает темы, решения, риски и цели — и отвечает любому сотруднику от лица компании.»

Плюсы: вкатывает в категорию мирового тренда (Sentra, Viven, Hyper, Interloom — $59M+ за 9 мес). В РФ категория пуста, ноль конкурентов. Совпадает с тем, куда уже строится Knowledge Core (Фазы 0–12). Потолок ARR — весь UC-рынок РФ (137 млрд ₽/год к 2026), реалистично 700 млн ₽/мес.
Минусы: непонятно покупателю без демо. Long sales cycle. Требует Knowledge Core Фазы 5–12 в коде (плюс адаптеры).

### Вариант C — «Anti-knowledge-loss платформа»
> «Z сохраняет знания компании от текучки и фрагментации: каждое решение, обсуждение и контакт остаётся в едином графе, который переживает уход сотрудника и интегрируется с любым AI-агентом.»

Плюсы: бьёт прямо в цифры боли (18–25% ротация, 5,3 ч/нед поиск, 13 FTE на 100 чел). Чёткий ROI-нарратив для CFO/HR. Закладывает Employee Clone как естественное продолжение.
Минусы: слишком абстрактно без анкерного продукта. Сложно отделить от MS Loop, TEAMLY, Naumen KMS. Не объясняет, зачем для этого нужен ВКС.

### Выбор: **B (Company Brain поверх встреч), якорная фраза — «AI-встречи, которые превращаются в живой мозг компании»**

**Почему:**
1. Это единственная позиция, при которой 700 млн ₽/мес достижимо. В нише «ещё одна AI-ВКС» — потолок ниже.
2. Маркетинговый дайджест показывает: в РФ в категории Company Brain — 0 игроков, у Сбера будет product через 12–18 мес. Окно ровно столько и есть.
3. Это совпадает с фактической инвестицией в продукт. Уже сделаны: RawEvent → IdeaBlock → Entity → Theme + граф связей + Card rollup. То есть Knowledge Core — это **70% работы**, а не «вторая фаза после ВКС». Не использовать его в позиционировании — преступление против sunk cost.
4. Встречи остаются якорным use case (low time-to-value, понятный bottom of funnel), но не позиционным потолком.
5. Из A → B можно безболезненно мигрировать; обратно нельзя (теряем нарратив).

**Sales pitch в одном предложении (для маркетинга):** «Z — AI-видеовстречи, которые сами собирают мозг компании: помнят, кто что решал, чем кто занят, куда идём — и говорят за вас, когда сотрудник в отпуске или ушёл.»

---

## Вопрос 2. ARCHITECTURE OF VALUE — продуктовые пласты

Z — это **5 пластов**, каждый — отдельная sellable ценность, но связанные в один граф. Это критически важно: каждый пласт можно продавать отдельно (PLG entry), но retention растёт с каждым добавленным пластом (типичный «расширение через лестницу ценности»).

### Пласт 1 — AI-встречи с типизированными отчётами (СЕГОДНЯ, в проде)
- 9 типов встреч (team, standup, sales, custdev, plan_fact, project, partner, interview, customer_success).
- Per-track audio + GigaAM ASR (диаризация ≥90%, против 70–80% у конкурентов).
- Шаблоны AI-отчёта по типу (LLM, JSON Schema strict, prompt-registry, admin-editable).
- Self-hosted LiveKit, токены только с backend, гость без секретов.
- **Цена**: 1500–2500 ₽/user/мес.

### Пласт 2 — Knowledge Core: блоки, сущности, темы, граф (СЕГОДНЯ, Фазы 0–4 в проде)
- RawEvent → IdeaBlock (14 signalType) → Entity (7 типов) → Theme (KNN+LLM).
- IdeaBlockLink (7 типов), EntityLink (6 типов).
- Гибридный поиск (pgvector cosine 0.7 + BM25 0.3).
- CRM-карточки + Card rollup-v2.
- **Цена**: входит в pro.

### Пласт 3 — Дашборд директора + цели + alignment (В РАЗРАБОТКЕ, Фазы 7–9)
- Z-Admin (для нас): экономика, A/B, прайс-карта.
- Org-Admin (для клиента): отладка ядра, retention, sensors.
- Дашборд директора (5–6 виджетов: новые темы, горячие сигналы pain/churn/feature_request, активные темы, открытые вопросы, alignment-score целей).
- Goal × Theme alignment (cron, 0–100 score).
- **Цена**: pro + 1000 ₽/user/мес.

### Пласт 4 — Многоисточниковая память (НЕ НАЧАТО, Фаза 10)
- Адаптеры: Bitrix24, amoCRM, Я.Почта, Telegram, Я.Диск, 1С, GitHub, Jira.
- CDC через Debezium (для БД), webhooks (для CRM), polling+IMAP/IDLE (для почты).
- Все источники текут в Event Log → RawEvent → знакомый pipeline.
- **Цена**: enterprise tier + per-source 500–1500 ₽/мес.

### Пласт 5 — AI-агенты на памяти компании (НЕ НАЧАТО, Фаза 12)
- **Employee Clone**: stylistic profile + personal subgraph + voice (опц.) + ABAC.
- **Process Narrator**: восстанавливает narrative проекта/процесса за период.
- **Decision Archaeologist**: «как мы пришли к решению X».
- **Compliance Agent**: «кто, когда, что делал с данными клиента Y».
- **Цена**: enterprise + per-agent 3000–8000 ₽/мес.

### Как пласты соединяются в одно ценностное предложение

Каждое следующее повышает retention предыдущего:
- Встречи (П1) генерируют сырьё → Knowledge Core (П2) его структурирует.
- Граф знаний (П2) даёт основу для аналитики (П3) и для агентов (П5).
- Внешние источники (П4) делают граф полным — без них «мозг» наполовину пустой.
- Агенты (П5) — единственный пласт, который оправдывает enterprise чек 50К+/мес, потому что заменяет реальные FTE-функции.

**Метафора**: П1 — рот (вход), П2 — кора, П3 — приборная панель, П4 — органы чувств, П5 — голос. Только все вместе — это «мозг».

**Sequence ценности**: клиент покупает П1 (мгновенная ценность за 5 минут), на 3-й месяц включается П2/П3 (видит дашборд), на 6-й — П4 (подключает CRM/почту), на 12-й — П5 (запускает первого агента). Это идеальная LTV-кривая для целевых 12 мес LTV.

---

## Вопрос 3. ДИФФЕРЕНЦИАЦИЯ

Memory стало commodity. У Granola, Otter, mymeet, Контур.Толк, МТС Линк, Я.Телемост, SaluteJazz — у всех есть транскрипт+саммари. То, чего нет ни у кого:

### 5 уникальных дифференциаторов Z

1. **9 типов встреч × специализированных шаблонов отчётов** — никто из топ-10 РФ/INT не делает встречу-типированный отчёт. У всех «универсальное саммари». Это даёт **в 3–4 раза выше воспринимаемую ценность** в первой сессии и резко снижает churn.

2. **Per-track audio + диаризация ≥90%** — у конкурентов смешанное аудио на одной дорожке, диаризация 70–80%. У нас отдельные дорожки на каждого участника → ASR работает чисто, спикер известен из participant_id, не из голосового профиля. Это **тех. ров**, который трудно скопировать без переписывания SFU.

3. **Event-sourced Company Brain** — Event Log как single source of truth, все хранилища — проекции. Это **стратегический ров**: при изменении онтологии, при добавлении нового AI-агента, при ребрендинге pipeline — всё пересобирается из лога, без миграций. Никто из конкурентов так не построен (mymeet и Контур.Толк — это monolith с saммари; Sentra/Viven строят, но в РФ их нет).

4. **152-ФЗ + Реестр Минцифры + ФСТЭК комплаенс по дизайну** — retention 7 лет per-Org, right to erase, AES-256-GCM, audit log, SuperAdminAccessLog. Закрывает B2G и крупный корпорат, где зарубежные продукты юридически некупаемы (оборотные штрафы 1–3% выручки с 30.05.2025).

5. **Self-host без потери AI** — стек, который полностью работает в контуре клиента: LiveKit + MinIO + GigaAM (open-source SOTA для русского ASR, бесплатный) + локальные LLM (T-Pro 32B Apache 2.0) + опциональные облачные модели через прокси. У Granola/Otter этого нет в принципе. У Сбера on-prem есть, но без типизированных отчётов и без Knowledge Core.

### 3 варианта приоритизации дифференциаторов

**(А) Ставка на типы встреч × шаблоны**
- Фокус: расширить 9 типов до 18, отполировать промпты под каждый тип, сделать редактор шаблонов в Org-Admin.
- Ров: средний (промпты копируемы). Time-to-prove: 2–3 мес.
- Целевой клиент: МСБ продаж/консалтинг.
- Потолок: ~200 млн ₽/мес ARR.

**(Б) Ставка на per-track audio + диаризация 90%+**
- Фокус: сертификация качества ASR (показательные A/B), маркетинг «у конкурентов теряется 30% содержания, у нас 5%».
- Ров: высокий технически, но узкий продуктово. Time-to-prove: 4–6 мес (нужны бенчмарки).
- Целевой клиент: enterprise legal/HR/M&A (где цена ошибки = крупный иск).
- Потолок: ~300 млн ₽/мес ARR.

**(В) Ставка на event-sourced Company Brain**
- Фокус: Knowledge Core Фазы 5–12 + Employee Clone + интеграции.
- Ров: стратегический (2–3 года не догнать), product-line широта.
- Time-to-prove: 12–18 мес (full vertical proof).
- Целевой клиент: enterprise + B2G + средний бизнес с >50 чел и текучкой.
- Потолок: 700+ млн ₽/мес ARR. Это **единственный путь к цели**.

### Выбор: **(В) основной + (А) тактический + (Б) аргумент в продаже**

- (В) — стратегический ров, без него до 700М не дотянуть.
- (А) — тактическая дифференциация, которая работает на entry-этапе (первая демонстрация: «у вас раньше получал слитный текст, теперь получаете протокол с задачами»). Расширять с 9 до 14–16 типов под верткали (см. Вопрос 5).
- (Б) — это **первая строка в технической документации и тендерной заявке**. Не основной нарратив, но аргумент, который закрывает «почему именно вы».

**Анти-стратегии (что мы НЕ делаем):**
- НЕ соревнуемся в чистом UC (с IVA/VK/МТС). Z не «ещё одна ВКС», Z — «ВКС + Company Brain».
- НЕ строим «memory как general-purpose substrate» (как Hyper, Sentra). Это длинная игра без понятной монетизации на 2 года.
- НЕ делаем мониторинг сотрудников (рынок убыточен: Culture Amp $227M ARR при -$37M убытка).

---

## Вопрос 4. ROADMAP — приоритет фаз

Knowledge Core Фазы 5–12 + 4 AI-агента + 8 интеграций — слишком много за 24 мес. Нужен жёсткий порядок.

Допущение: ~12 FTE (3 FE, 4 BE, 2 AI, 1 DevOps, 1 QA, 1 PM). Нагруженная ставка ~800 тыс. ₽/FTE-мес. 24 мес R&D ≈ 150 млн ₽ (120 ФОТ + 30 инфра).

| Фаза | Ценность клиенту | ETA | Зависимости | Себест. |
|---|---|---|---|---|
| Decision class + valid_from/to | Knowledge loss закрыт, Clone разблокирован | 2 нед | — | ~1 млн ₽ |
| Stylistic profile | Клон отвечает в стиле человека | 3 нед | Decision | ~1,2 млн ₽ |
| Ф5 Card + rollup UI | CRM-карточки в UI | 4 нед | бэк готов | ~3 млн ₽ |
| Ф6 Chat-v2 UI | Org-чат поверх Theme с RAG | 6 нед | Ф5 | ~6 млн ₽ |
| Ф7 Z-Admin + Org-Admin | Видимость cost, отладка | 6 нед | — | ~6 млн ₽ |
| Ф8 Дашборд директора | Pulse за 30 сек | 5 нед | Ф6 | ~5 млн ₽ |
| Ф9 Goal × alignment | Стратегический контроль 0–100 | 4 нед | Ф8 | ~2,5 млн ₽ |
| Ф10a Bitrix24 + amoCRM | Память из CRM | 8 нед | — | ~5 млн ₽ |
| Ф10b Telegram + Я.Почта | Память из чатов/почты | 6 нед | Ф10a | ~3,5 млн ₽ |
| Ф10c Я.Диск + 1С + Confluence | Документы, кадры, wiki | 8 нед | Ф10a | ~3 млн ₽ |
| Ф11 Масштаб (RLS, GraphQL) | Перформанс на 50К+ блоков | 6 нед | Ф10 | ~3,5 млн ₽ |
| Ф12a Employee Clone MVP | Спрашиваем уволенного | 8 нед | Decision+Stylistic+Ф10 | ~8 млн ₽ |
| Ф12b Process Narrator | Narrative проекта | 4 нед | Ф12a | ~1,6 млн ₽ |
| Ф12c Decision Archaeologist | «Почему выбрали X» | 3 нед | Decision | ~1,2 млн ₽ |
| Ф12d Compliance Agent | Forensic для DPO | 3 нед | audit | ~0,6 млн ₽ |
| On-prem пакет | Развёртывание в контуре клиента | 6 нед | Ф11 | ~2,5 млн ₽ |

### 3 версии последовательности

- **Версия 1 «Pulse First»**: Ф5→Ф6→Ф7→Ф8→Ф9→Decision/Stylistic→Ф10a→Ф10b→Ф11→Ф10c→Ф12a→Ф12b→Ф12c→Ф12d→On-prem. Закрываем frontend Фаз 5–9 первым, есть демо на 6-й мес. Потом интеграции, потом клон.
- **Версия 2 «Brain First»**: Decision/Stylistic→Ф10a→Ф10b→Ф7→Ф5→Ф6→Ф8→Ф9→Ф10c→Ф11→Ф12a→Ф12c→Ф12b→Ф12d→On-prem. Наполняем граф (интеграции) первым. Риск: 4–5 мес без видимой клиенту ценности.
- **Версия 3 «Vertical Wedge»**: Ф5(min)→Decision/Stylistic→Ф7→Ф10a(Bitrix+amo, sales)→Ф8/Ф9(sales-дашборды)→Ф6→Ф10b→Ф11→Ф12c(sales deal reconstruction)→Ф12a→Ф10c→On-prem→Ф12b→Ф12d. Фокус на sales-вертикали первой, расширяемся потом.

### Выбор: **Версия 3 (Vertical Wedge) — sales-vertical first**

**Почему:**
1. Маркетинговый дайджест указывает sales как ICP-A (главный сегмент). Bitrix24+amoCRM = 70% SMB-рынка CRM РФ — гигантский TAM.
2. Sales — самый понятный ROI: «сделка пропала, потому что не нашли upsell» = деньги. Это даёт **самые короткие sales cycles** и самые высокие deals на старте.
3. Decision Archaeologist в sales-вертикали = «почему сделка X выиграна/проиграна» — это убийственная демонстрация в продажах для CRO.
4. Vertical wedge даёт **6× более высокий conversion** (Decagon: $1.5B на $40M ARR, доказано). Horizontal — это сразу разрядка фокуса.
5. После sales-вертикали в Q5 расширяемся в consulting (custdev/interview), затем R&D (planning/retrospective), затем legal/HR (custom).

**Альтернатива (Версия 1) сохраняется как fallback**, если в Q1 sales-wedge не подтверждает product-market fit за 3 пилота.

---

## Вопрос 5. ВЕРТИКАЛИ И ШАБЛОНЫ ВСТРЕЧ

Сейчас 9 типов горизонтально. Под вертикали нужны **специализированные пресеты** (типы встреч + специфика отчёта + промпты + дашборд-виджеты + интеграции).

### Топ-5 вертикалей и их пресеты

| Вертикаль | Новые типы встреч | Спец. отчёты | Спец. дашборд | Интеграции |
|---|---|---|---|---|
| **Sales (приоритет 1)** | sales_discovery, sales_demo, sales_negotiation, sales_closing, sales_qbr | Pipeline-report, Deal-risk-flag, Next-step-list, Stakeholder-map | Pipeline + churn-risk + open deals | Bitrix24, amoCRM, Telegram |
| **Consulting (приоритет 2)** | client_workshop, client_review, custdev_deep, advisory_session | Action-items по клиенту, бриф, deliverable-list | Project-fact + clients map + delivery-velocity | Я.Диск, Email, Я.Календарь |
| **HR (приоритет 3)** | candidate_screening, candidate_interview, employee_1on1, performance_review, exit_interview | Scorecard, Hiring-decision, Risk-flag (для exit), Development plan | People dashboard + retention risk + Open positions | 1С ЗУП, HH.ru API |
| **R&D / Product (приоритет 4)** | sprint_planning, retro, demo, design_review, tech_design | Tech debt list, decisions made, risks, blockers | Sprint velocity + tech debt + open RFCs | Jira/YouTrack, GitHub/GitLab, Confluence |
| **Legal / M&A (приоритет 5)** | legal_consultation, contract_review, mna_diligence | Issue list, decision points, риски, citations | Open matters + risk register + decisions | DocuSign, 1С Документооборот |

### Сколько новых типов и шаблонов

- **Sales**: +5 типов = 14 всего. ETA: 4 нед.
- **Consulting**: +4 = 18. ETA: 3 нед.
- **HR**: +5 = 23. ETA: 4 нед.
- **R&D**: +5 = 28. ETA: 4 нед.
- **Legal**: +3 = 31. ETA: 3 нед (но дольше валидация).

Итого 31 тип встреч за 18 нед при 1 AI-promt-engineer + 1 backend на full time.

### Архитектурный момент

Тип встречи = это не таблица, это **строка в MeetingTypeRegistry** (admin-editable). Каждый тип несёт:
- ID, name, description
- Промпты (chapters, tasks, summary, custom-fields)
- Дашборд-схема (какие виджеты в Org-Admin показывать)
- Vertical tag

Это даёт **самообслуживание клиента**: enterprise может сделать свой 32-й тип «технический комитет архитектуры» без участия Z. Это режет support load и одновременно делает продукт sticky.

**Уже почти готово в коде** (prompt-registry, admin-editable prompts). Нужно вывести в UI Org-Admin (Ф7).

---

## Вопрос 6. ИНТЕГРАЦИИ

Без интеграций Z — это «остров» с одним источником (встречи). Каждая интеграция увеличивает density графа в ~3–10 раз.

### Топ-10 интеграций (приоритет, ETA, ROI)

| # | Интеграция | Почему критично | ETA | Зависимость |
|---|---|---|---|---|
| 1 | **Bitrix24** (CRM read+write) | 35–40% SMB РФ. Sales-wedge без него мёртв | 4 нед | OAuth, REST API |
| 2 | **amoCRM** (CRM read+write) | 25–30% SMB | 4 нед | OAuth |
| 3 | **Telegram** (group chats, личка через MTProto) | Главный мессенджер РФ корпоратив. Источник 40% «нигде не записанного» | 6 нед | TDLib, согласия |
| 4 | **Я.Календарь** (read, через CalDAV/API) | Контекст встреч, кто пришёл, был ли отменён | 2 нед | OAuth |
| 5 | **Я.Почта Business** (IMAP IDLE + SMTP send) | Письма клиентам — критичный пласт коммуникации | 5 нед | OAuth, ABAC на content |
| 6 | **1С ЗУП + Документооборот** (REST/OData) | Кадровая правда, retention employees | 8 нед | per-version пакеты |
| 7 | **Я.Диск + Я.Документы** (WebDAV/REST) | Документы | 4 нед | OAuth |
| 8 | **TEAMLY** (Confluence-аналог) | Wiki, как pre-built knowledge | 4 нед | REST |
| 9 | **VK Teams / TenChat** | Внутренний мессенджер часть рынка | 4 нед | webhooks |
| 10 | **Outlook + Exchange** (для тех, кто ещё) | 30% крупных РФ остаются | 5 нед | EWS, OAuth |

**Slack / MS Teams** — задвинуты в Tier 2 (не блокирует Q1–Q4, делаем для enterprise по запросу).
**Confluence / Notion** — Tier 3 (не критично для РФ, многие мигрируют).
**Я.360 Wiki** — Tier 2, дешёво.

### Архитектурный паттерн

Каждая интеграция = адаптер, превращающий внешние события в `RawEvent`. Внутренний pipeline (block-ingest → distill → linker → theme) уже работает; всё, что нужно — это **read-side** и **писательский** layer. Это даёт каждой интеграции:
- Дешёвую разработку (нет дублирования AI-pipeline).
- Унифицированную ABAC и retention.
- Возможность отключать источник без потери остального.

### Sequence

Q1: Bitrix24, amoCRM, Я.Календарь.
Q2: Telegram, Я.Почта Business.
Q3: Я.Диск, TEAMLY.
Q4: 1С ЗУП, VK Teams, Outlook.

---

## Вопрос 7. AI-АГЕНТЫ КАК ПРОДУКТ

Из 11-слойной архитектуры — 4 ключевых агента. Не все строим сразу.

### Решение: что и когда

| Агент | Когда | Монетизация | Почему |
|---|---|---|---|
| **Employee Clone** | Q4 2026 — Q1 2027 (Ф12a, MVP) | Отдельный enterprise add-on, 5000–10000 ₽/clone/мес | Самый ценный (Viven $35M validation), главный закрыватель knowledge loss, дифференциатор vs commodity AI-встреч |
| **Decision Archaeologist** | Q3 2026 (Ф12c) | Входит в pro, отдельный API в enterprise | Самый простой технически (нужны только Decision class + valid_from). Sells по cases sales («почему сделку X слили»). |
| **Process Narrator** | Q1 2027 (Ф12b) | Входит в pro | Дешёвый (4 нед), стандартный use case (onboarding, аудит). Не дифференциатор сам по себе, но завершает «4 агента» нарратив. |
| **Compliance Agent** | Q2 2027 (Ф12d) | enterprise add-on, отдельный пакет 15000–30000 ₽/мес | Прямой ROI для DPO, оборотные штрафы 152-ФЗ делают его легко монетизируемым. Простая реализация (поверх audit log + LLM). |

### Что НЕ строим в первые 24 мес

- Discovery Agent (поиск неочевидных связей) — отложить, дорого, value сложно объяснить.
- Onboarding Agent (curriculum по subgraph предшественника) — отложить, узкий use case, делаем как фичу Employee Clone.
- Multi-agent orchestration — не нужно для MVP enterprise.

### Монетизация агентов как отдельный пакет

**«Z Agents Pack»** — enterprise add-on от 30 000 ₽/мес базовый, до 150 000 ₽/мес со всеми 4 агентами + 5 клонами. На 24-й месяц ожидаемая доля agents-revenue: 25–35% от ARR.

---

## Вопрос 8. ON-PREM / SELF-HOSTED

### Когда вводим on-prem-вариант

**Q3 2027 (16-й месяц от старта).** Не раньше — нужен зрелый продукт. Не позже — потеряем enterprise pipeline.

### Какие компании просят критически

- **B2G**: ФОИВы, госкорпорации, регулируемые отрасли (банки, телеком, энергетика). Им нельзя SaaS в принципе (ФСТЭК, КИИ).
- **Крупные корпораты с ИБ-комитетом** (>1000 чел., ВТБ-уровень).
- **Юр.фирмы / M&A**: privilege, конфиденциальность сделок.
- **Силовой блок и оборонные**: вне обсуждения SaaS вообще.

Прогнозный спрос: 5–10 крупных on-prem контрактов к концу 24-го мес = 30–50% ARR.

### Цена on-prem (enterprise)

- **Лицензия**: 3–8 млн ₽/год за пакет на 100 чел., 8–20 млн ₽/год за 100–500 чел., от 20 млн ₽/год за 500+.
- **Развёртывание**: 1,5–4 млн ₽ единовременно (включая обучение).
- **Поддержка**: 15–25% от лицензии/год.
- **Кастомизация**: 8 000–15 000 ₽/час.

Целевой средний enterprise-чек: ~10 млн ₽/год = ~830 тыс. ₽/мес. Для 700М/мес ARR при таком чеке нужно ~840 enterprise-клиентов, но реалистично смешение: 600 SMB по 50–150 тыс. ₽/мес + 250 mid-market по 300–500 тыс. ₽/мес + 80 enterprise по 1–3 млн ₽/мес.

### Stack on-prem

- **LiveKit Server** (open-source) — SFU.
- **PostgreSQL 16 + pgvector** — основная БД + векторы.
- **MinIO** — S3-совместимый объектный storage.
- **Redis** — кеши + BullMQ.
- **GigaAM v3** (open-source, ASR self-hosted) — бесплатно для коммерции.
- **T-Pro 32B** (Apache 2.0, Tinkoff) или **Qwen 2.5 32B** через vLLM — локальная LLM.
- **Опциональный прокси к GigaChat / Claude** через утверждённый прокси-сервер (только non-sensitive data + anonymization layer).
- **OPA + Casbin** — policy.
- **Prometheus + Grafana** — мониторинг.

Минимальные требования железа (100 чел., 5 встреч/день):
- 1 нода SFU: 16 ядер, 32 GB RAM, 1 Gbps.
- 1 нода Egress: 16 ядер, 32 GB RAM.
- 1 нода Backend + DB: 32 ядра, 128 GB RAM, 2 TB NVMe.
- 1 GPU-нода (24+ GB VRAM, A100/A6000) — для локальной LLM. Опционально, можно через прокси.

---

## Вопрос 9. PRODUCT-LED-GROWTH ИЛИ SALES-LED

**Работает на PLG сейчас:** free-tier basic (50 встреч/мес), self-onboarding через signup→встреча→link-invite, гость без регистрации как vector распространения, AI-отчёт в email участников.

**Мешает PLG:** нет UI in-product upgrade (баннер «закончилась квота»); нет sharing report public link; org self-creation требует manual approval; нет Yookassa/СБП self-serve checkout; нет referral; email-CTA не отполированы.

**Строим под PLG в первые 6 мес:**
1. In-product upgrade UI (Q1, 2 нед).
2. Sharing report public link (Q1, 1 нед).
3. Org self-creation + email-onboarding (Q2, 2 нед).
4. Yookassa/СБП self-serve (Q2, 3 нед).
5. Referral за приведённый Org +25% к квоте (Q2, 2 нед).

**Решение — Hybrid (Notion/Linear/Slack-паттерн):**
- **SMB (5–50 чел.)**: PLG. Self-onboarding, free → pro по карте, без sales touch.
- **Mid-market (50–500)**: PLG-assisted. Self-trial + sales-engineer для интеграций. Inside sales 1–2 чел.
- **Enterprise (500+, B2G)**: Sales-Led. Account-based, on-prem demo, outbound + presales 3–5 чел.

PLG-foundation должен быть готов к Q2 2026, иначе SMB-объёмы под 700М не набираются.

---

## Вопрос 10. PRODUCT TIME-TO-VALUE

**Сейчас TTV ~15–25 мин**: signup 2 мин → создание org 1 мин → встреча 5–60 мин → ожидание отчёта 3–7 мин → чтение 1–3 мин. 50% времени — сама встреча.

**Цель — 5 мин**, стратегия Demo-Meeting Replay:
1. Onboarding в 1 click → demo-org с готовой встречей.
2. Drag-n-drop существующего mp4/mp3 → AI-отчёт за 2–3 мин (signup → загрузка → ASR+LLM с прогретым кешем → чтение).
3. Sample-meeting в demo-org как fallback.
4. Чат-демо поверх sample.

**ROI**: TTV ≤ 10 мин → conversion ~25–40%; TTV ≥ 30 мин → ~5–12% (PLG-data). Падение TTV даёт 3–5× signup→activated conversion.

**ETA**: 4 нед, 12 FTE-нед, ~2,5 млн ₽.

---

## Вопрос 11. ТЕХ. ДОЛГ — что блокирует продажи

Из round-1 product-reality видны несколько критических точек. Топ-5 по приоритету для GTM:

### Топ-5 тех. долга

1. **Egress потрескивания (production risk)** — может проявиться на больших встречах или при нагрузке. Если в проде у клиента в важной встрече запись треснула — это NPS-катастрофа, репутация навсегда. **Приоритет: P0, фикс до первой sales-кампании.** ETA: 1–2 нед DevOps + QA.

2. **Параллельные версии v1/v2** (transcript-index v1+v2, card-rollup v1+v2, meeting-analyze-v2 рядом со старым) — двойная поддержка, потенциальные несоответствия, в long run — багогенератор. **Приоритет: P1, спланировать deprecation v1.** ETA: 3 нед удаления + миграция данных.

3. **Decision не первоклассная сущность** — блокирует Employee Clone, Decision Archaeologist, sales-кейс «почему сделка X слили». **Приоритет: P0 (продуктовый блокер).** ETA: 1 нед.

4. **valid_from / valid_to отсутствует на рёбрах** — блокирует временной срез графа = блокирует клон (не отвечает «как на момент ухода») и блокирует compliance forensic. **Приоритет: P0.** ETA: 2 дня миграция Prisma + 1 нед апдейт API.

5. **Stylistic profile отсутствует** — блокирует «клон отвечает как Маша», без него Employee Clone = просто RAG. **Приоритет: P1 (после Decision/valid_from).** ETA: 3 нед.

### Прочее (не блокирует продажи прямо сейчас, но требует решения в 6 мес)

- Frontend Фаз 5–12 не готов (backend есть) — это **не блокер продажи**, потому что эти фичи в продаже как «coming Q2». Но не закрыть к Q3 — нарушение обещаний.
- LiveKit-вебхуки могут приходить дважды — нужна идемпотентность всюду. Уже частично есть. Доделать в первые 2 мес.
- host networking LiveKit (1 под/ноду) — масштабирование SFU. Решается, когда >150 одновременных встреч; пока запас.
- Yandex SpeechKit округляет 15-сек блоки — мы используем GigaAM, проблема устранена; не возвращаемся к SpeechKit.

### Бюджет тех. долга

20% инженерных мощностей в первые 12 мес → 24% «healthy» tax. Q1–Q2 акцент на P0 (Egress, Decision, valid_from). Q3+ — на v1/v2 deprecation.

---

## Roadmap 24 мес поквартально

| Квартал | Месяцы | Релизы (ценность клиенту) | Внутренние работы |
|---|---|---|---|
| **Q1 2026 (M1–M3)** | Старт. Sales-vertical wedge. | Decision class + valid_from. Stylistic profile MVP. Sales-vertical preset (5 типов встреч). Bitrix24 read+write. amoCRM read+write. Я.Календарь. In-product upgrade UI. Demo-meeting (TTV 5 мин). Egress fix (P0). | Ф7 Z-Admin Stage 1. PLG-фундамент. |
| **Q2 2026 (M4–M6)** | Frontend Knowledge Core. | Ф5 Card UI + rollup-v2 frontend. Ф6 Chat-v2 frontend. Ф7 Z-Admin + Org-Admin (полные). Telegram integration. Я.Почта Business integration. Decision Archaeologist (alpha). | Yookassa/СБП self-serve. Referral. Deprecation v1 (transcript-index, card-rollup). |
| **Q3 2026 (M7–M9)** | Pulse + Goals + Consulting vertical. | Ф8 Дашборд директора. Ф9 Goal × alignment. Consulting preset (4 типа). Я.Диск integration. TEAMLY integration. Decision Archaeologist (GA). Sales-vertical промпты v2. | Ф11 Stage 1: RLS на БД, RBAC, materialized views для дашборда. |
| **Q4 2026 (M10–M12)** | Employee Clone MVP. | Employee Clone MVP (closed beta, 5–10 клиентов). HR preset (5 типов: candidate_interview, exit_interview и т.д.). 1С ЗУП integration. VK Teams integration. Outlook integration. | Ф11 Stage 2: GraphQL public API. Anonymization layer для cloud LLM. |
| **Q5 2027 (M13–M15)** | On-prem GA + R&D vertical. | On-prem package (закрытый pilot 3–5 клиентов). R&D / Product preset (5 типов). Jira + YouTrack integration. GitHub/GitLab integration. Confluence integration. Employee Clone (GA). Process Narrator. | On-prem deployment automation (Ansible/Helm). Compliance audit (ФСТЭК). |
| **Q6 2027 (M16–M18)** | Enterprise scale. | On-prem GA (открытая продажа). Z Agents Pack (Employee Clone + Decision Archaeologist + Process Narrator). Compliance Agent (alpha). Legal preset (3 типа). DocuSign integration. Регистрация в Реестре Минцифры. | RLS дозаполнение. Multi-region deployment. SSO для enterprise. |
| **Q7 2027 (M19–M21)** | Vertical expansion. | Legal vertical (GA). 1С Документооборот integration. Compliance Agent (GA). Public API GA + webhooks v2. Marketplace интеграций (UI для self-built адаптеров). | Cost optimization. Multi-tier LLM routing с anonymization. ATCG-compliant deployment patterns. |
| **Q8 2027 (M22–M24)** | Расширение, оптимизация LTV. | Vertical dashboards (5 верткалей). Z Agents Pack v2 (orchestration). Stylistic profile v2 (с voice opt-in). Memory consolidation (weekly/monthly LLM-распиловка фактов). | Финансовая модель оптимизации (cost per Org). Migration tooling для legacy CRM-клиентов. |

**Метрики по кварталам (целевые):**

| Квартал | MRR (млн ₽) | Активные орги | Доля Enterprise | Главная фокус-фаза |
|---|---|---|---|---|
| Q1 2026 | 5 | 30 | 0% | Sales-wedge ICP fit |
| Q2 2026 | 15 | 150 | 5% | PLG-машина |
| Q3 2026 | 40 | 400 | 10% | Pulse|
| Q4 2026 | 100 | 800 | 20% | Clone-beta |
| Q5 2027 | 200 | 1400 | 30% | On-prem pilot |
| Q6 2027 | 350 | 2000 | 40% | On-prem GA |
| Q7 2027 | 550 | 2600 | 45% | Vertical depth |
| Q8 2027 | **750** | 3000+ | **50%** | **Цель достигнута** |

---

## Открытые риски и контрольные точки

1. **Sales-vertical wedge не подтвердился за 3 пилота к концу Q1** → fallback на Версию 1 roadmap (Pulse First).
2. **Bitrix24 / amoCRM API не покрывает нужные операции** → нужен альтернативный коннектор через CDC.
3. **Сбер выпустил GigaChat Enterprise + GigaMemory в Q3 2026 (раньше прогноза)** → ускоряем Employee Clone до Q3 (срезаем что-то ещё).
4. **152-ФЗ уточнения** → проверять с DPO ежеквартально.
5. **Реестр Минцифры регистрация затягивается** → начинаем процесс в Q1 2026, не позже.

---

## Итог

Z — это **AI-видеовстречи, которые превращаются в живой мозг компании**. 5 продуктовых пластов (встречи → граф → дашборд → внешняя память → агенты), каждый sellable, retention растёт с накоплением пластов. Ров — event-sourced Knowledge Core + per-track audio + 152-ФЗ комплаенс + типизированные шаблоны. К 700 млн ₽/мес идём через sales-vertical wedge (Q1) → PLG-машину (Q2) → дашборд+цели (Q3) → Employee Clone (Q4) → on-prem (Q5–Q6) → vertical expansion (Q7–Q8). Top-5 тех. долгов (Egress fix, Decision class, valid_from, deprecation v1, stylistic profile) убираем в первые 2 квартала. ETA full roadmap — 24 мес, бюджет R&D ~150 млн ₽.
