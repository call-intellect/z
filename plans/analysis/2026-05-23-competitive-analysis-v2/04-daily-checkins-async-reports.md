---
type: analysis
status: research-input
segment: Daily standup / async check-ins / status reports + AI
date: 2026-05-23
parent: plans/analysis/2026-05-23-positioning-research-v2.md
agent-id: adaa9e98abf95c7c4
---

# Сегмент 4 — Daily standup / async check-ins + AI

## Главные открытия

1. **«Standup как standalone бизнес» — не растёт.** Friday.app закрылся в 2022. Geekbot, Standuply — bootstrapped на $1M ARR за 7+ лет. Range перестроился из standup в meeting management.
2. **Categories commodity**: $0 free → $2.50-6/user стандарт. Рост идёт через AI-add-on'ы.
3. **15Five + Kona AI Coach $29/manager** — самый дорогой AI-add-on в категории. Это **price-anchor для premium AI-функционала** ($29/manager × 12 мес = $348/manager/year только за AI).
4. **DailyBot 3 — first-mover в «AI-агенты в standup»** (агенты сами отчитываются о прогрессе и блокерах). Это явный сигнал тренда: рынок ждёт «не люди пишут стендап, а агенты».
5. **РФ — почти пусто.** Bitrix24 примитивен (Чекин = отметка прихода, Рабочие отчёты = текст начальнику без AI), Yandex Tracker без чек-инов, Telegram-боты open-source без AI/enterprise. Enji.ai (Бишкек) — единственный близкий аналог.
6. **В РФ нет ни одного AI-нативного чек-ин-продукта в реестре Минцифры.** 2-3 года окна.

## Главная рекомендация (от subagent — критично важная для positioning)

**Wedge B (ежедневные чек-ины) — не самостоятельный бизнес, а лучший ingest-канал.**

Продавать НЕ как «бот для чек-инов», а как «AI-COO, который читает чек-ины и видит компанию насквозь». Чек-ины — рутина с понятной ценой; AI-COO + двойник + дашборд CEO — премиум-надстройка, за которую рынок уже доказал готовность платить ($29/manager у 15Five-Kona).

**Подразумеваемая ценовая структура для РФ:**
- Core (чек-ины): 300-600 ₽/user/мес
- AI-COO add-on: 1500-3000 ₽/manager/мес
(якорь — Bitrix24 Pro + 15Five-Kona долларовое сопоставление)

## Зарубежные игроки (15)

| # | Компания | Цена | AI-фичи | Угроза | Близость |
|---|---|---|---|---|---|
| 1 | Range.co | Free 12 → $6-8/user | weekly саммари, auto-suggest, mood | низкая для РФ | средняя 40% |
| 2 | **Geekbot** | Free 10 → $2.50-6 | sentiment, blockers Sankey | низкая для РФ | **ближняя 65%** |
| 3 | **DailyBot** | Free → $3-5 + Enterprise | **AI-агенты DailyBot 3, GenAI саммари** | средняя глобально | **ближняя 60%** |
| 4 | Friday.app | МЁРТВ 2022 | — | — | — |
| 5 | Standuply | Free 3 → $5+ | базовые саммари | низкая | ближняя 60% |
| 6 | Spinach.ai | Free → $2.90/час → $19-29 | GenAI-саммари, Talk-to-Fireflies | средняя глобально | средняя 45% |
| 7 | Tability | $6-10/user | AI-retrospectives | низкая | средняя 35% |
| 8 | Status Hero / Steady | от $3 | ограниченно | низкая | ближняя 55% |
| 9 | Hypercontext | Free → $5.60 | AI follow-ups | низкая | дальняя 25% |
| 10 | **15Five** | $4-16 + **Kona AI $29/manager** | **Kona AI Coach — нудж менеджеру** | средняя глобально | средняя 40% |
| 11 | Lattice | $4-11+, min $4000/год | Lattice AI | низкая для РФ | дальняя 25% |
| 12 | Officevibe/Workleap | $5-6.25/user | AI-reporting, AI+ add-on | низкая | дальняя 20% |
| 13 | Mesh.ai | $4-10/user | AI-нуджи менеджеру | низкая | дальняя 25% |
| 14 | Hive | Free → $1-5+ | Buzz AI | низкая | дальняя 15% |
| 15 | Karbon (vertical accounting) | $59-99/user | Karbon AI | нулевая | дальняя 10% |

## Российские игроки (8) — фрагментация без лидера

