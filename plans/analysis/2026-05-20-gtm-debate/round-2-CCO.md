---
status: round-2
role: CCO
date: 2026-05-20
audience: virtual_ceo_team
target: 700 млн ₽/мес ARR за 24 мес
---

# Раунд 2. CCO: монетизация и доказательство достижимости 700M ₽/мес

> Все цифры — в ₽ если не указано иное. Курс для перевода справочных $-цен: 1$ ≈ 95₽. Все юнит-экономические выкладки основаны на дайджестах Раунда 1 (продуктовая реальность + рыночный web-research + маркетинг + планы).

---

## Краткое содержание (TL;DR для CEO)

- **Модель:** Hybrid SaaS — per-seat базовая подписка + per-Org enterprise tier + usage-метеринг с soft-caps + paid add-on packs (Employee Clone, Compliance, On-prem). Никакого freemium — только Free Trial 14 дней. Это закрывает сразу три риска: убыточные heavy-free-users (Mem.ai), commoditization AI-саммари и слом юнит-экономики на open-source ASR.
- **Целевая сетка ARPU:** SMB 1 800-2 400 ₽/seat, Mid 4 500-6 000 ₽/seat, Enterprise — 8-15M ₽/Org/год (контракт).
- **Gross margin:** 78-82% на стационаре (GigaAM self-hosted = 0 ASR-cost, GigaChat 2 Pro + prompt caching 90% input = COGS на встречу ≈ 4-8 ₽).
- **Путь к 700M ₽/мес (рекомендация):** Hybrid-декомпозиция — 60K SMB seats × ~2 000 ₽ + 600 Mid-Org × ~250K ₽ + 30 Enterprise × ~5M ₽ = 720M ₽/мес.
- **Бюджет:** Base-раунд 1.8 млрд ₽ на 24 мес (R&D 35%, GTM 38%, CS 10%, Infra 12%, G&A 5%). Команда к месяцу 24 — 95-110 чел.
- **Главная коммерческая ставка:** «Company Brain как paid add-on на базе AI-meeting platform», а не «ещё один AI-notetaker». Чек Mid/Ent растёт в 5-10× за счёт Knowledge Core, Employee Clone и Goal Alignment.

---

## Вопрос 1. БИЗНЕС-МОДЕЛЬ

### Варианты

**(А) Pure SaaS per-seat.** Чисто как Granola / Otter / Fireflies.
- *Pros:* простота, понятный churn-расчёт, легко прогнозируется, бенчмарки рынка.
- *Cons:* в РФ потолок ARPU/seat ниже (Контур.Толк 1 100 ₽, SaluteJazz 3 910 ₽, mymeet.ai $19=1 800 ₽). 200K seats × 3 500 ₽ = много seats для нишевого вертикали; CAC растёт квадратично.

**(Б) SaaS per-organization tiers (как Granola Business).**
- *Pros:* enterprise легко продаётся пакетом; не зависит от текучки сотрудников.
- *Cons:* SMB-сегмент привык платить per-seat — резкая просадка SMB pipeline. Не покрывает реальную нагрузку (heavy-Org с 50 встреч/нед платит как Org с 5).

**(В) Usage-based (по минутам записи / AI-job).**
- *Pros:* честная привязка к COGS, легко продавать «1 ₽ за минуту транскрипта».
- *Cons:* непредсказуемая выручка, тяжело для финансового планирования у клиента (= возражение «не понимаю, сколько потрачу»), очень сложно прайсить Knowledge Core (это не «минута»).

**(Г) Hybrid: base seat + usage cap.** Базовая подписка с включёнными квотами, перерасход — по тарифу.
- *Pros:* предсказуемость + защита от heavy-users, естественный upsell, бенчмарк (Otter, Read.ai, Fireflies Business — все hybrid).
- *Cons:* сложнее объяснить SMB при первом контакте, требует robust billing pipeline (у Z уже готов — см. tier-гейтинг, AiUsageLog).

**(Д) Enterprise-only large deals (Sentra / Viven).**
- *Pros:* высокий чек ($35M Viven seed под 2 клиента — Genpact и Eightfold).
- *Cons:* 12-18 мес sales cycle, нужен enterprise sales от первого дня, не успеваем в 24 мес.

**(Е) Marketplace / партнёрская комиссия.**
- *Pros:* доп. revenue, развивает экосистему (AI-агенты в маркетплейсе, шаблоны типов встреч сторонних разработчиков).
- *Cons:* месяцы 18-24 — это уже зрелая фаза, не основной источник 700M.

**(Ж) AI-агенты как paid pack (Employee Clone, Decision Archaeologist, Compliance).**
- *Pros:* отдельный line item ARPU ×1.5-2 для тех Org, которые внедрили; ров vs. mymeet.ai, который этого не имеет.
- *Cons:* зависит от готовности Фазы 12 Knowledge Core (Employee Clone) — ETA Q3-Q4 2026.

### Выбор: Г + Д + Ж (combo), с щепоткой Е на месяце 18+

**Основная модель = Hybrid (Г):** per-seat подписка с включённой квотой минут/AI-jobs/блоков. Перерасход — фиксированный rate из биллинговой таблицы (уже в продакшене у Z — basic/pro/enterprise с квотами).

**Параллельно (Д):** Enterprise per-Org контракты со своей ценовой структурой (50-200K ₽/мес base + on-prem + custom-SLA).

