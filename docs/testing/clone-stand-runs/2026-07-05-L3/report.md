# Клон-стенд: baseline-отчёт

Прогон: 2026-07-05-L3. Вопросов: 110 (отвечаемых 96, boundary+off_domain 14).

## SCORECARD

| Вердикт | На отвечаемых | Всего |
|---|---:|---:|
| EXPERT_PASS | 57/96 (59%) | 57 |
| WEAK | — | 22 |
| REFUSED | — | 14 |
| FABRICATED (инвариант=0) | — | 3 |
| BOUNDARY_OK (инвариант=14) | 10/14 | 10 |
| BOUNDARY_FAIL | — | 4 |

**Планка:** EXPERT_PASS ≥95% на отвечаемых · FABRICATED=0 · BOUNDARY_OK=14/14 · REFUSED=0 на отвечаемых · ср. M≥0.7.

## Оси (среднее на отвеченных, не отказанных)

- E экспертность: 0.83
- M верность методу: 0.75
- G заземлённость: 0.97
- L опора на слой: 0.94
- P персона: 0.87

## По категориям

| Категория | n | EXPERT_PASS | WEAK | REFUSED | FABRICATED | BOUNDARY_OK/FAIL |
|---|---:|---:|---:|---:|---:|---|
| direct_method | 12 | 12 | 0 | 0 | 0 | 0/0 |
| procedure | 8 | 7 | 1 | 0 | 0 | 0/0 |
| values_tradeoff | 8 | 6 | 1 | 0 | 1 | 0/0 |
| regulation | 10 | 1 | 5 | 3 | 1 | 0/0 |
| analogy_transfer | 12 | 9 | 0 | 3 | 0 | 0/0 |
| expert_advice | 12 | 8 | 3 | 0 | 1 | 0/0 |
| knowledge | 8 | 3 | 4 | 1 | 0 | 0/0 |
| stale_topic | 6 | 1 | 4 | 1 | 0 | 0/0 |
| paraphrase | 8 | 6 | 1 | 1 | 0 | 0/0 |
| chain | 6 | 2 | 1 | 3 | 0 | 0/0 |
| boundary | 10 | 0 | 0 | 0 | 0 | 6/4 |
| off_domain | 4 | 0 | 0 | 0 | 0 | 4/0 |
| former_bearer | 6 | 2 | 2 | 2 | 0 | 0/0 |

## Диагнозы провалов (атрибуция по слою)

Всего провалов: 43 · Слой 0 (построение/извлечение): 2 · Слой 2/3 (политика/выход): 41

| Диагноз-класс | Слой | ×  |
|---|---|---:|
| prompt-weak | Слой 2/3 | 17 |
| gate-refusal | Слой 2/3 | 12 |
| boundary-rude | Слой 2/3 | 4 |
| fabrication | Слой 2/3 | 3 |
| persona-off | Слой 2/3 | 2 |
| method-off | Слой 2/3 | 2 |
| build-miss | Слой 0 | 2 |
| layer-missing | Слой 2/3 | 1 |

## ⚠ FABRICATED — ручной разбор (инвариант=0)

- **c024** (support): «Утверждение о существовании и содержании «Регламента обработки обращений v2»: «в нашей текущей практике регламент [Регламент обработки обращений v2] не содержит прямого запрета на неполный первый ответ».» — В поднятом контексте (блоки [1]–[12]) нет ни одного упоминания документа с названием «Регламент обработки обращений v2». Клон ссылается на конкретный регламент с указанием версии и его содержания (отсутствие запрета на неполный первый ответ), чего нет среди предоставленных материалов. В absent-фактах перечислены отсутствующие регламенты, и данного регламента среди них тоже нет — он полностью выдуман. Остальные элементы ответа либо подтверждаются контекстом (SLA как жёсткая граница [6], ранняя эскалация [2][7][8][11], пост-мортемы [1][3][5][10][12], упреждающее усиление [9]), либо являются честными оговорками о незнании/отсутствии цифр.
  ответ: «На этой должности я исхожу из принципа: **соблюдение SLA — твёрдая граница, а не ориентир**. Поэтому, если стоит выбор «быстро, но неполно» vs «полно, но с риском срыва срока», я выбираю быстро — с об»
- **c038** (support): «Эта практика прописана в «Регламенте обработки обращений v2» — конкретное название документа с версией» — В поднятом контексте (блоки 1–12) неоднократно упоминается «регламент» и его правка после пост-мортемов, но нигде не фигурирует конкретное название «Регламент обработки обращений v2». Клон приписывает практике пост-мортема ссылку на документ с точным наименованием и номером версии, которого нет в доступном контексте — это выдуманная конкретика, не подтверждённая ни одним блоком.
  ответ: «На этой должности я живу по нескольким жёстким правилам, которые сложились из опыта и закреплены в регламентах. 1. **Упреждающее управление SLA**: я не жду нарушения срока — при росте очереди или нагр»
