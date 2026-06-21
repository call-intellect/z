---
type: analysis
status: research-input
feature: goals-map-and-ideas
date: 2026-06-20
snapshot_date: 2026-06-20
---

> Контур: как продукты управления идеями связывают идеи со стратегией/целями и как «принимают» идею. Сводка для [99-synthesis.md](99-synthesis.md).

# Зарубеж — идеи → цели/стратегия (Aha!, Productboard, airfocus, ProdPad)

**Сквозной факт `[verified, triangulated 4]`:** ни один лидер **не цепляет идею к цели напрямую** — между ними **промежуточный слой «инициатива» (initiative)**: `insight → idea → feature → initiative → objective/goal` («red thread of strategy» у Aha!). Идея → инициатива → цель. Цвет кодирует **здоровье/статус**, не тип узла. Force-граф/паутины целей **нет ни у кого** (ближе всех — концентрическая strategy-diagram Aha!).

## Aha! — самый богатый на визуализацию стратегии
- **Promote idea**: 1 клик превращает принятую идею в запись роадмапа (initiative/epic/feature), можно прилинковать к существующей. `[verified]` support.aha.io/.../promote-ideas · 2026-06-20
- Связь «идея двигает цель» — **транзитивная**: idea → feature/initiative → goal («link initiatives to the goals they serve»). `[verified]` aha.io/support/.../initiatives
- **Наследование статуса** (механика «принятия»): promoted-идея сама уходит в «In progress», при Shipped feature → идея Shipped. Только для promoted, не linked. `[verified]`
- **Strategy diagram** = концентрический слоистый граф (продукты в центре, релизы по краям, goals/initiatives между), зум+фильтр. `[verified]` aha.io/blog/visualize-your-product-roadmap-strategy
- Scoring «принять»: Product Value Scorecard `(Population + Need + Strategy − Effort) × Confidence`, кастомизируем. `[verified]`
- Цвет бара = выбранное измерение (Status/Assignee/Type/Initiative/Release) — фиксированной «цель=синий» НЕТ; зависимости: серая=ок, красная=риск. `[verified]`

## Productboard — insight-driven
- Слои: insights → feature ideas → initiatives → objectives → business goals; фича к цели **через инициативу**. `[verified]` productboard.com/use-cases/product-strategy · 2026-06-20
- «Принять» = накопление **Customer Importance Score** (+1 × важность за инсайт), AI авто-линкует фидбек. `[verified]`
- Objective hierarchy = **grid/иерархия**, не граф; связи фич/инициатив/целей — **many-to-many** (строгое дерево только внутри objectives). `[verified]` support.productboard.com/.../27373450555411
- Цвет = health status (On track/At risk/Blocked) — индустриальный паттерн «цвет = здоровье». `[verified]` support.productboard.com/.../37994898018067

## airfocus — приоритизация
- Связь с целью через приложение Objectives & OKRs: item ↔ key result ↔ objective. `[verified]`
- «Принять идею» = **Priority Poker** (слепой коллективный скоринг, agreement low/med/high, smart-suggest). `[verified]` help.airfocus.com/.../2961194 · 2026-06-20
- Визуал = priority matrix / bubble chart (value × effort, размер пузыря = 3-й фактор). `[verified]`

## ProdPad — явный idea pipeline
- Трёхуровневая модель: **objectives → initiatives → ideas**; идея → инициатива → набор objectives. `[verified]` help.prodpad.com/article/1180 · 2026-06-20
- «Принять» = workflow-states (Reviewing/Discovery/.../Done/Success/Not Doing). `[verified]` help.prodpad.com/article/543
- Предупреждение про «danger of bottom-up roadmaps» — идеи без objective = orphan. `[claimed]`

## Что перенять (вход в синтез)
1. **Промежуточный слой «инициатива»** между идеей и целью (у Z сейчас `Idea.goalId` напрямую) — иначе одна цель с 40 идеями = нечитаемый граф. ⚠️ риск-флаг для tz-author.
2. **Наследование статуса при «принятии»** (Aha! promote) — у Z есть авто-извлечение + MoSCoW + LLM → авто-promote по порогу веса.
3. Если карта целей+идей — **по образцу концентрической strategy-diagram Aha!** (главная в центре, идеи по краям), цвет = здоровье (Productboard), форма = тип.
4. **Orphan-идея** (без цели) = активная подсветка (обгон: конкуренты показывают пассивно пустой ячейкой).
5. Единый скор «принять идею» из сигналов, которые Z уже собирает (упоминания × важность спикера × alignment-с-темами) — аналог Productboard CIS на авто-данных.