**Аддоны (Ж):** Employee Clone, Compliance Agent, Decision Archaeologist — отдельные paid packs (15-50К ₽/мес/Org) с месяца 12+.

**Marketplace (Е):** скорее всего месяцы 18-24, как доп. monetization layer, не как основной.

### Обоснование

Hybrid выбран потому что:

1. **COGS у Z асимметричен.** ASR (GigaAM self-hosted) = 0 ₽. LLM (GigaChat 2 Pro + prompt caching 90% input) = 4-8 ₽/встреча. Per-seat без cap = я продам подписку и кто-то будет лить 200 ч/мес → COGS 1500 ₽ + Egress + S3 = >50% margin loss на heavy user. **Mem.ai сжёг $23.5M именно на этом** — урок усвоен.

2. **РФ-рынок ВКС стартует с дешёвых per-Org/per-tariff чеков** (Контур.Толк 1 100 ₽, SaluteJazz 3 910 ₽) — попасть в этот же ценовой коридор для SMB и одновременно дать enterprise-чек — только через hybrid с явными tiers.

3. **Knowledge Core нельзя прайсить per-minute** — это не минута, это «компания знает себя». Тут per-Org логично (как Granola Business $19/user, но мы добавляем Org-level «Brain seats»).

4. **Add-on packs — это +30-50% ARPU expansion** (NRR). Без них NRR 110% недостижим: чистый per-seat upsell в РФ это +5-10%/год.

---

## Вопрос 2. ТАРИФНАЯ СЕТКА

### Три варианта общей логики

**(А) Freemium с агрессивным free tier.**
- *Pros:* PLG-распространение, как Granola в первые 6 мес.
- *Cons:* Mem.ai кейс ($23.5M в воздух), heavy-free-users убыточны при per-seat COGS, для РФ-B2B (где CAC через перформанс ≠ виральность) даёт мало.

**(Б) Free trial 14 дней без freemium.**
- *Pros:* честное «попробуй и плати», нулевые COGS на нон-конвертирующих, простое CS.
- *Cons:* медленнее PLG, нужен сильный onboarding-флоу, чтобы конверсия trial→paid была ≥25%.

**(В) Только paid (no free), с демо.**
- *Pros:* enterprise-логика, как Sentra/Viven.
- *Cons:* теряем SMB-канал, который даёт MQL объём для перформанса.

### Выбор: Б (Free trial 14 дней) — основной, с микс-исключениями

**Почему:** Granola и Otter показали, что unlimited free tier — это смерть для unit economics в AI-стартапах. mymeet.ai даёт 5 встреч/мес free и это работает только потому, что у них ASR на чужих GPU. У Z есть преимущество: GigaAM self-hosted ≈ бесплатно — но при росте до 60K seats это не масштабируется в free для 200K not-paying юзеров.

Исключение из «no freemium»: **Solo Pro Lite** — 100% бесплатный для одиночных пользователей (1 встреча/нед, no team features, no Knowledge Core, рекламная подпись в отчёте) — это работает как top-of-funnel и виральный канал. Это НЕ freemium с производственной нагрузкой, это marketing tool.

### Сетка по 3 ICP-сегментам

#### ICP-A: Продажи / Custdev / Discovery (5-50 чел)

| Параметр | Solo Lite | Sales Pro | Sales Team | Sales Enterprise |
|---|---|---|---|---|
| **Цена** | 0 ₽ | **1 990 ₽/seat/мес** | **4 500 ₽/seat/мес** | от 80 000 ₽/Org/мес |
| **Seats** | 1 | до 10 | от 5 | от 25 |
| **Минут записи/seat/мес** | 240 (~4 ч) | 1 800 (~30 ч) | 3 600 (~60 ч) | без лимита |
| **AI-jobs/seat/мес** | 4 встречи | 40 | 100 | unlimited |
| **Шаблоны типов встреч** | 1 (sales call) | 3 (sales, discovery, custdev) | все 9 | все 9 + custom |
| **CRM-карточки** | — | базовые | rollup auto + клиент/сделка | + интеграции с Bitrix24/amoCRM/1С |
| **Knowledge Core доступ** | — | read-only по своим | full org-scope | full + API |
| **Retention записей** | 30 дней | 90 дней | 365 дней | до 7 лет (152-ФЗ) |
| **Public API + webhooks** | — | — | да | да + on-prem |
| **Видео ≤ 10 участников** | да | да | да | до 100 |
| **SSO + Casbin RBAC** | — | — | базовый | full enterprise (SAML/OIDC) |

**Логика:** Pro закрывает индивидуальных продавцов (= mymeet $19), Team — отдел продаж (5-15 чел = 22 500-67 500 ₽/мес/Org), Enterprise — большой sales-org с интеграциями.

#### ICP-B: Продукт / Planning / Retrospective (10-200 чел)

