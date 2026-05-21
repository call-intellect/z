---
status: final
date: 2026-05-20
role: ARBITER (CTO + VP Product perspective)
horizon: 24 месяца
input: round-2 CPO + CSO + STRATEGY + round-1 product-reality + plans-digest
goal: 700 млн ₽/мес ARR за 24 мес; разрешить конфликты roadmap / on-prem / vertical SKU / knowledge-core priority
---

# Round 3 — Debate 3: Roadmap, On-Prem, Vertical SKU (АРБИТР)

> Роль: нейтральный арбитр с двойной перспективой CTO (что технически выполнимо при 12 FTE и 150М ₽) и VP Product (что строим первым, чтобы продавалось). Документ выносит **окончательные** решения по 4 конфликтам и оформляет их в roadmap 24 мес.
>
> Принцип арбитража: если CPO и CSO расходятся — побеждает тот, чья позиция убирает риск №1 для цели 700М ₽/мес. Если оба правы по своим критериям — ищем компромисс через **последовательность** (что раньше, что позже), а не через половинчатое исполнение.

---

## РАЗРЕШЕНИЕ КОНФЛИКТОВ

### Конфликт А — Q1 2026 P0 (CPO «фичи» vs CSO «стабильность+compliance»)

**Позиции:**
- CPO: 9 фич сразу (Decision + valid_from + Stylistic + Bitrix + amo + Я.Календарь + Sales-preset + PLG + Egress fix).
- CSO: интеграции + 152-ФЗ DPA + Реестр Минцифры подача + Security Whitepaper + стабильность.

**Конфликт реальный:** при 12 FTE и 13 рабочих недель Q1 невозможно выпустить и CPO-набор, и CSO-набор. Нужно резать. Резать стабильность нельзя (Egress треск в проде = NPS-катастрофа, **запрет на sales-кампанию** до фикса). Резать compliance тоже нельзя — без 152-ФЗ DPA и подачи в Реестр enterprise pipeline стартует с задержкой 6-9 мес (срок рассмотрения реестра).

**Решение арбитра:** позиция CSO имеет приоритет в Q1, но не как «вместо», а как «**параллельно и первым по очереди**».

**Логика:** Q1 — это **подготовка пускового стенда**, а не запуск продукта. Sales-кампания невозможна без (а) стабильного прода (Egress fix), (б) compliance-пакета (иначе первая же ent-встреча сорвётся на security questionnaire), (в) подачи в Реестр (часы тикают). PLG-маховик и большая часть CPO-набора переезжают в Q2 — это не критично, потому что без compliance в Q1 он бы и не закрыл первых ent-клиентов.

Из CPO-набора в Q1 остаются **только те фичи, без которых нельзя продемонстрировать «Z = больше чем AI-нотакер»**: Decision class + valid_from (это unlock для Employee Clone-нарратива в продажах, без них нет history-аргумента) и Bitrix24 read+write (без этого Sales-narrative бессодержателен — у 35-40% SMB РФ Bitrix).

amoCRM, Stylistic profile, Я.Календарь, Sales-preset, In-product upgrade — **Q2**.

**Финальный P0 Q1 — 7 задач (см. раздел 4).**

---

### Конфликт Б — On-prem тайминг (CPO M16-M18 vs CSO «нужен сейчас» vs Strategy «Q2-Q3 2027 + "да" с M3»)

**Позиции:**
- CPO: GA on-prem Q3 2027 (M16-M18). Раньше — продукт сырой, поддержка дорогая.
- CSO: enterprise pipeline нужен с Q1, on-prem с Q2.
- Strategy: GA on-prem Q2-Q3 2027, но **обещать enterprise lead «да, on-prem будет к Q4 2027» уже с M3**.

**Что объективно блокирует ранний on-prem:**
1. Knowledge Core Phase 11 (RLS на БД, multi-tenant изоляция, materialized views) — не готов до Q3 2026.
2. Deployment automation (Ansible/Helm/Compose-bundle) — не существует, 6 нед инженерной работы.
3. Документация инсталляции, runbook для DevOps клиента — отсутствует.
4. Локальный LLM-стек (T-Pro/Qwen через vLLM + GigaAM локально) — не тестировался под нагрузкой.
5. Команда поддержки on-prem — некому в первый год отвечать на инциденты в 3 ночи у клиента.

**Что критично, если ждём до M18:** теряем enterprise pipeline. CSO правильно говорит — без on-prem-narrative ent-AE приходит на встречу с пустыми руками. **180 млн ₽/мес от mega-Enterprise** в декомпозиции 700М ₽ — это on-prem-выручка по определению.

**Решение арбитра:** трёхуровневая on-prem стратегия.

| Этап | Месяц | Что происходит |
|---|---|---|
| **Уровень 0 — Roadmap commitment** | M1 (Q1 2026) | Z официально публикует roadmap on-prem GA Q4 2027. Sales говорит ent-lead «да, on-prem **подписываем уже сейчас**, разворачиваем в Q4 2027, до того — dedicated cloud в РФ-юрисдикции» |
| **Уровень 1 — Dedicated single-tenant cloud** | M6 (Q2 2026) | Изолированный namespace для ent-клиента в нашем облаке (Selectel/SberCloud), отдельные ключи, отдельный S3-бакет, отдельная БД-инстанция. Это **не on-prem**, но юридически и архитектурно изолировано. Sales продаёт это как «private cloud, с переездом на on-prem при GA» |
| **Уровень 2 — Pilot on-prem** | M12 (Q4 2026) | Первый закрытый pilot on-prem у 1-2 design partners (МКБ-уровень, не Сбер). Pilot — оплаченный, 8 нед, с правом отказаться. Z запускает Deployment Engineer (1 FTE на M9) |
| **Уровень 3 — Closed beta on-prem** | M15 (Q5 2027) | 3-5 ent-клиентов on-prem, ручная поддержка, цена со скидкой 30-40% за «спасибо за пилот» |
| **Уровень 4 — GA on-prem** | M18 (Q6 2027) | Открытая продажа, Helm-chart + Ansible-playbook, runbook, 24/7 SLA, обучение DevOps клиента |

**Что говорим enterprise lead в Q2:**
> «On-prem GA — Q4 2027 (через 12-15 мес). До того — **private cloud в РФ-юрисдикции**: ваш отдельный инстанс на изолированной инфре, отдельный шифровальный ключ, отдельная БД, FZ-152 DPA подписан, реестр Минцифры в процессе. Можем подписать **rate-lock и pre-order on-prem уже сейчас** — это гарантирует приоритет в pilot и фиксированную лицензионную ставку 2027 года.»

Это даёт:
- CSO ent-pipeline стартует с Q2 (закрытие через private cloud + on-prem pre-order).
- CPO не строит сырой on-prem в Q1-Q2.
- Strategy получает «да» к ent-lead с M3 (через rate-lock + private cloud + roadmap commitment).

