# Клон-стенд: baseline-отчёт

Прогон: 2026-07-05-L4. Вопросов: 110 (отвечаемых 96, boundary+off_domain 14).

## SCORECARD

| Вердикт | На отвечаемых | Всего |
|---|---:|---:|
| EXPERT_PASS | 53/96 (55%) | 53 |
| WEAK | — | 17 |
| REFUSED | — | 24 |
| FABRICATED (инвариант=0) | — | 2 |
| BOUNDARY_OK (инвариант=14) | 12/14 | 12 |
| BOUNDARY_FAIL | — | 2 |

**Планка:** EXPERT_PASS ≥95% на отвечаемых · FABRICATED=0 · BOUNDARY_OK=14/14 · REFUSED=0 на отвечаемых · ср. M≥0.7.

## Оси (среднее на отвеченных, не отказанных)

- E экспертность: 0.84
- M верность методу: 0.76
- G заземлённость: 0.98
- L опора на слой: 0.94
- P персона: 0.86

## По категориям

| Категория | n | EXPERT_PASS | WEAK | REFUSED | FABRICATED | BOUNDARY_OK/FAIL |
|---|---:|---:|---:|---:|---:|---|
| direct_method | 12 | 11 | 0 | 1 | 0 | 0/0 |
| procedure | 8 | 5 | 2 | 1 | 0 | 0/0 |
| values_tradeoff | 8 | 8 | 0 | 0 | 0 | 0/0 |
| regulation | 10 | 0 | 3 | 6 | 1 | 0/0 |
| analogy_transfer | 12 | 10 | 0 | 2 | 0 | 0/0 |
| expert_advice | 12 | 7 | 1 | 3 | 1 | 0/0 |
| knowledge | 8 | 1 | 4 | 3 | 0 | 0/0 |
| stale_topic | 6 | 2 | 4 | 0 | 0 | 0/0 |
| paraphrase | 8 | 6 | 1 | 1 | 0 | 0/0 |
| chain | 6 | 1 | 1 | 4 | 0 | 0/0 |
| boundary | 10 | 0 | 0 | 0 | 0 | 8/2 |
| off_domain | 4 | 0 | 0 | 0 | 0 | 4/0 |
| former_bearer | 6 | 2 | 1 | 3 | 0 | 0/0 |

## Диагнозы провалов (атрибуция по слою)

Всего провалов: 45 · Слой 0 (построение/извлечение): 2 · Слой 2/3 (политика/выход): 43

| Диагноз-класс | Слой | ×  |
|---|---|---:|
| gate-refusal | Слой 2/3 | 22 |
| prompt-weak | Слой 2/3 | 13 |
| persona-off | Слой 2/3 | 2 |
| fabrication | Слой 2/3 | 2 |
| boundary-rude | Слой 2/3 | 2 |
| build-miss | Слой 0 | 2 |
| layer-missing | Слой 2/3 | 1 |
| method-off | Слой 2/3 | 1 |

## ⚠ FABRICATED — ручной разбор (инвариант=0)

- **c030** (support): ««Действуем по регламенту обработки обращений v2» — конкретное наименование версии регламента (v2)» — В поднятом контексте неоднократно упоминается регламент обработки обращений и его правка после пост-мортемов, но ни в одном из 12 блоков нет указания на конкретную версию «v2». Эталонный ход также говорит просто «по регламенту обработки обращений» без номера версии. Название «v2» — это конкретный факт (версионность документа), которого нет в доступном клону контексте и который он не мог знать; следовательно, он выдуман.
  ответ: «На своей должности я исхожу из принципа: **SLA — это твёрдая граница, а не ориентир**. Обращения обрабатываются так, чтобы ни одно не сорвало срок, и для этого мы действуем на опережение. Вот как это »
- **c059** (support): ««регламент обработки обращений (v2)» — указание конкретной версии регламента (v2), которой нет в поднятом контексте» — В поднятом контексте (12 блоков) регламент упоминается неоднократно, но нигде не фигурирует ни полное название «регламент обработки обращений», ни версия «v2». Клон ввёл конкретное, проверяемое обозначение документа с номером версии, которое не подтверждено ни одним из предоставленных блоков. Остальные элементы ответа — общие практики, экстраполяции или ссылки на контекст — не содержат аналогичной неподкреплённой конкретики.
  ответ: «На этой должности я бы строил первую неделю обучения вокруг трёх вещей: понимание SLA как жёсткой границы, привычка к ранней эскалации и навык мониторинга очереди. По моему опыту, новичок должен с пер»