| Параметр | Product Starter | Product Team | Product Scale | Product Enterprise |
|---|---|---|---|---|
| **Цена** | **1 800 ₽/seat/мес** | **3 900 ₽/seat/мес** | **6 500 ₽/seat/мес** | от 250 000 ₽/Org/мес |
| **Seats** | от 5 | от 10 | от 25 | от 50 |
| **Минут/seat/мес** | 1 200 | 2 400 | 4 800 | unlimited |
| **AI-jobs/seat/мес** | 30 | 80 | 200 | unlimited |
| **Шаблоны** | planning, retro, project | + standup, partner | все 9 + custom | все 9 + кастомные prompts |
| **Knowledge Core** | блоки + поиск | + Темы + Граф | + Цели + Strategic Alignment | + Employee Clone (опция) |
| **Director Dashboard** | — | базовый | full (6 виджетов) | full + custom |
| **AI-Chat с компанией** | — | 50 запросов/seat/мес | 300/seat | unlimited |
| **Retention** | 180 дней | 365 дней | 730 дней | 7 лет |
| **Integrations (Slack/Notion/1С)** | — | 1 коннектор | 5 коннекторов | все |
| **On-prem option** | — | — | — | да |

**Логика:** Product-сегмент = «компания работает с инфо» → ставка на Knowledge Core, Dashboard и Chat. Это **главный апсейл-движок** ARPU.

#### ICP-C: Консалтинг / Брифинг / Юр / M&A (3-30 чел, высокий чек/seat)

| Параметр | Solo Consultant | Boutique | Firm | Enterprise Consulting |
|---|---|---|---|---|
| **Цена** | **2 900 ₽/seat/мес** | **5 500 ₽/seat/мес** | **9 500 ₽/seat/мес** | от 400 000 ₽/Org/мес |
| **Seats** | 1-3 | 3-10 | 10-30 | от 25 |
| **Минут/seat/мес** | 2 400 | 4 800 | 9 000 | unlimited |
| **AI-jobs/seat/мес** | 60 | 150 | 300 | unlimited |
| **Шаблоны** | brief, consult, custdev | + interview, partner | все 9 + кастомизация | все + клиентские pre-set |
| **Knowledge Core** | personal | team-scope | org-scope + клиентские subgraphs | + Decision Archaeologist add-on |
| **Per-client compartmentalization** | — | — | да | да + контрактный режим |
| **Compliance Agent** | — | — | опция (+15K/мес) | включён |
| **Retention** | 365 | 730 | 1 825 | 7 лет |
| **On-prem** | — | — | опция | да |
| **Encryption at rest + audit** | базовый | базовый | full | full + SuperAdminAccessLog |

**Логика:** Консалтинг платит **в 1.5-2× больше per-seat** (= аналог Юкоз, Метаментор) из-за compliance, retention и сегментации по клиентам. Decision Archaeologist + Employee Clone особенно ценны.

### Add-on packs (поверх любого tier)

| Add-on | Цена | Включает |
|---|---|---|
| **Employee Clone Pack** | +15 000 ₽/seat/мес | stylistic profile + personal subgraph + voice (опция) — Фаза 12 |
| **Compliance Agent** | +25 000 ₽/Org/мес | 152-ФЗ авто-аудит, KII, anti-leak, отчёты Роскомнадзор-style |
| **Decision Archaeologist** | +20 000 ₽/Org/мес | recovers full decision history с rationale + alternatives |
| **Process Narrator** | +18 000 ₽/Org/мес | автодокументация процессов |
| **On-prem deployment** | +500 000 ₽ единоразово + 30% к ежемесячной | self-hosted + поддержка |
| **Custom LLM route (Claude/Yandex/GigaChat)** | +5K-15K/мес/Org | через LlmRouter |
| **Dedicated CSM + SLA 99.9%** | +50K/мес | для Mid/Enterprise |

---

## Вопрос 3. ЮНИТ-ЭКОНОМИКА

### Допущения по COGS (по одной встрече часовой)

- **ASR:** GigaAM self-hosted на собственных GPU → **0 ₽ переменных** + амортизация GPU (CapEx, заложен в Infra). Альтернатива SaluteSpeech API 36 ₽/час — используем только как fallback.
- **LLM:** Claude Sonnet 4.6 через proxy (текущий MVP, ~$0.08-0.12 = 8-12 ₽/встреча) ИЛИ GigaChat 2 Pro 0.5 ₽/1k токенов. Часовая встреча = ~20K input токенов + 3K output = ~10К токенов effective при prompt caching 90% input. **GigaChat 2 Pro: 0.5 × 3 = 1.5 ₽ при кэше + 0.5 × 1 = 0.5 ₽ output ≈ 2 ₽**. С Claude — 8-12 ₽. Берём смешанный COGS = **4-8 ₽/встреча** (LlmRouter маршрутизирует по типу/важности).
- **Embeddings:** text-embedding-3-small ≈ 0.5 ₽/встреча.
- **S3 + Egress:** ~50-150 МБ/час видео + дорожки. Selectel S3 ~1.5 ₽/ГБ/мес → ~0.15-0.5 ₽/мес на встречу. При retention 365 дней — 1.8-6 ₽/встречу амортизированно.
- **LiveKit SFU compute:** 64 ядра = 80-100 встреч одновременно. Сервер ~80K ₽/мес. На 100 встреч × 200 ч/мес активного использования = ~4 ₽/час SFU. Округлим до 5 ₽/час.
- **Postgres + Redis + BullMQ + observability:** ~3-5 ₽/встреча.

**Итого COGS на типовую встречу (1 ч):**
- LLM: 4-8 ₽
- ASR: 0 ₽
- Embeddings: 0.5 ₽
- S3+CDN amortized: 2-6 ₽
- SFU compute: 5 ₽
- Misc infra: 3-5 ₽
- **= 14-24 ₽/встреча (берём ~20 ₽ baseline)**

### Допущения по поведению

