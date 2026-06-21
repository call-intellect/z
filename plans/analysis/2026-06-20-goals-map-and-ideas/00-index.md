---
type: analysis
status: research-complete
feature: goals-map-and-ideas
date: 2026-06-20
snapshot_date: 2026-06-20
owner: Сергей (владелец продукта)
related:
  - second-brain/01_projects/goals-and-strategic-alignment.md
  - second-brain/01_projects/ideas.md
  - plans/tz/2026-06-05-goal-vector-compass.md
  - plans/tz/2026-06-05-goals-improvements.md
  - plans/archive/2026-06-02-goals-okr-v2.md
---

> Карта файлов исследования «Карта целей + идеи». Главный документ для tz-author → **[99-synthesis.md](99-synthesis.md)** (`status: research-complete`).

# Индекс исследования — Карта целей + идеи (паутина)

## Вопрос владельца (дословно, распакован)
1. Найти всё про цели (глобальная / на неделю / спринт / на ближайшее время) — **как задумано** и **как реализовано сейчас**.
2. Ключ: цели должны **доставаться из разговоров**, не только вручную.
3. Отдельная вкладка **«Карта целей» — паутина**: главная цель + остальные, как соединяются, ведут ли к главной, или висят несвязанными (orphan).
4. **Идеи** (от сотрудников/руководителя) — совместить с целями на одной карте, разными цветами; решение «принять идею → стала целью».
5. Сходить в интернет, найти лучшее решение и **доказать, почему оно лучше**.

## Воронка достаточности (охват → глубина)
- Внешних кандидатов разобрано: **зарубеж 12** (Cascade, Perdoo, Quantive, Viva Goals, Mooncamp, WorkBoard, Tability, Weekdone + Aha!, Productboard, airfocus, ProdPad) · **РФ 11** (ELMA365, Я.Трекер, Goalton, Weeek, Битрикс24, Платрум, Goodt, Аспро.Cloud, Yonote, Pyrus, «4И»/краудсорсинг) · **методологий 6** (BSC strategy map, OKR alignment/cascade, North Star metric tree, Impact Mapping, Goal Tree/TOC, Hoshin X-matrix) · **граф-библиотек 6** (React Flow/@xyflow, react-force-graph, Cytoscape, vis-network, ELK/dagre, reagraph).
- Отобрано для teardown: ~10 ключевых. Стоп fan-out: новые источники перестали двигать gap-таблицу и матрицу вариантов.
- Baseline по нашему коду: vexp недоступен → 4 Explore-агента (backend-модель, frontend-UI, фича «идеи», документация) + ручное чтение ТЗ-B/ТЗ-F/`goals-and-strategic-alignment.md`/`ForceGraphCanvas.tsx`.

## Файлы
| Файл | Контур | Статус |
|---|---|---|
| [99-synthesis.md](99-synthesis.md) | Синтез: рамка, ландшафт, gap-таблица, матрица, рекомендация, развилки | research-complete |
| [01-foreign-okr-alignment-viz.md](01-foreign-okr-alignment-viz.md) | Зарубеж: как OKR-платформы рисуют выравнивание/orphan | research-input |
| [02-ideas-to-goals.md](02-ideas-to-goals.md) | Зарубеж: идеи→инициативы→цели, «принять идею» | research-input |
| [03-methodology-strategy-map.md](03-methodology-strategy-map.md) | Методология: что есть здоровая карта, orphan, уровни | research-input |
| [04-ru-analogs.md](04-ru-analogs.md) | РФ: цели/OKR/идеи и их визуализация | research-input |
| [05-graph-tech.md](05-graph-tech.md) | Техника: React Flow vs react-force-graph vs Cytoscape | research-input |
| [06-redteam-challenge.md](06-redteam-challenge.md) | Состязательный проход: «паутина = мёртвый паттерн» | research-input |

> Сырые отчёты fan-out — в транскрипте Workflow run `wf_1bc2f997-c2e` (6 агентов, 157 поисков, 2026-06-20).
