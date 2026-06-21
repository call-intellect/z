---
type: analysis
status: research-input
feature: goals-map-and-ideas
date: 2026-06-20
snapshot_date: 2026-06-20
---

> Контур: как зарубежные OKR-платформы визуализируют выравнивание целей и orphan. Сводка для [99-synthesis.md](99-synthesis.md).

# Зарубеж — карты выравнивания целей (8 платформ)

**Сквозной факт `[verified, triangulated 5]`:** доминирует **детерминированное каскадное дерево** (родитель слева/сверху → дети правее/ниже), карта строится **автоматически из иерархии parent**, а не рисуется свободным force-графом. Свободный network-режим есть только у Mooncamp (как опция рядом с tree). Цвет узла = **здоровье/статус**, не тип. Orphan-логика реализована у зрелых (Cascade, Perdoo, WorkBoard) — самая ценная для Z часть.

## Cascade — Alignment Map (эталон orphan-логики)
- Две вкладки: Plans (дерево) и Objectives (карта связей), раскладка **слева-направо**, мини-карта-навигатор. `[verified]` support.cascade.app/view-the-alignment-of-your-objectives · 2026-06-20
- Три категории целей: **Aligned / Unaligned / Top-level**; невыровненные **не прячутся** — чекбокс **«Show Unaligned Plans»**. `[verified]`
- **Alignment score** = (Aligned-цели / все цели плана) × 100. `[verified]`
- Ловушка: приватный родитель → дети ложно выглядят unaligned (orphan из-за прав). `[verified]`
- Цвет = health-полоса (At risk/Behind/On track/Achieved/Not started/Not tracked); планы — красный 0–3.3 / оранж 3.4–6.6 / зелёный 6.7–10. `[verified]`

## Perdoo — Strategy Map (эталон «orphan скрыт, и почему»)
- Ultimate Goal → Strategic Pillars → company/department/team OKR (каскад). `[verified]` perdoo.com/solutions/superior-goal-management · 2026-06-20
- Невыровненная цель **НЕ появляется на Map** (кроме самой верхней cadence); Draft нельзя выровнять; опция «Skip» убирает цель с карты. `[verified]` support.perdoo.com/.../5191554 · 2026-06-20
- Противоположность Cascade: заставляет связать, иначе цель «невидима» (для команды Z в 30 чел. — плохо, цель «исчезает»).

## Quantive (ex-Gtmhub) — Alignment view (drag-drop точками)
- Поле выравнивания = «Parent»; один ребёнок = один родитель. `[verified]` help.quantive.com/.../8794862 · 2026-06-20
- UX связывания: тащишь **solid-dot источник → dashed-dot приёмник**, «mark to move» для дальних. `[verified]` help.quantive.com/.../1998387 · 2026-06-20
- Статусы on track / at risk / has issues (трёхцветка). `[verified]` capterra.com/p/156365 · 2026-06-20

## Microsoft Viva Goals — Chart View (⚠️ ПРОДУКТ ЗАКРЫТ)
- List / Quick view / **Chart View** (вложенное дерево, stacked card = есть KR, drill-down вниз). `[verified]` learn.microsoft.com/viva/goals/understanding-views · 2026-06-20
- **Multi-alignment**: цель на 2+ родителей, значок double-arrow. `[verified]` learn.microsoft.com/viva/goals/multiple-alignment
- 🔴 **Retired 31.12.2025 — «never hit broad adoption, usage didn't scale».** `[verified]` learn.microsoft.com/viva/goals/goals-retirement · дек 2025. → Единственный mainstream diagram/network-вид целей умер из-за провала adoption.

## Mooncamp — Goal Tree + Network (единственный с настоящим граф-режимом)
- Goal Tree как drawing board: drag-drop перевыравнивание, «соединяется автоматически», быстро видно **isolated (orphan) цели**. `[verified]` mooncamp.com/docs/goal-tree · 2026-06-20
- Виды сохраняются как table/list/**network**/tree — network есть, но **опциональный, не дефолт**. `[verified]` mooncamp.com/goals-and-okrs
- **Два независимых цветовых слоя**: status-светофор (red behind / yellow progressing / green on-track / **grey inactive**) ≠ progress-цвета (свои пороги в Settings). `[verified]` mooncamp.com/docs/goal-statuses

## WorkBoard — Strategy Tree (orphan как метрика динамики)
- Strategy tree → objectives → initiatives → работа в Jira; «drill down чтобы найти **disconnects и orphaned effort**», улучшение **период-к-периоду**. `[verified|claimed]` workboard.com/product/objectives.php · 2026-06-20

## Tability — Strategy Map (авто-карта из workspace)
- Карта строится **сама** из иерархии plan/sub-plan, «zero setup», обновляется при старте цикла, «легко найти misalignment». `[verified]` tability.io/features/strategy-map · 2026-06-20

## Weekdone — Hierarchy/Tree (child = KR родителя)
- Дочерний Objective считается как Key Result прогресса родителя (roll-up); unlimited linking. `[verified|claimed]` weekdone.com/resources/articles/what-is-okr-hierarchy · 2026-06-20

## Что перенять (вход в синтез)
1. Карта как **детерминированное дерево/радиал**, не свободный force.
2. **Orphan-детекция** = 3 категории Cascade + чекбокс «показать невыровненные» (не скрывать как Perdoo) + динамика период-к-период (WorkBoard).
3. **Два цветовых слоя** Mooncamp: тип (форма) ≠ статус (цвет RAG) ≠ inactive (серый).
4. Drag-drop перевыравнивание (Mooncamp + Quantive порт-точки) = минимальная правка `parentGoalId`.
5. **Единая карта идей+целей — нет ни у кого из 8** (все рисуют только цели) — белое пятно.