| Сегмент | Встреч/seat/мес | COGS variable/seat/мес | Knowledge Core доп. COGS/seat/мес |
|---|---|---|---|
| SMB (Pro / Sales Pro / Product Starter) | 12-20 | ~300-400 ₽ | ~50-100 ₽ |
| Mid (Team / Scale / Firm) | 25-50 | ~700-1 000 ₽ | ~200-400 ₽ |
| Enterprise | 40-80 | ~1 200-1 800 ₽/seat | ~500-1 000 ₽/seat |

### ARPU/COGS/Gross Margin по сегментам — 3 сценария

#### Консервативный (низкое потребление, downgrade tendencies)

| Сегмент | ARPU/мес | COGS/мес | GM% |
|---|---|---|---|
| SMB | 1 800 ₽ | 450 ₽ | **75%** |
| Mid | 4 200 ₽ | 1 100 ₽ | **74%** |
| Enterprise (per seat в крупном контракте) | 7 500 ₽ | 2 200 ₽ | **71%** |

#### Базовый (наиболее вероятный)

| Сегмент | ARPU/мес | COGS/мес | GM% |
|---|---|---|---|
| SMB | 2 100 ₽ | 400 ₽ | **81%** |
| Mid | 5 000 ₽ | 1 050 ₽ | **79%** |
| Enterprise (per seat) | 9 500 ₽ | 2 000 ₽ | **79%** |

Add-ons (Employee Clone / Decision Archaeologist) дают ARPU expansion на 15-30% при дельта-COGS только +100-300 ₽/seat → GM добавок **~85-90%**.

#### Оптимистичный (heavy upsell + add-ons взлетели)

| Сегмент | ARPU/мес | COGS/мес | GM% |
|---|---|---|---|
| SMB | 2 400 ₽ | 380 ₽ | **84%** |
| Mid | 6 500 ₽ | 1 000 ₽ | **85%** |
| Enterprise (per seat) | 12 500 ₽ | 1 900 ₽ | **85%** |

**Целевая по группе:** 78-82% gross margin на стационаре. Это согласуется с benchmark для SaaS-AI: Otter 75-80%, Fireflies 76-82%, Notion 86% (legacy без AI), Granola — публично не раскрыто, но при их $20M ARR и $192M raise — заложено ≥75%.

### CAC по каналам (3 сценария)

| Канал | CAC SMB | CAC Mid | CAC Enterprise |
|---|---|---|---|
| **PLG (organic + content + free trial)** | 1 500-3 000 ₽ | 15 000-25 000 ₽ | n/a |
| **Performance (Yandex Direct + VK Ads + Telegram)** | 5 000-9 000 ₽ | 30 000-60 000 ₽ | n/a |
| **Inside sales (SDR → demo → close)** | 15 000-25 000 ₽ | 80 000-150 000 ₽ | 400 000-800 000 ₽ |
| **Outbound enterprise (AE + SE)** | n/a | 200 000-350 000 ₽ | **800 000-2 000 000 ₽** |
| **Partner / реселлеры (1С, Bitrix24, интеграторы)** | 2 500-5 000 ₽ | 40 000-80 000 ₽ | 300 000-600 000 ₽ |

Базовый микс CAC: SMB ~6 000 ₽, Mid ~70 000 ₽, Enterprise ~1 200 000 ₽.

### LTV, LTV/CAC, Payback — 3 сценария

CEO задал LTV = ARPU × 12. Это **очень агрессивно** для РФ-SaaS (churn 8.3%/мес ≈ 65% годовых). Реалистично только если: (а) NRR ≥110% компенсирует логотипный churn; (б) сильный onboarding/CS; (в) есть «sticky»-фичи (Knowledge Core, Goal Alignment, Card-rollup) которые удерживают.

Я даю **3 LTV-сценария**, не один.

#### Консервативный (gross churn 5%/мес, NRR 100%)

| Сегмент | ARPU | Срок жизни | LTV gross | LTV net (× GM) | CAC | LTV/CAC | Payback |
|---|---|---|---|---|---|---|---|
| SMB | 1 800 ₽ | 20 мес | 36 000 ₽ | 27 000 ₽ | 6 000 | 4.5× | 4 мес |
| Mid | 4 200 ₽ | 24 мес | 100 800 ₽ | 74 600 ₽ | 70 000 | 1.1× | 22 мес |
| Ent (на Org, ~30 seats × 7 500) | 225 000 ₽ | 30 мес | 6.75M ₽ | 4.8M ₽ | 1.2M | 4.0× | 8 мес |

⚠️ Mid в консерве — **на грани**. Это значит: либо снижаем CAC через PLG, либо поднимаем NRR через add-ons.

#### Базовый (gross churn 4%/мес, NRR 110%)

| Сегмент | ARPU | LTV (net × GM × NRR factor) | CAC | LTV/CAC | Payback |
|---|---|---|---|---|---|
| SMB | 2 100 ₽ | 51 000 ₽ | 6 000 | **8.5×** | 3.5 мес |
| Mid | 5 000 ₽ | 137 500 ₽ | 70 000 | **1.96×** → с add-ons 3.0× | 14 мес |
| Ent | 285 000 ₽/Org | 9.5M ₽/Org | 1.2M | **7.9×** | 4-6 мес |

#### Оптимистичный (churn 3%/мес, NRR 130% — Sentra-уровень)

