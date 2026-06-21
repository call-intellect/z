---
type: analysis
status: research-input
feature: goals-map-and-ideas
date: 2026-06-20
snapshot_date: 2026-06-20
---

> Контур: методология — что есть здоровая карта целей, как определить orphan, сколько уровней. Сводка для [99-synthesis.md](99-synthesis.md).

# Методология карты целей (6 фреймворков)

**Сквозной вывод `[verified, triangulated 6]`:** все 6 методологий — варианты одного объекта: **направленный ацикличный граф (DAG)**, где каждый узел обязан вести стрелкой вверх к корню; **узел без такой стрелки = orphan**. Различаются формой (слои/дерево/матрица/радиал) и тем, что в узле (цель/метрика/поведение).

## 1. Balanced Scorecard «Strategy Map» (Kaplan/Norton)
- 4 слоя снизу вверх: Обучение/рост → Процессы → Клиенты → Финансы; стрелки причинности снизу вверх. `[verified]` balancedscorecard.org · 2026-06-20
- Дисциплина «**оспаривай каждую стрелку**»: связь без защитимой логики удаляется → orphan = цель без защитимой стрелки. `[verified]` umbrex.com/.../strategy-map-kaplan-norton
- **Здоровый размер: 12–20 целей; >25 или плотное перекрёстное связывание → теряется ясность.** `[verified]`

## 2. OKR: alignment vs cascading
- Cascading (жёсткий каскад) **хрупок**: смена KR ломает всё дерево; низы превращают цель в чек-лист. `[verified]` caroli.org/cascading-okrs-dont-work · 2026-06-20
- Alignment (рекомендуемо): верх задаёт топ-OKR, команды сами связывают. `[verified]` tability.io/okrs/cascading-vs-aligning-okrs
- **OKR lineage**: у каждой OKR обязан быть родитель → командная OKR без родителя **мгновенно видна как orphan**. `[verified]` jeffgothelf.com/.../okr-lineage
- **Misalignment — единственная главная причина провала OKR** (OKR Institute, 1000+ орг.); индивидуальный уровень — где выравнивание чаще всего бросают. Лечит **видимость всем**. `[verified]` synergita.com/blog/overcoming-misalignment
- Стандарт глубины: **3 уровня** (компания → команды → личный). `[verified]`
- Цвет: RAG зелёный 0.7–1.0 / янтарь 0.4–0.6 / красный 0.0–0.3. `[verified]` leapsome.com/blog/okr-scoring

## 3. North Star + metric tree (Amplitude)
- North Star наверху, 3–5 input-метрик «лестницей» ведут к ней (Breadth/Depth/Frequency/Efficiency); связи **математические** (output=f(inputs)). `[verified]` amplitude.com/blog/product-north-star-metric · 2026-06-20
- Orphan = input-метрика, которая по факту не двигает North Star (ложная гипотеза).

## 4. Impact Mapping (Gojko Adzic)
- Радиальная mind-map от центра: **Goal → Actors → Impacts (поведение, не фичи) → Deliverables**. `[verified]` gojko.net/books/impact-mapping · buildd.co/product/impact-mapping
- Каждый узел обязан вести вверх к цели → **ветка, не связанная с целью, визуально очевидна для удаления** (метод вычистки orphan). `[verified]` amplitude.com/blog/impact-map

## 5. Goal Tree / Theory of Constraints (Goldratt/Dettmer)
- Goal → 3–5 Critical Success Factors → дерево Necessary Conditions; логика «чтобы X, ОБЯЗАНЫ иметь Y». `[verified]` tocinstitute.org · hohmannchris.wordpress.com · 2026-06-20
- Goal Tree **стабилен 5–10 лет** (vs OKR, что переписывают ежеквартально). `[verified]`

## 6. Hoshin Kanri X-matrix
- 4 квадранта + сетки корреляции точками; **цель без поддержки = строка без точек, тактика без цели = столбец без точек** (= orphan в матричной проекции). `[verified]` fourweekmba.com/hoshin-kanri-x-matrix · 2026-06-20
- Жёсткое правило: «команда обязана выкинуть цель, что вряд ли двигает видение». `[verified]`

## Техника (методология → стек Z)
- `[verified]` react-force-graph (уже стоит) имеет **dagMode**: td/bu/lr/rl/radialout/radialin; уровень узла = топологически `max(предки)+1`, координата = `level × dagLevelDistance`. deepwiki.com/vasturiano/react-force-graph/6.2-dag-layouts · 2026-06-20
- **onDagError** → готовый детектор циклических зависимостей целей.
- **dagNodeFilter** → orphan-узлы «не назначаются на уровни и свободно плавают» = бесплатный визуальный сигнал «цель висит».

## Что перенять (вход в синтез)
1. **Orphan = структурный критерий** «нет стрелки вверх к isPrimary» (OKR lineage + Impact + X-matrix), НЕ семантическая близость.
2. Лимиты из методологии: глубина **~3 уровня** (или цепочка horizon), ≤ **12–20 целей на экран** (BSC), иначе теряется ясность.
3. RAG-статус цвета (зелёный/янтарь/красный по прогрессу KR).
4. На ingest — под-шаг «оспорь стрелку»: LLM проверяет, что `parentGoalId` логически необходим, слабую связь — на подтверждение владельцу (suggestion, не авто).