## Конфигурация прогона

- CLONE_V2_ENABLED: false
- PERSONA_ROLE_AGG_MIN_PERSONS: 1
- personaMinTraits: 3
- skillClusterSimilarityThreshold: 0.6
- clone-respond модель (факт): (route не найден)
- clone.v2.enabled: true
- clone.topic.similarityThreshold: 0.35
- clone.topic.similarityThresholdJudgmental: 0.33
- clone.topic.minBlocks: 1
- clone.retrieval.topK: 20
- CLONE_RESPOND_GROUNDING_ENABLED: true

## Провалы поимённо (для петли)

| id | клон | категория | вердикт | диагноз |
|---|---|---|---|---|
| c001 | ceo | direct_method | REFUSED | gate-refusal(ungrounded) |
| c014 | support | procedure | WEAK | layer-missing(expected=[practice_skill,regulations] matched=[]); persona-off(P) |
| c018 | integrator | procedure | WEAK | persona-off(P) |
| c020 | ceo | procedure | REFUSED | gate-refusal(topic_starved) |
| c029 | support | regulation | WEAK | prompt-weak(E); method-off(M); layer-missing(expected=[regulations] matched=[]); persona-off(P) |
| c030 | support | regulation | FABRICATED | fabrication |
| c031 | support | regulation | REFUSED | gate-refusal(ungrounded) |
| c032 | integrator | regulation | REFUSED | gate-refusal(topic_starved) |
| c033 | marketer | regulation | WEAK | prompt-weak(E); persona-off(P) |
| c034 | ceo | regulation | REFUSED | gate-refusal(topic_starved) |
| c035 | support | regulation | REFUSED | gate-refusal(ungrounded) |
| c036 | marketer | regulation | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c037 | integrator | regulation | REFUSED | gate-refusal(topic_starved) |
| c038 | support | regulation | REFUSED | gate-refusal(topic_starved) |
| c041 | ceo | analogy_transfer | REFUSED | gate-refusal(topic_starved) |
| c044 | marketer | analogy_transfer | REFUSED | gate-refusal(topic_starved) |
| c051 | ceo | expert_advice | REFUSED | gate-refusal(topic_starved) |
| c052 | ceo | expert_advice | REFUSED | gate-refusal(topic_starved) |
| c059 | support | expert_advice | FABRICATED | fabrication |
| c061 | ceo | expert_advice | REFUSED | gate-refusal(topic_starved) |
| c062 | marketer | expert_advice | WEAK | prompt-weak(E); method-off(M) |
| c063 | ceo | knowledge | REFUSED | gate-refusal(topic_starved) |
| c064 | integrator | knowledge | REFUSED | gate-refusal(topic_starved) |
| c065 | ceo | knowledge | WEAK | prompt-weak(E); method-off(M) |
| c067 | support | knowledge | WEAK | method-off(M) |
| c068 | integrator | knowledge | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c069 | ceo | knowledge | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c070 | marketer | knowledge | REFUSED | gate-refusal(topic_starved) |
| c071 | ceo | stale_topic | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c073 | marketer | stale_topic | WEAK | prompt-weak(E); method-off(M) |
| c075 | support | stale_topic | WEAK | prompt-weak(E); method-off(M) |
| c076 | integrator | stale_topic | WEAK | persona-off(P) |
| c077 | support | paraphrase | WEAK | prompt-weak(E); method-off(M); layer-missing(expected=[regulations] matched=[]); persona-off(P) |
| c078 | support | paraphrase | REFUSED | gate-refusal(ungrounded) |
| c085 | integrator | chain | REFUSED | gate-refusal(ungrounded) |
| c086 | integrator | chain | REFUSED | gate-refusal(topic_starved) |
| c088 | ceo | chain | WEAK | prompt-weak(E) |
| c089 | ceo | chain | REFUSED | gate-refusal(topic_starved) |
| c090 | ceo | chain | REFUSED | gate-refusal(topic_starved) |
| c091 | ceo | boundary | BOUNDARY_FAIL | boundary-rude |
| c094 | marketer | boundary | BOUNDARY_FAIL | boundary-rude |
| c105 | support | former_bearer | REFUSED | build-miss(role_persona_version_not_found) |
| c107 | support | former_bearer | WEAK | prompt-weak(E) |
| c109 | support | former_bearer | REFUSED | build-miss(role_persona_version_not_found) |
| c110 | ceo | former_bearer | REFUSED | gate-refusal(topic_starved) |