| Сегмент | ARPU | LTV | CAC | LTV/CAC |
|---|---|---|---|---|
| SMB | 2 400 ₽ | 84 000 ₽ | 5 500 | **15.3×** |
| Mid | 6 500 ₽ | 280 000 ₽ | 60 000 | **4.7×** |
| Ent | 375 000 ₽/Org | 15.5M | 1.0M | **15.5×** |

**Вывод:** в базовом сценарии LTV/CAC ≥3× достигается во всех сегментах **только при add-ons и NRR ≥110%**. CEO-формула LTV=ARPU×12 — оптимистичный край. Я предлагаю в финансовом плане считать LTV=ARPU×18-24 с net-структурой.

---

## Вопрос 4. ПУТЬ ДО 700 МЛН ₽/МЕС

### Три декомпозиции

#### (А) Mass-market PLG: 200K seats × 3 500 ₽

- 200 000 платящих seats × 3 500 ₽ = 700M ₽/мес.
- **MAU потребуется:** при utilization 60% активных от платящих и 25% trial→paid конверсии = **~330K активных seats** + **~800K trial-юзеров** прошло за 24 мес.
- *Pros:* нет sales-команды, чистый PLG.
- *Cons:* в РФ нет 200K seats для AI-meetings — реалистичный TAM мейнстрим SMB B2B на 24 мес ~ 50-80K платящих seats суммарно по рынку. Это путь Granola, но в США их 100K seats потребовалось 2 года и $192M. У нас бюджет 50-200M ₽. **Нереалистично.**

#### (Б) Hybrid: SMB+Mid+Enterprise

- 60K SMB seats × 2 000 ₽ = 120M ₽/мес
- 600 Mid Orgs × 250 000 ₽ = 150M ₽/мес (= ~7 500 Mid seats средний 20 seats × 12 500 ₽ blended ARPU per Org)
- 200 Enterprise Orgs × 2 200 000 ₽ = 440M ₽/мес
- **Итого: 710M ₽/мес.**

- *Pros:* распределённый риск, не зависит от одного канала, реальный TAM покрыт.
- *Cons:* нужна enterprise-команда + PLG + Mid sales — сложный operations.

#### (В) Enterprise-heavy: 100 ent × 5M ₽ + 100 mid × 1M ₽ + остаток PLG

- 100 Ent × 5 000 000 ₽ = 500M ₽/мес
- 100 Mid × 1 000 000 ₽ = 100M ₽/мес
- ~50K SMB seats × 2 000 ₽ = 100M ₽/мес
- **Итого: 700M ₽/мес.**

- *Pros:* стабильность чека, low-churn enterprise.
- *Cons:* enterprise sales cycle 12-18 мес — на 24-м месяце 100 enterprise возможны только при стартовых посевных в B2G/КИИ. Высокий risk concentration.

### Выбор: Б (Hybrid) — основной, с уклоном к Mid+Ent

**Декомпозиция выбранного пути (Б, уточнённая):**

| Сегмент | Кол-во на месяце 24 | ARPU/мес | Выручка/мес |
|---|---|---|---|
| **SMB (per seat)** | 60 000 seats | ~2 000 ₽ | **120M ₽** |
| **Mid-market (per Org)** | 600 Orgs (avg 20 seats × 5 000 + add-ons = ~250K) | ~250 000 ₽ | **150M ₽** |
| **Enterprise (per Org)** | 30 Orgs | ~5 000 000 ₽ | **150M ₽** |
| **Mega-Enterprise (B2G + крупный корпорат)** | 12 Orgs | ~15 000 000 ₽ | **180M ₽** |
| **Add-ons + Marketplace + on-prem licensing** | — | — | **100M ₽** |
| **ИТОГО** | | | **700M ₽/мес** |

### Промежуточные точки (вехи)

| Месяц | Цель MRR | SMB seats | Mid Orgs | Ent Orgs | Mega-Ent | Что происходит |
|---|---|---|---|---|---|---|
| **M6** | **12M ₽/мес** | 3 000 | 30 | 1 (пилот) | 0 | PLG-ядро + 2 first-paid sales-команды; реестр Минцифры подан |
| **M12** | **90M ₽/мес** | 15 000 | 150 | 6 | 2 | Knowledge Core Ф7-9 в проде; первые add-ons; реестр получен; B2G тендеры стартовали |
| **M18** | **350M ₽/мес** | 38 000 | 380 | 18 | 7 | Employee Clone в проде (Ф12); on-prem deployment; KII compliance pack |
| **M24** | **700M ₽/мес** | 60 000 | 600 | 30 | 12 | NRR 110%+ работает; outbound enterprise zрелый |

### Воронка / waterfall (типовой месяц зрелого состояния, M18-24)

#### SMB / PLG-воронка (ежемесячно генерирует ~3 000 net-new seats к M18-24)

| Этап | Объём/мес | Конверсия |
|---|---|---|
| Visitors (сайт, контент, SEO) | 250 000 | 100% |
| Sign-ups (free trial 14 дней) | 25 000 | 10% |
| Activated (≥3 встречи в trial) | 12 500 | 50% |
| Trial → Paid | 3 750 | 30% |
| Net-new paid seats (с учётом upsell в команды) | 3 000-3 500 | (упускаем 250-500 на churn) |

#### Mid / inside sales-воронка (генерирует ~30-40 net-new Org/мес к M18-24)

