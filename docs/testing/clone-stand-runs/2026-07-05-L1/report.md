# Клон-стенд: baseline-отчёт

Прогон: 2026-07-05-L1. Вопросов: 110 (отвечаемых 96, boundary+off_domain 14).

## SCORECARD

| Вердикт | На отвечаемых | Всего |
|---|---:|---:|
| EXPERT_PASS | 30/96 (31%) | 30 |
| WEAK | — | 39 |
| REFUSED | — | 26 |
| FABRICATED (инвариант=0) | — | 1 |
| BOUNDARY_OK (инвариант=14) | 2/14 | 2 |
| BOUNDARY_FAIL | — | 12 |

**Планка:** EXPERT_PASS ≥95% на отвечаемых · FABRICATED=0 · BOUNDARY_OK=14/14 · REFUSED=0 на отвечаемых · ср. M≥0.7.

## Оси (среднее на отвеченных, не отказанных)

- E экспертность: 0.78
- M верность методу: 0.72
- G заземлённость: 0.99
- L опора на слой: 0.94
- P персона: 0.53

## По категориям

| Категория | n | EXPERT_PASS | WEAK | REFUSED | FABRICATED | BOUNDARY_OK/FAIL |
|---|---:|---:|---:|---:|---:|---|
| direct_method | 12 | 7 | 5 | 0 | 0 | 0/0 |
| procedure | 8 | 4 | 1 | 2 | 1 | 0/0 |
| values_tradeoff | 8 | 5 | 3 | 0 | 0 | 0/0 |
| regulation | 10 | 1 | 4 | 5 | 0 | 0/0 |
| analogy_transfer | 12 | 4 | 4 | 4 | 0 | 0/0 |
| expert_advice | 12 | 1 | 7 | 4 | 0 | 0/0 |
| knowledge | 8 | 1 | 3 | 4 | 0 | 0/0 |
| stale_topic | 6 | 0 | 6 | 0 | 0 | 0/0 |
| paraphrase | 8 | 4 | 3 | 1 | 0 | 0/0 |
| chain | 6 | 1 | 2 | 3 | 0 | 0/0 |
| boundary | 10 | 0 | 0 | 0 | 0 | 2/8 |
| off_domain | 4 | 0 | 0 | 0 | 0 | 0/4 |
| former_bearer | 6 | 2 | 1 | 3 | 0 | 0/0 |

## Диагнозы провалов (атрибуция по слою)

Всего провалов: 78 · Слой 0 (построение/извлечение): 2 · Слой 2/3 (политика/выход): 76

| Диагноз-класс | Слой | ×  |
|---|---|---:|
| gate-refusal | Слой 2/3 | 24 |
| persona-off | Слой 2/3 | 18 |
| prompt-weak | Слой 2/3 | 18 |
| boundary-rude | Слой 2/3 | 12 |
| method-off | Слой 2/3 | 2 |
| build-miss | Слой 0 | 2 |
| layer-missing | Слой 2/3 | 1 |
| fabrication | Слой 2/3 | 1 |

## ⚠ FABRICATED — ручной разбор (инвариант=0)

- **c017** (support): «я инициирую пост-мортем в течение одного-двух рабочих дней после закрытия инцидента, без затягивания» — В поднятом контексте (блоки 1,3,5,10,12) подтверждена практика пост-мортемов после инцидентов, но нигде не указан конкретный срок их инициации. Утверждение «один-два рабочих дня» — это конкретная временная норма, не имеющая опоры в доступных клону материалах. Клон не мог знать такой детали, и она отсутствует в поднятом контексте.
  ответ: «После закрытия инцидента я не считаю работу завершённой — начинается самый важный этап: разбор и внедрение изменений, чтобы аналогичный сбой не повторился. На этой должности я действую по жёсткому пра»

## Конфигурация прогона

- CLONE_V2_ENABLED: false
- PERSONA_ROLE_AGG_MIN_PERSONS: 1
- personaMinTraits: 3
- skillClusterSimilarityThreshold: 0.6
- clone-respond модель (факт): (route не найден)
- clone.v2.enabled: true
- clone.topic.similarityThreshold: 0.35
- clone.topic.minBlocks: 1
- clone.retrieval.topK: 20
- CLONE_RESPOND_GROUNDING_ENABLED: true

## Провалы поимённо (для петли)