| # | Компания | Категория | Чек-ины |
|---|---|---|---|
| R1 | **Битрикс24** | CRM/PM/портал | «Чекин» = геолокация прихода. «Рабочие отчёты» = текст начальнику. **Без AI-инсайтов.** |
| R2 | Яндекс Трекер | PM/Jira-like | Нет нативного daily check-in модуля |
| R3 | Shtab.app | PM + AI-агент + тайм | Тайм-трекинг и сводный отчёт, **без daily-check-in флоу** |
| R4 | Pyrus | Workflow/BPM + КЭДО | Отчёт эффективности, **без daily-check-in** |
| R5 | Kaiten | Kanban/PM | Нет нативного |
| R6 | WEEEK | Task manager | Нет |
| R7 | **Enji.ai** (Бишкек) | Engineering management + AI-агенты | **Async-стендап-бот в Slack/Teams/Telegram** — самостоятельная фича |
| R8 | Telegram-боты | Open-source/бесплатные | Pulse Bot, StandeeBot, Дина (dinabot.com), Standup-bot — **гигантский фрагментированный сегмент без лидера** |

## Куда движется рынок

- **Категория classic standup-bot стагнирует**, превращается в commodity.
- Рост в трёх направлениях:
  - **(a) AI-обогащение** саммари и блокеров (DailyBot 3, Tability, Lattice AI, Kona AI)
  - **(b) Поглощение** чек-инов более широкими HR-платформами (15Five, Lattice, Mesh.ai)
  - **(c) AI-агенты, которые сами отчитываются** (DailyBot 3 — first-mover)

## Реальные угрозы

- **DailyBot** — единственный с «AI-агенты в чек-инах + GenAI саммари + no-code workflows». Самый близкий к «memory layer».
- **Geekbot** — лидер install-base, дешевле всех; в РФ заходит только через Slack.
- **15Five + Kona AI** — единственные, кто превращает чек-ины в «нудж менеджеру через AI».
- В РФ напрямую — **никто.** Условный №1 — Bitrix24 (install-base), но его чек-ины примитивны.

## Insights для Коры

1. **Friday.app закрылся** → подтверждение, что чек-ин в одиночку — слабый wedge для standalone-бизнеса.
2. **Range перестроился из standup в meeting management** → одного standup-флоу мало для growth.
3. **DailyBot 3 — first-mover в AI-агентах в стендапе** → Кора может оседлать тренд (наши AI-агенты внутри уже архитектурно есть).
4. **15Five + Kona AI $29/manager** → конкретный price-anchor для AI-функционала.
5. **В РФ нет ни одного AI-нативного чек-ин-продукта в реестре Минцифры** → первый игрок может закрепиться без сильной конкуренции 2-3 года.
6. **Telegram-боты как канал ingest в РФ** — фрагментированный, но огромный сегмент культуры. Кора может стать «первым enterprise-grade продуктом» для этого культурного слоя.

## Sources

- [Range pricing](https://www.range.co/pricing)
- [Geekbot pricing](https://geekbot.com/pricing/), [$1M ARR bootstrapped](https://geekbot.com/blog/our-bootstrapped-journey-how-geekbot-went-from-zero-to-1m-arr/)
- [DailyBot pricing](https://www.dailybot.com/pricing/)
- [Friday.app shutting down](https://friday.app/p/shutting-down)
- [Standuply](https://standuply.com/)
- [Spinach.ai pricing](https://www.spinach.ai/pricing)
- [Tability pricing 2026](https://www.tability.io/pricing)
- [Status Hero / Steady](https://statushero.com/)
- [Hypercontext pricing](https://hypercontext.com/pricing)
- [15Five pricing and Kona AI](https://www.peoplebox.ai/blog/15five-review-pricing-alternatives/)
- [Lattice pricing](https://lattice.com/pricing)
- [Workleap/Officevibe pricing](https://workleap.com/pricing)
- [Mesh.ai pricing](https://www.mesh.ai/pricing)
- [Битрикс24 Чекин](https://helpdesk.bitrix24.ru/open/20922794/), [Рабочие отчёты](https://helpdesk.bitrix24.ru/open/17875598/)
- [Shtab.app](https://shtab.app/)
- [Pyrus отчёт](https://pyrus.com/ru/help/tasks/time-spent)
- [Pulse Bot Telegram](https://vc.ru/tribuna/126414-pulse-bot-besplatnyy-servis-dlya-udalennyh-stendap-mitingov)
- [Enji.ai async standup](https://docs.enji.ai/articles/asinhronnyy-stendap-instrument-dlya-obmena-informatsiey-vnutri-komandy/)
- [Telegram standup-bot GitHub](https://github.com/juliaknodel/standup-bot)
- [Softonit IT-отдел стендапы Telegram](https://softonit.ru/blog/articles/uit/standup-uit-telegram/)