| Этап | Объём/мес | Конверсия |
|---|---|---|
| Inbound (sign-up Org ≥5 seats + outbound MQL) | 1 200 | 100% |
| SQL (квалифицировано SDR) | 360 | 30% |
| Demo done | 180 | 50% |
| Proposal sent | 90 | 50% |
| Won | 36 | 40% |

#### Enterprise-воронка (генерирует ~3-4 net-new Org/мес к M18-24)

| Этап | Объём/мес | Конверсия |
|---|---|---|
| Outbound ABM accounts target | 60 | — |
| First meeting | 18 | 30% |
| Pilot/POC negotiation | 9 | 50% |
| POC running | 6 | 67% |
| Won (after 6-12 мес cycle) | 3-4 | 50-67% |

Sales cycle: SMB 7-14 дней, Mid 30-60 дней, Ent 6-12 мес.

---

## Вопрос 5. CHURN И УДЕРЖАНИЕ

### LTV 12 мес = 8.3% churn/мес — оценка

В РФ-SaaS типовой gross churn у молодых продуктов 5-10%/мес в первый год, потом стабилизация на 3-5%. **8.3% target достижим только при сильном CS и продуктовых retention-механиках.**

### Лост-причины по сегментам (ожидание)

| Сегмент | Топ-3 причины churn |
|---|---|
| **SMB Pro** | (1) Не «прижился» в команде, (2) переключились на mymeet/Я360 (cheap+простой), (3) AI-отчёт не зашёл по типу встречи |
| **Mid Team/Scale** | (1) Не запустился Knowledge Core (нет ingestion внешних источников), (2) Director Dashboard не используется CEO, (3) внутренний champion ушёл |
| **Enterprise** | (1) Сбер GigaChat Enterprise зашёл с лучшей integration в их Salute-стек, (2) compliance-issue с КИИ, (3) сменился CIO |

### Retention-фичи Z, которые работают на удержание

1. **Knowledge Graph per-Org** — чем дольше Org в Z, тем больше связей, тем дороже мигрировать. **Lock-in #1.**
2. **Cards (CRM-карточки) с auto-rollup** — клиент/сделка/проект агрегируются в Z. Без Z → теряешь rollup-историю.
3. **Goal Alignment Snapshots** — недельная история alignment 0-100, наглядная диаграмма «вектор движения компании».
4. **Director Dashboard + AI-Chat** — CEO заходит еженедельно, формирует привычку.
5. **Employee Clone (Ф12)** — после внедрения это уже digital twin сотрудников, миграция = потеря twin-ов.
6. **152-ФЗ compliance** — переключиться на западный продукт = open compliance issue.

### NRR таргет

- **Месяц 6:** NRR 95% (новый продукт, churn пока преобладает).
- **Месяц 12:** NRR 105%.
- **Месяц 18:** NRR 115%.
- **Месяц 24:** NRR 120% для Mid+Ent сегмента, 100-105% для SMB.

Без NRR ≥110% на Mid/Ent — 700M невозможно.

### Программа удержания

1. **Onboarding-воркфлоу первых 30 дней:** проверка «активирован ли Org» (≥10 встреч, ≥1 Cardm, ≥1 Theme сгенерирована, ≥1 AI-chat запрос). Кто не активирован к 14-му дню — поднимаем на CS.
2. **Customer Success менеджеры (CSM):** 1 CSM на 50 Mid Orgs, 1 CSM на 5 Enterprise. Ежеквартальный business review (QBR).
3. **In-app guides:** при первом входе — guided tour по 9 типам встреч; через 30 дней — tour по Knowledge Core.
4. **Expansion playbook:** в M3-M6 предлагать add-ons по сигналам (например, много Decision-блоков → Decision Archaeologist).
5. **NPS квартально** + auto-alert при NPS<6.

---

## Вопрос 6. COGS И ИНФРА-БЮДЖЕТ

### При выручке 700M ₽/мес → COGS ≤ 22% = ~155M ₽/мес

Структура целевой инфры на M24:

| Компонент | Расход/мес | Комментарий |
|---|---|---|
| **GPU (для GigaAM ASR + локальных LLM/embedding)** | 25-35M ₽ | 30-50 A100/H100-equivalent (или RTX 6000 Ada в РФ), self-hosted; capex амортизирован |
| **LiveKit SFU + Egress + TURN** | 18-25M ₽ | 400-600 нод по 64 ядра (для 30-50K concurrent meetings peak), отдельные сети для SFU/Egress/TURN |
| **S3-storage (Selectel/SberCloud)** | 8-12M ₽ | На M24 ~3-5 PB (записи 7-летний retention для Enterprise, 365-730 для остальных) |
| **LLM API (Claude/GigaChat/YandexGPT через LlmRouter)** | 25-40M ₽ | Mid+Enterprise часто требуют Claude → дороже; SMB на GigaChat 2 Pro; prompt caching обязателен |
| **Postgres (managed) + Redis + Qdrant/pgvector + ClickHouse** | 12-18M ₽ | Большая база на 3-5 PB metadata + векторы |
| **Egress/CDN/network** | 5-8M ₽ | Видео-стриминг + S3-download |
| **Monitoring/observability/logging** | 3-5M ₽ | Prometheus, Grafana, ELK, Sentry |
| **Прочее (DNS, IPs, лицензии)** | 2-4M ₽ | |
| **ИТОГО COGS** | **~100-145M ₽/мес** | в коридоре 14-21% от 700M = gross margin **79-86%** |