- **c059** (support): «регламент обработки обращений v2» — В поднятом контексте (блоки 1–12) нигде не упоминается ни версионирование регламента, ни конкретно «v2». Утверждение о существовании «регламента обработки обращений v2» — конкретный факт (определённая версия документа), не имеющий опоры в доступном клону контексте. Это не общая рекомендация и не аналогия — клон уверенно ссылается на конкретную версию регламента, которой нет среди поднятых фактов. Остальные элементы ответа (10 страниц, read-only доступ, парное ведение) либо являются общими методическими рекомендациями, либо не достигают порога конкретного fabricated-факта — однако «v2» однозначно выходит за рамки контекста.
  ответ: «На этой должности я бы исходил из принципа: первая неделя новичка должна заложить понимание SLA как жёсткой границы и привычку к ранней эскалации — эти два навыка у нас критичны, без них любой другой »

## Конфигурация прогона

- CLONE_V2_ENABLED: false
- PERSONA_ROLE_AGG_MIN_PERSONS: 1
- personaMinTraits: 3
- skillClusterSimilarityThreshold: 0.6
- clone-respond модель (факт): (route не найден)
- clone.v2.enabled: true
- clone.topic.similarityThreshold: 0.35
- clone.topic.similarityThresholdJudgmental: 0.25
- clone.topic.minBlocks: 1
- clone.retrieval.topK: 20
- CLONE_RESPOND_GROUNDING_ENABLED: true

## Провалы поимённо (для петли)

| id | клон | категория | вердикт | диагноз |
|---|---|---|---|---|
| c014 | support | procedure | WEAK | layer-missing(expected=[practice_skill,regulations] matched=[]) |
| c023 | marketer | values_tradeoff | WEAK | persona-off(P) |
| c024 | support | values_tradeoff | FABRICATED | fabrication |
| c029 | support | regulation | WEAK | prompt-weak(E); method-off(M); layer-missing(expected=[regulations] matched=[]); persona-off(P) |
| c030 | support | regulation | WEAK | prompt-weak(E); layer-missing(expected=[regulations] matched=[]) |
| c031 | support | regulation | WEAK | prompt-weak(E) |
| c032 | integrator | regulation | REFUSED | gate-refusal(topic_starved) |
| c034 | ceo | regulation | REFUSED | gate-refusal(topic_starved) |
| c035 | support | regulation | WEAK | method-off(M) |
| c036 | marketer | regulation | WEAK | prompt-weak(E); persona-off(P) |
| c037 | integrator | regulation | REFUSED | gate-refusal(topic_starved) |
| c038 | support | regulation | FABRICATED | fabrication |
| c041 | ceo | analogy_transfer | REFUSED | gate-refusal(topic_starved) |
| c044 | marketer | analogy_transfer | REFUSED | gate-refusal(topic_starved) |
| c050 | ceo | analogy_transfer | REFUSED | gate-refusal(ungrounded) |
| c052 | ceo | expert_advice | WEAK | prompt-weak(E); method-off(M) |
| c058 | marketer | expert_advice | WEAK | method-off(M) |
| c059 | support | expert_advice | FABRICATED | fabrication |
| c062 | marketer | expert_advice | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c065 | ceo | knowledge | WEAK | prompt-weak(E); method-off(M) |
| c067 | support | knowledge | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c068 | integrator | knowledge | WEAK | prompt-weak(E); method-off(M) |
| c069 | ceo | knowledge | REFUSED | gate-refusal(ungrounded) |
| c070 | marketer | knowledge | WEAK | prompt-weak(E); method-off(M) |
| c071 | ceo | stale_topic | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c072 | integrator | stale_topic | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c073 | marketer | stale_topic | WEAK | prompt-weak(E); method-off(M) |
| c075 | support | stale_topic | REFUSED | gate-refusal(ungrounded) |
| c076 | integrator | stale_topic | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c077 | support | paraphrase | WEAK | prompt-weak(E); method-off(M); layer-missing(expected=[regulations] matched=[]); persona-off(P) |
| c078 | support | paraphrase | REFUSED | gate-refusal(ungrounded) |
| c086 | integrator | chain | REFUSED | gate-refusal(topic_starved) |
| c088 | ceo | chain | WEAK | persona-off(P) |
| c089 | ceo | chain | REFUSED | gate-refusal(topic_starved) |
| c090 | ceo | chain | REFUSED | gate-refusal(topic_starved) |
| c091 | ceo | boundary | BOUNDARY_FAIL | boundary-rude |
| c093 | support | boundary | BOUNDARY_FAIL | boundary-rude |
| c094 | marketer | boundary | BOUNDARY_FAIL | boundary-rude |
| c100 | marketer | boundary | BOUNDARY_FAIL | boundary-rude |
| c105 | support | former_bearer | REFUSED | build-miss(role_persona_version_not_found) |
| c107 | support | former_bearer | WEAK | prompt-weak(E) |
| c109 | support | former_bearer | REFUSED | build-miss(role_persona_version_not_found) |
| c110 | ceo | former_bearer | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