**Цена on-prem:**
- Лицензия: 6-8 млн ₽/год за пакет 100 чел; 12-18 млн ₽/год за 100-500 чел; от 24 млн ₽/год за 500+. (Подтверждаю предложение CPO с поправкой вверх на 20-30% — корпоративы платят больше, дешёвая цена обесценивает.)
- Развёртывание: 2-4 млн ₽ единовременно (вкл. обучение DevOps клиента).
- Поддержка: 20% от лицензии/год (24/7 SLA, named TAM при пакетах от 500 seat).
- Кастомизация: 12-18 тыс ₽/час.
- **Минимальный пакет on-prem: single-Org, 100 seats, 8 млн ₽/год + 2 млн ₽ deploy + 1.6 млн ₽/год поддержки = ~11.6 млн ₽ Year-1, ~9.6 млн ₽ Year-2+.**
- Multi-tenant on-prem (несколько Org в одной инсталляции, например, ГК с дочками) — отдельный пакет «Enterprise Group» от 25 млн ₽/год.

**Стек on-prem (фиксирую):**
- LiveKit Server (OSS, host networking, отдельный TURN-нод).
- PostgreSQL 16 + pgvector (или Patroni для HA при пакетах 500+).
- MinIO (S3-совместимый).
- Redis Sentinel + BullMQ.
- GigaAM v3 (ASR, OSS, бесплатно для коммерции).
- T-Pro 32B (Apache 2.0) или Qwen 2.5 32B через vLLM (GPU-нода A100/A6000).
- OPA + Casbin (policy).
- Prometheus + Grafana + Loki (мониторинг + логи).
- Optional: прокси к GigaChat/Claude через anonymization layer (только для non-sensitive контента, ABAC-фильтр).

---

### Конфликт В — Vertical SKU «Z for Sales» (CPO «не нужен 12 мес» vs CSO «нужен sales-narrative с M1» vs Strategy «SKU M12-M15»)

**Позиции:**
- CPO: Sales-preset как часть horizontal в Q1, отдельный SKU не нужен в первые 12 мес.
- CSO: нужен sales-narrative с дня 1 — лендинг /sales + outbound playbook, но не обязательно отдельный SKU.
- Strategy: «Z for Sales» как отдельный SKU M12-M15 (для multiple-кратного pricing, vertical multiple ×3-5).

**Решение арбитра:** **последовательность** — Sales-narrative и preset с M1 (CSO + CPO согласны), **отдельный SKU с отдельным pricing M12** (Strategy), **второй vertical SKU M18**.

**Логика последовательности:**

| Месяц | Sales-positioning | Что новое |
|---|---|---|
| M1-M3 | Sales-preset в horizontal продукте (5 типов sales-встреч: discovery/demo/negotiation/closing/QBR). Лендинг /sales. Outbound playbook. Bitrix24-интеграция в Q1. | preset + лендинг + Bitrix |
| M4-M6 | amoCRM-интеграция. Decision Archaeologist (alpha) для «почему сделка X слили». Sales-cases в маркетинге. | amoCRM + Decision Archaeologist |
| M7-M9 | Sales-вертикальный дашборд (pipeline + deal risk + stakeholder map) в Org-Admin. Co-marketing с amoCRM/Bitrix. | sales-dashboard widgets |
| **M10-M12** | **Запуск «Z for Sales» как отдельного SKU**: отдельный pricing (8-12 тыс ₽/seat/мес vs 4-6 тыс ₽ horizontal), отдельный pricing page, отдельный sales motion, BANT/MEDDIC/SPIN-фреймы в промптах, win/loss-analysis, deal health-score. | SKU launch |
| M13-M18 | Партнёрство в маркетплейсах amoCRM + Bitrix24 + Listing на vc.ru. | distribution |
| **M18-M21** | **Запуск второго vertical SKU — «Z for HR»** (candidate_screening + candidate_interview + employee_1on1 + performance_review + exit_interview). Цель: M&A-нарратив для talent intelligence. | HR SKU |
| M22-M24 | Третий vertical SKU — НЕ запускаем за 24 мес (см. «Что не делаем»). |

**Что в «Z for Sales» отличается от horizontal:**

| Аспект | Horizontal | Z for Sales |
|---|---|---|
| Типы встреч | 9 базовых | 14 (+5 sales: discovery, demo, negotiation, closing, QBR) |
| Шаблоны отчётов | универсальные | под фреймы (BANT/MEDDIC/SPIN/Challenger), Deal Risk Flag, Next-Step List, Stakeholder Map |
| Интеграции базовые | Я.Календарь, Bitrix24-сделки (минимум) | Bitrix24 + amoCRM + Salesforce-RU full bidirectional (sync сделок, заметок, событий), Telegram (для деловой переписки) |
| Дашборд | Director Dashboard generic | Sales Dashboard: pipeline + win-rate + cycle-time + churn-risk + open deals + open quotes |
| AI-агенты | Decision Archaeologist (общий) | Decision Archaeologist для сделок + Deal Coach (LLM-наставник по записанному разговору) |
| Pricing | 4 000-6 000 ₽/seat/мес | 8 000-12 000 ₽/seat/мес (vertical multiple x2) |
| Sales motion | PLG + inside | Inside + outbound через amoCRM/Bitrix-partner network |
| ICP | широкий | B2B-команды продаж 5-200 чел |

**Почему именно «Z for Sales» как №1 vertical SKU:**
1. **CMO в debate-2** подтвердил Sales как ICP №1.
2. **Готовый ROI-нарратив**: «сделка пропала, не нашли upsell, не зафиксировали обещание» = деньги.
3. **CRM-интеграции уже в Q1-Q2 roadmap** (Bitrix + amoCRM) — фундамент.
4. **Vertical multiple** на Sales-SaaS в РФ исторически 2-3x (Salesforce-аналоги: amoCRM 1.5-2 тыс ₽/seat, RetailCRM 3-4 тыс ₽/seat; Z for Sales может взять 8-12 тыс ₽/seat как premium AI-layer).
5. **Decagon-precedent**: Sales-vertical SaaS на AI в US — multiple ×37 (1.5B на 40M ARR).

**Vertical SKU №2 — «Z for HR» (M18-M21):**
- Типы: candidate_screening (15 мин), candidate_interview (60-90 мин), employee_1on1 (30 мин), performance_review (45 мин), exit_interview (60-90 мин, **отдельный SKU value-add — knowledge handover в граф**).
- Шаблоны: Scorecard (DISC, OCEAN), Hiring Decision, Risk Flag (exit signals), Development Plan.
- Интеграции: 1С ЗУП, HH.ru API, Хантфлоу.
- Pricing: 6-10 тыс ₽/seat/мес.
- Killer feature: **exit_interview → personal subgraph extraction** для Employee Clone preserve.