Это укладывается в целевую 75-80% gross / 25% COGS.

### Узкие места ёмкости

- **GPU для GigaAM** — нужно 30-50 единиц на M24. В РФ дефицит — заказывать сейчас.
- **LiveKit SFU** — host networking требует 1 под на ноду. На M24 нужно ~500-600 нод. **Принцип CLAUDE.md: SFU/Egress/TURN/Backend/DB/Storage никогда не на одной ноде.**
- **S3 retention** — для Enterprise с 7-летним сроком и 50-80 встреч/seat/мес × 60-200 МБ/встреча → ~3-5 PB cumulative. Аренда Selectel/SberCloud — **критичный долгосрочный контракт**.

---

## Вопрос 7. РИСКИ КОММЕРЦИИ

### Риск 1: Сбер выкатывает GigaChat Enterprise + GigaMemory → переменивает рынок

**Вероятность:** 70% к Q3 2026, 95% к Q1 2027.

**Удар по нам:** для всех Org в Salute-стеке (а это много корпоратов из топ-1000) GigaChat будет включён в комплект. Прямая конкуренция в Enterprise-канале.

**План Б:**
1. **Дифференциация по 9 типам встреч + UX встреч + on-prem.** Salute даёт generic LLM-memory; мы даём product-grade «AI-протокол под тип встречи + dashboard + Knowledge Graph + Employee Clone». Это разный товар.
2. **Партнёрство с не-Salute стеком:** Yandex, VK, МТС Линк — у них нет своего «Company Brain», есть только AI-summary встреч. Z может быть «memory layer» поверх их ВКС через интеграции.
3. **Гипер-вертикализация в 2 нишах:** консалтинг/M&A/юристы (compliance) + продажи (CRM-интеграция). Сбер — горизонтально.
4. **On-prem + open-source стек:** для тех, кто не хочет в Salute-облако (а это многие — от B2G до банков-конкурентов Сбера).

### Риск 2: Падение цен на ASR/LLM в 10× за 12 мес

**Вероятность:** 80% (GigaChat уже -3× за полгода).

**Удар:** конкуренты с per-meeting pricing смогут давать ~5 ₽/час; наш COGS-преимущество тает.

**План:**
1. **Реинвестируем падение COGS в feature-расширение:** Employee Clone, Decision Archaeologist, Process Narrator. Маржу удержим за счёт add-ons (≥85% GM на них).
2. **Не снижаем ARPU в SMB** — фиксируем 1 800-2 400 ₽/seat, потому что наш value — не «минута транскрипта», а «Knowledge Core + dashboard».
3. **Снижение цены = больше встреч в одну тарифу** = большее использование Knowledge Core = больше lock-in.

### Риск 3: Резкое падение spend на корпоративный софт в РФ

**Вероятность:** 30-40% при ухудшении макроэкономики.

**Удар:** SMB-сегмент сжимается, чеки урезаются.

**План:**
1. **Усиление каналов B2G** — гос. сектор более стабильный бюджет в кризис.
2. **«Ужатые» тарифы:** Pro Lite за 990 ₽/seat (= mymeet) для удержания low-end.
3. **Длинные годовые контракты со скидкой 20%** — фиксируем revenue вперёд.

### Риск 4: Регуляторный шок (например, запрет хранения вне РФ облака, ужесточение КИИ)

**Вероятность:** 60% частичных ужесточений за 24 мес.

**Удар:** Selectel/SberCloud не хватит, нужно срочно on-prem; стоимость комплаенса растёт.

**План:**
1. **Архитектура изначально multi-cloud + on-prem** (см. CLAUDE.md — переключаемые endpoints). Уже частично сделано.
2. **Реестр Минцифры — сдать в Q1 2026** (срок реалистичный, юрист от 800K ₽).
3. **ФСТЭК-аттестация для on-prem версии — Q3 2026.** Открывает B2G и КИИ.
4. **DPO + 152-ФЗ compliance auditor** — обязательно с M6.

---

## Вопрос 8. УРОВЕНЬ ИНВЕСТИЦИЙ

### Раунды

#### Lean (≈900M ₽ на 24 мес)

- **R&D:** 350M (15-18 инженеров, 1-2 AI-резёрчер, продакт)
- **GTM:** 280M (10-12 чел: 2 marketing, 6 SDR/AE, 2 content/SEO, 2 RevOps)
- **CS:** 60M (4-6 CSM, 1 head)
- **Infra:** 140M (компьют, GPU, S3)
- **G&A:** 70M (юрист, DPO, бух, HR, офис)
- **Team к M24:** 50-60 чел.
- **Ожидаемый MRR к M24:** ~300-400M ₽/мес (≤50% от цели). Lean не вытягивает 700M.

#### Base (≈1.8 млрд ₽ на 24 мес) — **рекомендация**

