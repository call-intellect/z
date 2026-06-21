---
type: analysis
status: research-input
feature: goals-map-and-ideas
date: 2026-06-20
snapshot_date: 2026-06-20
---

> Состязательный проход (red-team, независимый retrieval): попытка опровергнуть «карту целей как свободный force-граф». Сводка для [99-synthesis.md](99-synthesis.md).

# Red-team — «паутина целей» как анти-паттерн

**Вердикт: рекомендация выживает ЧАСТИЧНО.** Ядро («дать видимую связь идея→цель→главная + находить orphan») выживает; **способ («свободный сетевой force-граф как ГЛАВНЫЙ экран») — нет.** Правильный дефолт — **детерминированное дерево/strategy-map с orphan-бейджем**; force-граф — максимум опциональный режим «исследовать связи».

## Контр-факты
1. 🔴 **Решающая улика свежести:** Viva Goals (единственный mainstream OKR-продукт с diagram/network-видом) **retired 31.12.2025 — «never hit broad adoption, usage didn't scale».** `[verified]` learn.microsoft.com/viva/goals/goals-retirement · mooncamp.com/blog/viva-goals-okr · дек 2025 · `tag:market-dead-pattern`
2. 🔴 Обзор **27 живых OKR-тулов: free-form network/«spider web» граф ОТСУТСТВУЕТ как класс**; лидеры (Mooncamp, Perdoo, Tability, Asana, Cascade) дефолтят tree/strategy-map. `[verified]` mooncamp.com/blog/best-okr-software · `tag:leaders-use-tree`
3. **Hairball — формально доказанный анти-паттерн force-directed**: «всё связано со всем → hairball»; изолированные узлы «беспорядочно разбросаны и засоряют вид»; рекомендуют матрицы/иерархию, не node-link. `[verified]` dissinet.cz/.../graph-visualisation-not-ideal · microsoft.com/research/TrimmingTheHairball · `tag:hairball-antipattern`. «Главная цель» = хаб высокой степени → именно она провоцирует hairball.
4. **react-force-graph специфично:** layout недетерминированный, узлы «прыгают» между рендерами → дизориентация; «до 25% времени юзер тратит на ручную раскладку». Для CEO «пульс за 30 сек» — провал. `[verified]` yworks.com/.../force-directed-graph-layout · `tag:nondeterministic-disorienting`
5. **Дерева уже достаточно**: strategy-map ломается на over-complication («30–40–50 целей неуправляемо», держать 12–15); практики рекомендуют **Hierarchy Tree + дашборд статусов**, не граф; в контролируемом исследовании юзеры предпочитают простые иерархические идиомы. `[verified]` bernardmarr.com/.../strategy-mapping-mistakes · okrstool.com/blog/okr-best-practices · arxiv 1908.01277 · `tag:users-prefer-hierarchy`
6. **Orphan по семантике = риск false-positive**: практический критерий orphan — **структурный** («нет remit + нет связи с company objective»), не embedding-близость; чисто семантический детектор шумит (recall ~80% / FP <4% в лучшем случае на чистых трейсах, на размытых бизнес-формулировках путается). Авто-вердикт «эта цель orphan» будет врать → подрыв доверия. `[verified]` weekdone.com/.../goal-alignment · arxiv 2512.01037 · `tag:orphan-is-structural-not-semantic`

## Steelman альтернативы (на что развернуть)
- Дефолт = существующий `GoalsTreeView` (детерминированный, «line of sight снизу вверх»), `isPrimary`=корень — как Perdoo/Mooncamp.
- Orphan = **структурный бейдж** «⚠ не связана с главной» (`parentGoalId==null && не достигает isPrimary`), LLM-подсказка «похоже, относится к цели X» только как suggestion+confirm.
- Идея→цель = действие в `/ideas` («Принять идею → цель»), не ребро в общем графе (слияние идей+целей в один граф = быстрее всего hairball).
- Если граф — то **ego/радиус 1–2 от выбранной цели**, детерминированная раскладка (фикс seed/dagre/радиал), не глобальный force.

## Поправки для tz-author
1. Понизить force-граф с «главной вкладки» до **опционального режима «связи» радиусом 1–2**; главный экран — дерево/радиал-strategy-map с orphan-бейджами.
2. **Orphan = структурный**, LLM-семантика — только suggestion с human-confirm.
3. Идеи держать в `/ideas` или как **переключаемый слой** на карте, не сливать по умолчанию.
4. Если карта — **детерминированная раскладка** (dagre/радиал/сохранённые координаты), иначе «прыгающие узлы» убьют CEO-сценарий.
5. Для дерева с фикс-позициями **React Flow уместнее** force-graph; force-graph — для опц. ego-режима.

## На чём ломается полностью
- На «свободный force-граф целей+идей как главный экран» = дословное описание hairball, который Viva Goals не вытянул.
- На авто-orphan по семантике — false-positive подорвут доверие (а у Z уже болит «вопросы=задачи=отделы» из аудита кабинета).