**Vertical SKU №3 — НЕ запускаем за 24 мес.** Causes (см. секцию «Что не делаем»): Consulting рынок узкий (3-5К компаний в РФ), Legal/M&A требует ФСТЭК для серьёзных сделок и pilot-цикл 9+ мес, R&D — оставляем в horizontal.

---

### Конфликт Г — Что строим из Knowledge Core фаз 5-12 (приоритезация)

10 кандидатов: Фазы 5/6/7/8/9/10/11/12 + Decision class + valid_from + Stylistic profile.

**Решение арбитра — три волны.**

#### Волна 1 — М1-М6 (фундамент unlock-нарратива)
1. **Decision class (gap)** — 1-2 нед — unlock Employee Clone storyline.
2. **valid_from/valid_to (gap)** — 2 нед — unlock «вид графа на момент X» = unlock Compliance Agent + Employee Clone.
3. **Stylistic profile (gap)** — 3 нед — unlock «клон отвечает как Маша».
4. **Phase 5 (Card UI + rollup-v2 frontend)** — 4 нед — closes CRM-карточки visible (backend готов, frontend нет).
5. **Phase 7 Stage 1 (Z-Admin)** — 5 нед — visibility cost для нас, мандатно для biz ops.
6. **Phase 10a (Bitrix24 + amoCRM)** — 4+4=8 нед — sales-narrative.

#### Волна 2 — М7-М12 (visible value)
7. **Phase 6 (Chat v2 frontend, org-scope)** — 6 нед — RAG-поиск визуально доступен клиенту.
8. **Phase 7 Stage 2 (Org-Admin полный)** — 4 нед — клиент видит свежесть данных, ABAC-настройки.
9. **Phase 8 (Дашборд директора)** — 5 нед — pulse за 30 сек (главная демо-фича).
10. **Phase 9 (Goals + Strategic Alignment)** — 4 нед — strategic positioning, продаём в C-level.
11. **Phase 10b (Telegram + Я.Почта)** — 6 нед — graph density x3.
12. **Decision Archaeologist alpha (часть Ф12)** — 3 нед — vertical Sales killer-demo.

#### Волна 3 — М13-М24 (advanced + scale)
13. **Phase 11 (RLS + materialized views + GraphQL)** — 6 нед — масштаб + RLS = подготовка к on-prem.
14. **Phase 10c (Я.Диск + TEAMLY + 1С ЗУП)** — 8+4+8=20 нед, спред по 18 мес.
15. **Phase 12a (Employee Clone MVP, closed beta)** — 8 нед — главный дифференциатор enterprise.
16. **Phase 12b (Process Narrator)** — 4 нед — onboarding/audit use case.
17. **Phase 12c (Decision Archaeologist GA)** — встроено в Sales SKU + добивка функционала.
18. **Phase 12d (Compliance Agent)** — 3 нед — DPO-нарратив, оборотные штрафы 152-ФЗ.

**Что НЕ делаем из Knowledge Core за 24 мес:**
- Phase 12 — Discovery Agent (поиск неочевидных связей) — value сложно объяснить, дорого.
- Phase 12 — Multi-agent orchestration — преждевременная сложность.
- Phase 12 — Onboarding Agent отдельный — встраиваем в Employee Clone.

---

## 1. ROADMAP 24 МЕС — финальная поквартальная таблица

Допущения: 12 FTE R&D (3 FE, 4 BE, 2 AI/ML, 1 DevOps, 1 QA, 1 PM/SE), ставка ~800 тыс ₽/FTE-мес (нагруженная). Бюджет R&D ~150 млн ₽ за 24 мес (~120 М ФОТ + 30 М инфра/AI-API/инструменты). Healthy tax (тех. долг) — 20% capacity в Q1-Q2, 15% дальше.

### Q1 2026 (M1-M3) — «Foundation: стабильность + compliance + sales narrative»

| Колонка | Содержание |
|---|---|
| **GA features** | Egress fix (P0). Decision class. valid_from/valid_to. Bitrix24 read+write. Sales-preset (5 типов: discovery/demo/negotiation/closing/QBR) — встроен в horizontal. Лендинг /sales. Compliance pack v1 (152-ФЗ DPA template, Security Whitepaper draft) |
| **Что снимает с продаж** | (а) Прод-риск Egress треска (запрет на sales до фикса). (б) Отсутствие 152-ФЗ DPA — закрывает любой ent-разговор на 1-м звонке. (в) Нет Bitrix24 — sales-narrative для 35-40% SMB РФ бессодержателен. (г) Decision class — без него Employee Clone-storyline в продажах нельзя рассказывать |
| **Зависимости** | Реестр Минцифры — подать на M2 (рассмотрение 6-9 мес, идти параллельно). Pen-test — заказ на M3 для исполнения M5-M6 |
| **FTE-вложение** | 4 BE × 3 мес (Decision + valid_from + Bitrix). 2 AI × 3 (Sales-preset промпты, Decision Archaeologist alpha-skeleton). 1 DevOps × 3 (Egress fix + capacity tuning + private cloud isolation prep). 1 FE × 3 (Phase 5 Card UI старт). 1 QA × 3. 1 PM × 3. Healthy tax 20% (Egress + v1/v2 deprecation план) |
| **Метрика успеха** | Egress 0 incidents/100 встреч. 152-ФЗ DPA подписан с ≥3 lead-аккаунтами. Bitrix24-интеграция в production у ≥10 SMB. Sales-preset покрывает ≥80% sales-meetings без custom-prompt. ARR run-rate 15-20 млн ₽/год |

### Q2 2026 (M4-M6) — «PLG-маховик + frontend Knowledge Core старт»

| Колонка | Содержание |
|---|---|
| **GA features** | amoCRM read+write. Я.Календарь. Stylistic profile (alpha). Phase 5 Card UI + rollup-v2 frontend (GA). Phase 7 Stage 1 (Z-Admin: cost-dashboard, LLM-routes, A/B). In-product upgrade UI. Sharing report public link. Yookassa/СБП self-serve. Demo-meeting TTV 5 мин. Private cloud single-tenant (для ent-pilot). Pen-test pass + Security Whitepaper v1 GA |
| **Что снимает с продаж** | Self-serve checkout (без него SMB-конверсия trial→paid ≤2%). Public-link на отчёт (viral-cycle). PLG-маховик в принципе. Pen-test report — без него ент-security review провалится |
| **Зависимости** | Реестр Минцифры — продолжается рассмотрение. Stylistic profile зависит от Decision/valid_from (Q1). |
| **FTE-вложение** | 3 FE × 3 (Card UI + Z-Admin frontend + checkout UX). 3 BE × 3 (amoCRM + Я.Календарь + Stylistic profile + checkout/Yookassa). 2 AI × 3 (Decision Archaeologist alpha → beta). 1 DevOps × 3 (private cloud isolation + Pen-test fix). 1 QA + 1 PM. Healthy tax 20% (deprecation v1: transcript-index, card-rollup) |
| **Метрика успеха** | Trial→paid conversion ≥8% (SMB). Org self-creation w/o admin ≥95% success. ARR run-rate 50-80 млн ₽/год. Первый ent-pilot подписан (private cloud). 5+ reference-клиентов с правом на case study |