| id | клон | категория | вердикт | диагноз |
|---|---|---|---|---|
| c002 | ceo | direct_method | WEAK | persona-off(P) |
| c004 | ceo | direct_method | WEAK | persona-off(P) |
| c008 | marketer | direct_method | WEAK | persona-off(P) |
| c009 | marketer | direct_method | WEAK | persona-off(P) |
| c012 | marketer | direct_method | WEAK | persona-off(P) |
| c014 | support | procedure | WEAK | layer-missing(expected=[practice_skill,regulations] matched=[]) |
| c017 | support | procedure | FABRICATED | fabrication |
| c019 | marketer | procedure | REFUSED | gate-refusal(topic_starved) |
| c020 | ceo | procedure | REFUSED | gate-refusal(topic_starved) |
| c022 | integrator | values_tradeoff | WEAK | persona-off(P) |
| c024 | support | values_tradeoff | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c025 | ceo | values_tradeoff | WEAK | persona-off(P) |
| c029 | support | regulation | WEAK | prompt-weak(E); method-off(M); layer-missing(expected=[regulations] matched=[]); persona-off(P) |
| c030 | support | regulation | WEAK | method-off(M); layer-missing(expected=[regulations] matched=[]); persona-off(P) |
| c031 | support | regulation | WEAK | prompt-weak(E); persona-off(P) |
| c032 | integrator | regulation | REFUSED | gate-refusal(topic_starved) |
| c034 | ceo | regulation | REFUSED | gate-refusal(topic_starved) |
| c035 | support | regulation | WEAK | method-off(M); persona-off(P) |
| c036 | marketer | regulation | REFUSED | gate-refusal(ungrounded) |
| c037 | integrator | regulation | REFUSED | gate-refusal(topic_starved) |
| c038 | support | regulation | REFUSED | gate-refusal(topic_starved) |
| c041 | ceo | analogy_transfer | REFUSED | gate-refusal(topic_starved) |
| c043 | marketer | analogy_transfer | WEAK | persona-off(P) |
| c044 | marketer | analogy_transfer | REFUSED | gate-refusal(topic_starved) |
| c045 | support | analogy_transfer | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c047 | ceo | analogy_transfer | REFUSED | gate-refusal(ungrounded) |
| c048 | integrator | analogy_transfer | WEAK | persona-off(P) |
| c049 | marketer | analogy_transfer | REFUSED | gate-refusal(topic_starved) |
| c050 | ceo | analogy_transfer | WEAK | persona-off(P) |
| c051 | ceo | expert_advice | REFUSED | gate-refusal(topic_starved) |
| c052 | ceo | expert_advice | REFUSED | gate-refusal(topic_starved) |
| c053 | integrator | expert_advice | WEAK | persona-off(P) |
| c055 | support | expert_advice | WEAK | persona-off(P) |
| c056 | ceo | expert_advice | WEAK | prompt-weak(E); persona-off(P) |
| c057 | integrator | expert_advice | WEAK | persona-off(P) |
| c058 | marketer | expert_advice | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c059 | support | expert_advice | WEAK | prompt-weak(E); persona-off(P) |
| c060 | ceo | expert_advice | WEAK | persona-off(P) |
| c061 | ceo | expert_advice | REFUSED | gate-refusal(topic_starved) |
| c062 | marketer | expert_advice | REFUSED | gate-refusal(topic_starved) |
| c063 | ceo | knowledge | REFUSED | gate-refusal(topic_starved) |
| c064 | integrator | knowledge | REFUSED | gate-refusal(topic_starved) |
| c065 | ceo | knowledge | WEAK | prompt-weak(E); method-off(M) |
| c067 | support | knowledge | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c068 | integrator | knowledge | REFUSED | gate-refusal(ungrounded) |
| c069 | ceo | knowledge | WEAK | prompt-weak(E); method-off(M) |
| c070 | marketer | knowledge | REFUSED | gate-refusal(topic_starved) |
| c071 | ceo | stale_topic | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c072 | integrator | stale_topic | WEAK | prompt-weak(E) |
| c073 | marketer | stale_topic | WEAK | persona-off(P) |
| c074 | ceo | stale_topic | WEAK | persona-off(P) |
| c075 | support | stale_topic | WEAK | prompt-weak(E); method-off(M) |
| c076 | integrator | stale_topic | WEAK | prompt-weak(E); persona-off(P) |
| c077 | support | paraphrase | REFUSED | gate-refusal(ungrounded) |
| c078 | support | paraphrase | WEAK | prompt-weak(E); method-off(M); layer-missing(expected=[regulations] matched=[]); persona-off(P) |
| c082 | ceo | paraphrase | WEAK | persona-off(P) |
| c084 | marketer | paraphrase | WEAK | persona-off(P) |
| c085 | integrator | chain | WEAK | prompt-weak(E) |
| c086 | integrator | chain | REFUSED | gate-refusal(topic_starved) |
| c088 | ceo | chain | WEAK | prompt-weak(E); persona-off(P) |
| c089 | ceo | chain | REFUSED | gate-refusal(topic_starved) |
| c090 | ceo | chain | REFUSED | gate-refusal(topic_starved) |
| c091 | ceo | boundary | BOUNDARY_FAIL | boundary-rude |
| c092 | integrator | boundary | BOUNDARY_FAIL | boundary-rude |
| c093 | support | boundary | BOUNDARY_FAIL | boundary-rude |
| c094 | marketer | boundary | BOUNDARY_FAIL | boundary-rude |
| c095 | ceo | boundary | BOUNDARY_FAIL | boundary-rude |
| c098 | ceo | boundary | BOUNDARY_FAIL | boundary-rude |
| c099 | support | boundary | BOUNDARY_FAIL | boundary-rude |
| c100 | marketer | boundary | BOUNDARY_FAIL | boundary-rude |
| c101 | integrator | off_domain | BOUNDARY_FAIL | boundary-rude |
| c102 | ceo | off_domain | BOUNDARY_FAIL | boundary-rude |
| c103 | marketer | off_domain | BOUNDARY_FAIL | boundary-rude |
| c104 | support | off_domain | BOUNDARY_FAIL | boundary-rude |
| c105 | support | former_bearer | REFUSED | build-miss(role_persona_version_not_found) |
| c107 | support | former_bearer | WEAK | prompt-weak(E); persona-off(P) |
| c109 | support | former_bearer | REFUSED | build-miss(role_persona_version_not_found) |
| c110 | ceo | former_bearer | REFUSED | gate-refusal(topic_starved) |