| Категория | Бюджет 24 мес | % | Содержание |
|---|---|---|---|
| **R&D** | 630M | 35% | 25 инженеров + 3 AI-research + 3 PM + 2 дизайнера + 2 SecOps + 2 DevOps |
| **GTM (sales + marketing)** | 685M | 38% | 22 чел: 5 marketing (perf + content + SEO + brand), 12 sales (4 SDR + 4 AE Mid + 2 AE Ent + 2 RevOps), 3 BDR/Partner. Плюс performance-бюджет 250M (Yandex/VK Ads/Telegram/events) |
| **Customer Success** | 180M | 10% | 12 CSM (4 SMB, 6 Mid, 2 Ent), 1 head, 2 onboarding-инженера, in-app guides |
| **Infra (compute + GPU + S3 + LLM)** | 215M | 12% | масштабирование с ~2M/мес на M1 до ~25M/мес на M24 |
| **G&A** | 90M | 5% | юрист (комплаенс, реестр, договоры), DPO, бух/финдир, HR, офис |
| **ИТОГО** | **1 800M ₽** | 100% | |

**Команда к M24:** 95-110 чел. Runway: с M1 burn ~50M/мес, к M24 ~110M/мес. Self-sustainable примерно с M22.

**Ожидаемый MRR к M24:** 700M ₽/мес (целевой).

#### Aggressive (≈3.0 млрд ₽ на 24 мес)

- **R&D:** 950M (полная команда 35 инженеров + 5 AI-research + 5 PM)
- **GTM:** 1 200M (40 чел в sales+marketing, расширенный perfomance до 500M)
- **CS:** 300M (25 CSM + сильный onboarding)
- **Infra:** 400M (запас на 50K+ Org)
- **G&A:** 150M (международная экспансия SNG, в т.ч. Казахстан/Беларусь)
- **Team к M24:** 150-180 чел.
- **Ожидаемый MRR к M24:** ~900M-1.1B ₽/мес (если рынок принимает), но риск over-hiring при затягивании sales cycle.

### Вывод

**Базовый раунд 1.8 млрд ₽ — оптимальный.** Lean не вытягивает цель, Aggressive — лишний риск over-spend. CEO задавал бюджет GTM 50-200M — это покрывает только GTM-часть base-раунда; остальное (R&D, Infra, CS) — в общем 1.8B бюджете.

---

## Мнения, по которым ожидаю спор с коллегами

### 1. «NO FREEMIUM» — спорно с CMO

CMO почти наверняка скажет: «без freemium в SaaS PLG не работает, мы потеряем top-of-funnel и виральность». Моя позиция: **РФ-рынок ≠ США-рынок**, и в РФ корпоративном AI freemium даёт 90% не-целевую аудиторию (студенты, разовые юзеры) и убивает COGS на heavy-users. **Solo Lite (1 встреча/нед)** — это компромисс: не «production freemium», а маркетинговый виральный канал. Я готов уступить на «free 3 встречи/мес» только если CMO покажет, что конверсия trial→paid падает ниже 20% без freemium.

### 2. «ENTERPRISE-HEAVY (вариант В) — слишком рискован, выбираем Hybrid»

CTO/CEO могут предпочесть Enterprise-heavy (меньше клиентов, больше чек, лучше юнит). Моя позиция: **enterprise sales cycle 6-12 мес — мы не успеем достичь 100 Enterprise за 24 мес.** Hybrid даёт диверсификацию и быстрые wins в SMB-канале для денежного потока. Если Sentra/Viven с $35M+ заявленным сделали по 2-5 enterprise клиентов за год — нам с бюджетом 1.8B рассчитывать на 100 ent за 24 мес нереалистично.

### 3. «LTV = ARPU × 12 — это оптимистичная верхняя граница, а не базовая»

CEO задал LTV=ARPU×12. Я считаю это **верхним пределом, а не базой**. В консервативном сценарии LTV ≈ ARPU × 20 net × GM, но это означает gross churn 5%/мес — что выше нашего 8.3% target. Реалистично: net retention compensate-ит, но **в первые 6-12 мес LTV/CAC по Mid будет ниже 2×** и это нормально для start-up. Не нужно «душить» CAC до плохих ROI ради формальной красивой цифры — нужно инвестировать в expansion (add-ons) и принимать LTV/CAC<2 на горизонте M0-M12.

### 4. «GIGACHAT ENTERPRISE — НЕ убийца Z, а партнёрский канал»

Маркетинг скорее всего поставит Сбер в TOP-1 угрозу. Моя позиция: **Сбер — это distribution channel, а не only-конкурент**. Их Salute-стек — горизонтальная платформа без 9 типов встреч, без Knowledge Graph, без Employee Clone. Мы можем (а) интегрироваться с GigaChat через LlmRouter (уже можно), (б) предлагать Z как product-layer поверх GigaChat-API для тех, кто хочет «не reinvent the wheel в LLM». Стратегия: ровно как Granola поверх Zoom/Meet/Teams (paid layer), мы — поверх любого LLM, включая GigaChat.

### 5. «Add-on packs — это не сейчас, а только с M12+. Не строим план на ещё неготовом продукте»

Часть команды (CTO/Product) могут возразить: Employee Clone — Ф12 Knowledge Core, ETA Q3-Q4 2026; Decision Archaeologist — даже не в ТЗ. Моя позиция: **add-ons — это +30-50% к ARPU и без них 700M недостижим математически.** Если Employee Clone не будет к M18 — нам нужен план Б: ускорить Ф12 через приоритет, либо ввести **«облегчённые» add-ons раньше** (например, «Compliance Pack» на основе уже готовых retention/audit-фич Z можно продавать с M3). Я готов пересмотреть тайминги, но не отказаться от add-ons как принципа.

---

_Документ подготовлен CCO виртуальной команды CEO Z. Дата: 2026-05-20. Версия: round-2 финал._