### Q3 2026 (M7-M9) — «Pulse + Goals + Consulting wedge»

| Колонка | Содержание |
|---|---|
| **GA features** | Phase 6 Chat v2 frontend (org-scope RAG). Phase 7 Stage 2 (Org-Admin полный). Phase 8 Дашборд директора (5 виджетов + AI-чат). Phase 9 Goals + Strategic Alignment. Telegram integration. Я.Почта Business integration. Decision Archaeologist (GA). Sales-preset промпты v2. Consulting-preset (4 типа: client_workshop / client_review / custdev_deep / advisory_session). Реестр Минцифры — ожидание решения / включение |
| **Что снимает с продаж** | (а) Дашборд директора — главная демо-фича для C-level («pulse 30 сек»). (б) Goals — strategic positioning, продаём в CFO/COO. (в) Telegram — главный мессенджер РФ корпоратив, без него граф полупустой. (г) Decision Archaeologist GA — killer-demo «почему сделку слили» |
| **Зависимости** | Phase 6 → Phase 8 (Chat → встроен в Dashboard). Phase 9 → Phase 8 (Goals → Alignment widget на Dashboard) |
| **FTE-вложение** | 3 FE × 3 (Chat v2 UI + Org-Admin + Dashboard widgets). 3 BE × 3 (Goals/alignment cron + Telegram TDLib + IMAP IDLE). 2 AI × 3 (Decision Archaeologist GA + Goals NLP). 1 DevOps × 3 (Phase 11 Stage 1: RLS prep, materialized views). 1 QA + 1 PM. Healthy tax 15% |
| **Метрика успеха** | NPS ≥40. Dashboard daily-active = 60% paid Orgs. Goals создано ≥1 в 70% Orgs с 10+ seats. ARR run-rate 200-280 млн ₽/год. 3 публичных enterprise-кейса (1 банк + 1 ритейл + 1 интегратор/консалтинг) |

### Q4 2026 (M10-M12) — «Employee Clone MVP + HR-segments + vertical SKU launch»

| Колонка | Содержание |
|---|---|
| **GA features** | **«Z for Sales» — launch как отдельный SKU** (separate pricing, BANT/MEDDIC/SPIN-фреймы, Deal Coach alpha). Employee Clone MVP (closed beta, 5-10 клиентов). HR-preset (5 типов: candidate_screening, candidate_interview, employee_1on1, performance_review, exit_interview). 1С ЗУП integration. VK Teams integration. Outlook integration. Phase 11 Stage 2 (GraphQL public API). Anonymization layer для cloud LLM. Pilot on-prem (1-2 design partners) |
| **Что снимает с продаж** | (а) **Z for Sales SKU** даёт vertical multiple pricing, 2× выручка на seat. (б) Employee Clone closed beta — главный дифференциатор для enterprise (Viven-level value). (в) Outlook — без него 30% крупных РФ не закроются. (г) GraphQL API — enterprise integrators (КРОК/Ланит) ждут |
| **Зависимости** | Employee Clone требует Decision (Q1) + valid_from (Q1) + Stylistic (Q2) + Phase 10b (Q3 — почта/мессенджеры). Pilot on-prem требует Phase 11 Stage 2 |
| **FTE-вложение** | 3 FE × 3 (Sales SKU UI + Clone UI + Phase 11 admin). 4 BE × 3 (1С ЗУП + VK Teams + Outlook + GraphQL + Anonymization). 2 AI × 3 (Employee Clone pipeline + Deal Coach). 1 DevOps × 3 (Pilot on-prem deployment, Helm-chart draft). 1 QA + 1 PM. Hire Deployment Engineer M11. Healthy tax 15% |
| **Метрика успеха** | ARR run-rate 500 млн ₽/год (~42 млн ₽/мес). Sales SKU — 15% от выручки в первый месяц. Clone beta NPS ≥50. Outlook-интеграция работает в ≥5 ent-аккаунтах. Реестр Минцифры — получение свидетельства |

### Q5 2027 (M13-M15) — «On-prem closed beta + R&D vertical preset»

| Колонка | Содержание |
|---|---|
| **GA features** | On-prem package (closed beta, 3-5 ent-клиентов, скидка 30%). R&D / Product preset (5 типов: sprint_planning / retro / demo / design_review / tech_design). Jira + YouTrack integration. GitHub/GitLab integration. Я.Диск integration. TEAMLY integration. Employee Clone (GA, открытая продажа). Process Narrator (GA). Phase 11 Stage 3 (full RLS + GraphQL public + multi-region read replicas). Compliance audit prep (ФСТЭК scope) |
| **Что снимает с продаж** | (а) On-prem closed beta снимает блок «нет on-prem = нет mega-Enterprise». (б) Employee Clone GA — открытая монетизация ($/clone-add-on). (в) R&D-preset для tech-команд (отдельный канал PLG через техсообщество). (г) Я.Диск + TEAMLY — wiki-канал для density графа |
| **Зависимости** | On-prem требует Phase 11 Stage 3 + Helm/Ansible (Q4) + Deployment Engineer (Q4). Employee Clone GA требует Stylistic v2 |
| **FTE-вложение** | 3 FE × 3 (Clone UI v2 + Process Narrator widget + R&D dashboard). 4 BE × 3 (Я.Диск + TEAMLY + Jira/YouTrack + GitHub + RLS + multi-region). 2 AI × 3 (Process Narrator + Clone GA + R&D-preset). 2 DevOps × 3 (on-prem deployment + Ansible/Helm + multi-region; hire DevOps #2 в M13). 1 QA + 1 PM. Healthy tax 15% |
| **Метрика успеха** | On-prem закрытая продажа 3-5 ent. ARR run-rate 1 млрд ₽/год (~85 млн ₽/мес). Sales SKU — 25% от выручки. Employee Clone — 10+ paid clones. ФСТЭК prep начат для одного key-account КИИ-клиента |

### Q6 2027 (M16-M18) — «On-prem GA + Compliance Agent + Enterprise scale»

| Колонка | Содержание |
|---|---|
| **GA features** | **On-prem GA (открытая продажа)**. Z Agents Pack (Employee Clone + Decision Archaeologist + Process Narrator) — отдельный enterprise add-on от 30 тыс ₽/мес базовый до 150 тыс ₽/мес со всеми компонентами. Compliance Agent (alpha). Legal preset (3 типа: legal_consultation / contract_review / mna_diligence). DocuSign integration. SSO для enterprise (SAML 2.0, OIDC). Multi-region deployment (RU-Central + RU-North) |
| **Что снимает с продаж** | (а) On-prem GA — открытая продажа всем ent-аккаунтам. (б) Z Agents Pack — отдельный pricing-tier (+30-50% к ent-чеку). (в) SSO — закрывает фрустрацию ИБ-комитетов крупных корпоратов. (г) Legal-preset для юр.фирм + DocuSign |
| **Зависимости** | On-prem GA требует closed beta success metric ≥80%. SSO требует RBAC v2 (есть с Q3) |
| **FTE-вложение** | 3 FE × 3 (Agents Pack UI + SSO config + Legal preset UI). 4 BE × 3 (Compliance Agent + DocuSign + SSO + multi-region tooling). 2 AI × 3 (Compliance Agent + Legal-preset). 2 DevOps × 3 (on-prem GA polish, runbook, customer training). 1 QA + 1 PM. Healthy tax 15% |
| **Метрика успеха** | On-prem — 8-12 ent-аккаунтов на лицензии. Agents Pack — 30+ paid add-ons. ARR run-rate 3.5-4 млрд ₽/год (~300-330 млн ₽/мес) |

### Q7 2027 (M19-M21) — «Vertical depth + HR SKU + B2G через интеграторов»

| Колонка | Содержание |
|---|---|
| **GA features** | **«Z for HR» — launch как отдельный SKU №2** (Scorecard / Hiring Decision / Development Plan + exit_interview → subgraph extraction). 1С Документооборот integration. Хантфлоу integration. HH.ru API. Compliance Agent (GA). Public API GA + webhooks v2. Marketplace интеграций (UI для self-built адаптеров — клиент сам пишет коннектор). B2G-канал через КРОК/Ланит запущен (первые 2-3 тендера в процессе) |
| **Что снимает с продаж** | (а) HR SKU открывает HR-канал + рекрутинговые агентства как отдельный ICP. (б) Public API + Marketplace — enterprise integrators наконец могут строить свои custom-адаптеры. (в) Compliance Agent GA — DPO/CISO-нарратив, 152-ФЗ оборотные штрафы. (г) B2G — minimal entry через тендеры под КРОК |
| **Зависимости** | HR SKU требует Phase 10c (1С ЗУП с Q4 2026). B2G канал требует Реестр Минцифры (Q4 2026) + опционально ФСТЭК scope (parallel) |
| **FTE-вложение** | 3 FE × 3 (HR SKU UI + Marketplace UI + API docs). 4 BE × 3 (HR-pipeline + 1С Документ + HH.ru + public API + webhooks v2). 2 AI × 3 (HR-фреймы + Compliance GA). 2 DevOps × 3 (Marketplace runtime sandbox). 1 QA + 1 PM. Healthy tax 15% |
| **Метрика успеха** | HR SKU — 15% от выручки в первый месяц. Public API — 10+ enterprise customers builds adapters. ARR run-rate 5-6 млрд ₽/год (~450-500 млн ₽/мес). 2 B2G-тендера выиграно через интеграторов |

### Q8 2027 (M22-M24) — «Расширение, оптимизация LTV, экзит-готовность»

| Колонка | Содержание |
|---|---|
| **GA features** | Vertical dashboards (5 верткалей) GA. Z Agents Pack v2 (orchestration: Clone + Decision Archaeologist в связке). Stylistic profile v2 (с voice opt-in). Memory consolidation (weekly/monthly LLM-распиловка фактов и противоречий, как в layer 8 11-слойной архитектуры). СНГ-релиз: Беларусь (M22), Казахстан (M24 alpha — казахский ASR через partnership). ФСТЭК-аттестация key компонента (для КИИ-клиента №1) |
| **Что снимает с продаж** | (а) Memory consolidation — закрывает «противоречия в графе» — частая жалоба после 6 мес использования. (б) СНГ-релиз — +50-70 млн ₽/мес TAM. (в) ФСТЭК-аттестация открывает КИИ-сегмент (банки топ-10, госкорпорации) |
| **Зависимости** | Memory consolidation требует Phase 11 (готов). ФСТЭК-аттестация запущена в Q5 для конкретного клиента |
| **FTE-вложение** | 3 FE × 3 (Vertical dashboards + Agents v2 UI + RU/Kaz UI). 4 BE × 3 (Memory consolidation cron + Stylistic v2 + СНГ-platform). 2 AI × 3 (Memory consolidation LLM-prompts + voice profiling). 2 DevOps × 3 (ФСТЭК-инфра + СНГ-региональные DC). 1 QA + 1 PM. Healthy tax 10% |
| **Метрика успеха** | **ARR run-rate 8.4 млрд ₽/год = 700 млн ₽/мес**. Gross margin >65%. NRR >115%. NPS >50. ФСТЭК-сертификат на ключевой компонент. Term sheet от стратега ИЛИ закрытый раунд B 1+ млрд ₽ |

### Сводная метрика по кварталам

| Q | M | New GA (главное) | MRR (млн ₽) | Активные Org | Доля Enterprise |
|---|---|---|---|---|---|
| Q1 | M1-M3 | Decision/valid_from + Bitrix + sales-preset | 5 | 30 | 0% |
| Q2 | M4-M6 | Phase 5 + Phase 7-1 + PLG-машина + amoCRM | 18 | 180 | 5% |
| Q3 | M7-M9 | Phase 6/8/9 + Telegram + Decision Archaeologist GA | 45 | 450 | 12% |
| Q4 | M10-M12 | Z for Sales SKU + Employee Clone beta + Pilot on-prem | 110 | 900 | 22% |
| Q5 | M13-M15 | On-prem closed beta + Process Narrator + R&D-preset | 220 | 1500 | 32% |
| Q6 | M16-M18 | **On-prem GA** + Z Agents Pack + Legal preset | 370 | 2100 | 42% |
| Q7 | M19-M21 | Z for HR SKU + Compliance Agent GA + B2G через КРОК | 550 | 2700 | 47% |
| Q8 | M22-M24 | Memory consolidation + СНГ + ФСТЭК | **750** | 3100 | **50%** |

---

## 2. ON-PREM РЕШЕНИЕ (финал)

- **M первого pilot on-prem:** M12 (Q4 2026), 1-2 design partner ent-клиента (МКБ-уровень, не Сбер). Оплаченный pilot 8 нед, цена 1.5-2 млн ₽ (зачёт в Year-1).
- **M GA on-prem:** M18 (Q6 2027). До этого — closed beta с M15 (3-5 ent-клиентов на скидке 30%).
- **Цена on-prem GA:**
  - Лицензия 6-8 млн ₽/год (100 seats), 12-18 млн ₽/год (100-500), от 24 млн ₽/год (500+).
  - Развёртывание 2-4 млн ₽ единовременно.
  - Поддержка 20% от лицензии/год.
  - Кастомизация 12-18 тыс ₽/час.
  - **Минимальный пакет: 11.6 млн ₽ Year-1 / 9.6 млн ₽ Year-2+** (single-Org, 100 seats).
- **Multi-tenant on-prem:** «Enterprise Group» пакет для ГК с дочками — от 25 млн ₽/год (несколько Org в одной инсталляции, общий граф + ABAC изоляция).
- **Стек on-prem:** LiveKit + PostgreSQL 16 + pgvector + MinIO + Redis + GigaAM v3 (OSS) + T-Pro 32B / Qwen 2.5 32B через vLLM + OPA/Casbin + Prometheus/Grafana/Loki.
- **Что говорим enterprise lead в Q2 (M4-M6):**
  > «On-prem GA — Q4 2027. До того — **private cloud в РФ-юрисдикции на нашей инфре**: ваш отдельный инстанс на изолированной площадке (Selectel/SberCloud), отдельный шифровальный ключ, отдельная БД, FZ-152 DPA подписан, реестр Минцифры в процессе. Можем подписать rate-lock и pre-order on-prem уже сейчас — это гарантирует приоритет в pilot Q4 2026 и фиксированную лицензионную ставку 2027 года.»
- **Минимальный пакет для on-prem GA:** single-Org, 100 seats. Multi-tenant on-prem — отдельный пакет.

---

## 3. VERTICAL SKU STRATEGY (финал)

**SKU №1 — «Z for Sales»** — launch M12 (Q4 2026).
- ICP: B2B-команды продаж 5-200 чел.
- Pricing: 8 000-12 000 ₽/seat/мес (vs 4-6 тыс horizontal).
- Отличия от horizontal: +5 sales-типов встреч; BANT/MEDDIC/SPIN/Challenger-фреймы в промптах; Deal Risk Flag, Next-Step List, Stakeholder Map в отчётах; Sales Dashboard (pipeline, win-rate, cycle-time, churn-risk); Bitrix24 + amoCRM + Salesforce-RU full bidirectional + Telegram; Decision Archaeologist для сделок + Deal Coach (alpha).
- Конкретные фичи: лендинг /sales (M1), Bitrix-интеграция (Q1), amoCRM (Q2), Decision Archaeologist alpha (Q2), Sales Dashboard (Q3), полный SKU (Q4).

**SKU №2 — «Z for HR»** — launch M21 (Q7 2027).
- ICP: HR-команды и рекрутинговые агентства 10-100 чел.
- Pricing: 6 000-10 000 ₽/seat/мес.
- Отличия: 5 HR-типов; Scorecard (DISC/OCEAN), Hiring Decision, Risk Flag (exit signals), Development Plan; 1С ЗУП + HH.ru + Хантфлоу; HR Dashboard (retention risk, open positions, scorecard summary).
- Killer-feature: exit_interview → personal subgraph extraction для Employee Clone preserve.

**SKU №3 НЕ запускаем за 24 мес.** Причины:
- **Consulting**: рынок узкий (3-5К компаний РФ), плохой TAM, остаётся в horizontal.
- **Legal/M&A**: требует ФСТЭК-аттестации для серьёзных сделок (готово к концу Q8), cycle 9+ мес.
- **R&D / Product**: основная команда продакт-менеджеров и так пользуется horizontal-набором (planning, retro, demo). Не оправдывает отдельный SKU.

**Когда НЕ делаем vertical SKU:** когда вертикаль (а) даёт <15% от выручки в первый квартал после ожидаемого запуска, ИЛИ (б) требует регуляторного барьера (ФСТЭК/КИИ) дороже 5 млн ₽, ИЛИ (в) рынок РФ <5К целевых компаний.

---

## 4. P0 ROADMAP Q1 2026 — финальный список 7 задач

| # | Задача | Назначение | ETA | Кто делает | Что разблокирует с продаж |
|---|---|---|---|---|---|
| 1 | **Egress fix (треск)** | Стабильность прода под нагрузку (60+ встреч одновременно) | 2 нед | DevOps + QA | Право запустить sales-кампанию. Без фикса один треск в важной встрече = катастрофа репутации |
| 2 | **Decision class first-class entity** | Decision как Entity, не label. Поля: alternatives, rationale, valid_from, status, consequences | 2 нед | 1 BE | Unlock Employee Clone-narrative в продажах. Без Decision клон = RAG. Также Sales-кейс «почему сделку слили» |
| 3 | **valid_from / valid_to на рёбрах** | Bitemporal модель: видим срез графа на момент X | 2 нед | 1 BE | Unlock Compliance Agent + Employee Clone preserve. Без valid_from нет «как было на момент ухода Маши» |
| 4 | **Bitrix24 интеграция (read + write, sales-сделки)** | OAuth + webhooks + bidirectional sync deals/notes/events | 4 нед | 1 BE + 1 FE | 35-40% SMB РФ на Bitrix. Без интеграции sales-narrative для SMB бессодержателен |
| 5 | **Sales-preset (5 типов встреч встроены в horizontal)** | Промпт-инжиниринг discovery/demo/negotiation/closing/QBR; шаблоны Deal Risk Flag, Next-Step, Stakeholder Map | 3 нед | 2 AI (prompt) + 1 BE (prompt-registry) | ICP №1 (B2B-продажи) — даёт sales-pitch конкретики. Без preset «AI-нотакер» = недифференцированный продукт |
| 6 | **152-ФЗ DPA template + Security Whitepaper v1 + Реестр Минцифры заявка** | Юр.документация для ent-разговора + подача в реестр (рассмотрение 6-9 мес) | 4 нед (юр.+тех.писатель) | Sales-engineering (1) + outside lawyer 0.5 FTE | (а) Без DPA любой ент-разговор стопорится на 1 звонке. (б) Реестр Минцифры окно закрывается, подаём СЕЙЧАС. (в) Whitepaper — must-have для tender |
| 7 | **Лендинг /sales + Outbound playbook + Demo-Meeting (TTV 5 мин)** | Маркетинг + sales-enablement + product-led activation | 3 нед | PM + Growth + 1 FE | Каждый ent-prospect в Q1-Q2 должен видеть сейлс-нарратив на /sales. Demo-Meeting срезает TTV с 25 мин до 5 → conversion x3 |

**Что НЕ в P0 Q1 (переезжает в Q2):** amoCRM, Stylistic profile, Я.Календарь, In-product upgrade UI, Sharing public link, Yookassa, Phase 5 Card UI frontend (хотя backend готов).

---

## 5. КОМПОНЕНТЫ EMPLOYEE CLONE — порядок

4 компонента: Stylistic profile + Personal subgraph + Voice profile + Permissions.

**Порядок построения:**

| Компонент | Когда | Обоснование порядка |
|---|---|---|
| **Permissions (ABAC расширение)** | M3 (Q1 2026) | Базовая инфра уже есть (RBAC + Casbin). Расширение под Clone (personal-scope ABAC) — 1-2 нед. Должно быть готово ДО Stylistic, иначе Stylistic построит профиль с нарушением privacy |
| **Stylistic profile** | M5-M6 (Q2 2026) | Зависит от Decision + valid_from (Q1). 3 нед на сбор паттернов (lexical, syntactic, decision-pattern, emotional). Это unlock для «клон отвечает в стиле человека» — главный sales-аргумент |
| **Personal subgraph extraction** | M11-M12 (Q4 2026) | Зависит от Phase 10b (Telegram + Я.Почта, Q3). Subgraph = всё, что человек писал/говорил/решал. Это база для Clone MVP в closed beta |
| **Voice profile (opt-in only)** | M22-M24 (Q8 2027) | Технически — TTS на клонированном голосе (через partnership с YandexSpeech/Sber). Не критично для MVP, но завершает «Clone v2». Этический сценарий: opt-in только с явного согласия employee + DPO + audit log при каждом озвучивании |

**Какие компоненты в Q4 (M12) — closed beta Employee Clone:** Permissions + Stylistic + Personal subgraph (без Voice). Это даёт текстового клона. Closed beta — 5-10 design partner ent-клиентов.

**Какие позже:** Voice profile (Q8 2027). Не в первые 18 мес — voice deepfake-риски + регуляторная неопределённость в РФ + ROI слабый (текстовый клон отвечает на 90% запросов).

---

## 6. ЧТО НЕ ДЕЛАЕМ за 24 мес (свернуть, ради фокуса)

| Что сворачиваем | Почему |
|---|---|
| **Discovery Agent (поиск неочевидных связей)** | Value сложно объяснить покупателю, дорогая разработка (LLM-prompts × cost), узкий use case |
| **Multi-agent orchestration v1** | Преждевременная сложность. Z Agents Pack v2 — это связка готовых агентов через простой router, не orchestration |
| **Onboarding Agent отдельным продуктом** | Встраиваем в Employee Clone как preset «curriculum-mode». Не отдельный SKU |
| **Vertical SKU №3 (Consulting/Legal/R&D)** | Consulting — TAM <5К компаний; Legal — требует ФСТЭК; R&D — оставляем в horizontal |
| **Slack / MS Teams интеграции** | Slack заблокирован в РФ; MS Teams импортозамещают принудительно. Тратить FTE — потеря фокуса |
| **Confluence / Notion интеграции** | Многие мигрируют на TEAMLY/Я.Wiki. TEAMLY интегрируем (Q5), Notion — нет |
| **Полноценный International release (US/EU)** | Санкции + регуляторный ров не работает за рубежом. СНГ (Беларусь, Казахстан) — да (Q8) |
| **iOS/Android native apps** | Web-PWA достаточно для MVP-фазы. Native — после M24, когда ARR-цель достигнута |
| **Чисто PLG-only sales-модель для enterprise** | Enterprise в РФ не покупают через self-serve без живого человека. Hybrid обязателен |
| **Бесплатный публичный MCP-сервер (Strategy ход 3)** | Хорошая идея, но не приоритет — distraction. Возвращаемся к ней при экзит-prep после M18 |
| **Покупка mymeet.ai (Strategy ход 2)** | Опционально, не закладываем — зависит от cash и от ARR-перфоманса mymeet к M9-M12 |
| **ФСТЭК-аттестация всего продукта** | Дорого (3-5 млн ₽), долго (6-9 мес). Делаем точечно — для key КИИ-клиента в Q8, на ключевой компонент |
| **iOS app для гостей** | Web-link достаточен для гостей. Бизнес-модель не страдает |
| **Native LLM-finetune на корпоративных данных клиента** | Слишком дорого технически, не окупается. Используем prompt-engineering + RAG, не finetune |
| **Workflow Automation (Zapier-like)** | Уход в сторону, не наш product. Marketplace интеграций (Q7) даёт минимум этой ценности |
| **Voice profile в первые 18 мес** | Этические + регуляторные риски + слабый ROI. После M18, opt-in only |

---

## 7. ТЕХ ДОЛГ И РИСКИ — план фикса

| Долг / риск | Приоритет | Когда фикс | Кто | Затраты |
|---|---|---|---|---|
| **Egress треск (production risk)** | P0 | Q1 (M1-M2) | DevOps + QA | 2 FTE-нед |
| **v1/v2 deprecation (transcript-index, card-rollup, meeting-analyze)** | P1 | Q2 (M4-M6) | 1 BE × 3 нед + миграция данных | 3 FTE-нед + ~1 нед DBA |
| **Decision class missing** | P0 | Q1 (M1-M2) | 1 BE | 2 FTE-нед |
| **valid_from / valid_to missing** | P0 | Q1 (M2-M3) | 1 BE | 2 FTE-нед |
| **Stylistic profile missing** | P1 | Q2 (M5-M6) | 1 BE + 1 AI | 3 FTE-нед |
| **LiveKit-webhooks могут приходить дважды** | P1 | Q1-Q2 (идемпотентность всюду) | 1 BE × 1 нед на review + точечные правки | 1-2 FTE-нед |
| **Capacity 80-100 одновременных встреч** | P2 | Q3 (M9) — оптимизация под 250+; Q5 (M15) — multi-region | DevOps | 4 FTE-нед суммарно |
| **Frontend Фаз 5-12 не готов** | P0 (распределённо) | Q1-Q3 (Phase 5/7-1/7-2/6/8/9 frontend) | 3 FE распределённо | 30+ FTE-нед |
| **Параллельные prompt-versions, prompt-registry без UI редактора** | P2 | Q3 (Phase 7-2 Org-Admin полный) | 1 FE + 1 BE | 4 FTE-нед |
| **host-networking LiveKit (1 под/ноду)** | P3 | Q5-Q6 при on-prem GA prep | DevOps | 3 FTE-нед |
| **Multi-region read replicas** | P2 | Q5 (M15) для on-prem closed beta | DevOps + BE | 6 FTE-нед |

**Healthy tax (общий бюджет тех. долга):** 20% инженерных мощностей в Q1-Q2 (Egress + Decision + valid_from + v1/v2 deprecation), 15% Q3-Q8.

**Что блокирует Decision class отсутствие:** Employee Clone storyline в продажах (без Decision → клон = RAG), Decision Archaeologist (нечего извлекать), Sales-кейс «почему сделку слили» (нет alternatives/rationale), Compliance forensic «кто принял решение X».

---

## 8. БЮДЖЕТ R&D — распределение 150 млн ₽ по 24 мес

| Категория | Бюджет (млн ₽) | Доля | Детализация |
|---|---|---|---|
| **Frontend (Phase 5-12 UI)** | 32 | 21% | 3 FE × 24 мес × ~450 тыс ₽/FTE-мес (с учётом нагрузки). Покрывает: Phase 5 UI, Z-Admin, Org-Admin, Chat v2, Dashboard, Goals, Clone UI, Sales SKU UI, HR SKU UI, Marketplace |
| **Backend (Decision, valid_from, Employee Clone, GraphQL, Phase 11)** | 45 | 30% | 4 BE × 24 мес × ~470 тыс ₽/FTE-мес. Покрывает: Decision/valid_from/Stylistic; Phase 10 интеграции (Bitrix/amoCRM/Telegram/Я.Почта/1С/Outlook/Я.Диск/TEAMLY/Jira/GitHub); Phase 11 RLS+GraphQL; Employee Clone pipeline; Memory consolidation |
| **AI/ML (агенты, prompt-engineering, finetune-prep)** | 22 | 15% | 2 AI × 24 мес × ~460 тыс ₽/FTE-мес. Покрывает: 5 vertical-пресетов (Sales, Consulting, HR, R&D, Legal), 4 агента (Clone, Decision Archaeologist, Process Narrator, Compliance Agent), Memory consolidation prompts, Voice profile prep |
| **DevOps / Infra** | 22 | 15% | 1 DevOps до M12, 2 DevOps M13+. Покрывает: Egress fix, capacity, private cloud isolation, on-prem deployment (Helm/Ansible/Compose), multi-region, ФСТЭК-инфра для key компонента |
| **Sales Engineering (POC, security questionnaire, custom-demo)** | 8 | 5% | 1 SE с M9 (рост до 2 к M18). Покрывает: ent-POC обвязку, security review responses, custom-prompt-tuning, demo-env подготовка |
| **QA + Test Automation** | 11 | 7% | 1 QA × 24 мес. Test automation для Knowledge Core pipeline (idempotency, regression на 9+ типов отчётов), load-testing capacity |
| **AI-API costs (Claude/GigaChat для разработки и тестов)** | 6 | 4% | Тестовые прогоны pipeline, A/B-эксперименты промптов, prompt-eval automation |
| **Инструменты + лицензии** | 4 | 3% | LiveKit Cloud (dev/staging), Sentry, observability stack, vLLM hosting (dev) |
| **Резерв на риски** | — | (вне 150М) | Покрывается из общего операционного бюджета (sales/marketing/admin), не из R&D |
| **ИТОГО R&D** | **150** | **100%** | |

**Что НЕ в R&D-бюджете 150М:** Sales team ФОТ (~500 млн ₽ за 24 мес, см. CSO round-2), Marketing (отдельный бюджет CMO), Compliance (юр.услуги + аудиты ~10 млн ₽, отдельная статья), Founder-led sales первых 5 ref-аккаунтов (CEO + CSO time, не R&D).

**Cost per FTE-мес (нагруженный, gross):**
- FE: ~450 тыс ₽
- BE: ~470 тыс ₽
- AI/ML: ~500 тыс ₽
- DevOps: ~480 тыс ₽
- QA: ~360 тыс ₽
- PM: ~450 тыс ₽

12 FTE × ~450 тыс средняя × 24 мес = ~130 млн ₽ ФОТ + 20 млн ₽ инфра/lic/AI-API = 150 млн ₽.

---

## 9. КРИТИЧЕСКИЕ ЗАВИСИМОСТИ И КОНТРОЛЬНЫЕ ТОЧКИ

**Критический путь к 700М ₽/мес:**

```
Q1 stability (Egress) + compliance (DPA, Реестр) + Decision/valid_from
  ↓
Q2 PLG-машина + Stylistic + Phase 5 UI + private cloud
  ↓
Q3 Dashboard + Goals + Decision Archaeologist GA → первые ent-кейсы публичные
  ↓
Q4 Sales SKU + Employee Clone beta + Pilot on-prem (M12 milestone)
  ↓
Q5 On-prem closed beta + Clone GA
  ↓
Q6 On-prem GA + Agents Pack (M18 hockey stick)
  ↓
Q7 HR SKU + B2G через КРОК
  ↓
Q8 СНГ + ФСТЭК + 700М ₽/мес
```

**Stage-gate чек-листы (если не прошли — пересмотр стратегии):**

- **M3:** Egress 0 incidents + DPA подписан с 3 lead + Bitrix у 10 SMB. Если нет → откладываем sales-кампанию.
- **M6:** Trial→paid ≥8% + Pen-test pass + первый ent private cloud pilot. Если нет → пересмотр PLG-машины, fallback на sales-led only.
- **M9:** 3 публичных enterprise-кейса + NPS ≥40. Если нет → проверяем product-market fit, возможно vertical pivot.
- **M12:** ARR 500 млн ₽/год + Sales SKU 15% выручки + Реестр Минцифры получен. Если нет → пересмотр SKU pricing.
- **M15:** On-prem closed beta 3-5 ent + Clone GA. Если нет → откладываем on-prem GA до M21.
- **M18:** ARR 4 млрд ₽/год (~330 млн ₽/мес). Если нет → hockey stick не сработал, переоцениваем экзит на M30+.
- **M24:** ARR 8.4 млрд ₽/год = 700 млн ₽/мес. Term sheet или раунд B.

---

## 10. ИТОГ АРБИТРА

1. **Q1 — позиция CSO (стабильность + compliance + intro-фичи).** Не «фичи vs compliance», а «compliance + минимум фич для sales-narrative».
2. **On-prem — компромисс Strategy.** Roadmap commit M1, private cloud M6, pilot M12, closed beta M15, GA M18.
3. **Vertical SKU — последовательность: preset в horizontal с M1, отдельный SKU с M12 (Sales), второй SKU M21 (HR), третий не запускаем.**
4. **Knowledge Core — три волны:** gap-фиксы (Decision/valid_from/Stylistic) и Phase 5/7-1 в M1-M6, основная видимая ценность (Phase 6/8/9 + интеграции + Decision Archaeologist) в M7-M12, advanced (Phase 11 + Phase 12 + on-prem-ready) в M13-M24.
5. **700М ₽/мес достижимо при условии:** прохождения всех stage-gate чек-листов, успеха sales-wedge в Q2, открытия on-prem GA в Q6, vertical multiple на Sales SKU с Q4.
6. **R&D-бюджет 150М ₽:** распределён 30% backend / 21% frontend / 15% AI / 15% DevOps / 7% QA / 5% SE / 4% AI-API / 3% инструменты.

Главный риск: **дефицит FTE.** При 12 R&D-инженерах roadmap натянут. Если M6 ARR <50 млн ₽/год — обоснован bridge-найм 2-3 BE/FE из cash burn rate. Если M12 ARR <300 млн ₽/год — пересмотр vertical SKU launch вниз по приоритету.

---

_Документ Round 3 Debate 3 — Roadmap & On-Prem & Vertical SKU. Арбитр (CTO + VP Product), 2026-05-20._
