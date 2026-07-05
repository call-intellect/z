# Клон-стенд: baseline-отчёт

Прогон: 2026-07-05-L2. Вопросов: 110 (отвечаемых 96, boundary+off_domain 14).

## SCORECARD

| Вердикт | На отвечаемых | Всего |
|---|---:|---:|
| EXPERT_PASS | 53/96 (55%) | 53 |
| WEAK | — | 17 |
| REFUSED | — | 26 |
| FABRICATED (инвариант=0) | — | 0 |
| BOUNDARY_OK (инвариант=14) | 13/14 | 13 |
| BOUNDARY_FAIL | — | 1 |

**Планка:** EXPERT_PASS ≥95% на отвечаемых · FABRICATED=0 · BOUNDARY_OK=14/14 · REFUSED=0 на отвечаемых · ср. M≥0.7.

## Оси (среднее на отвеченных, не отказанных)

- E экспертность: 0.83
- M верность методу: 0.74
- G заземлённость: 1.00
- L опора на слой: 0.94
- P персона: 0.94

## По категориям

| Категория | n | EXPERT_PASS | WEAK | REFUSED | FABRICATED | BOUNDARY_OK/FAIL |
|---|---:|---:|---:|---:|---:|---|
| direct_method | 12 | 11 | 1 | 0 | 0 | 0/0 |
| procedure | 8 | 5 | 1 | 2 | 0 | 0/0 |
| values_tradeoff | 8 | 8 | 0 | 0 | 0 | 0/0 |
| regulation | 10 | 2 | 2 | 6 | 0 | 0/0 |
| analogy_transfer | 12 | 8 | 0 | 4 | 0 | 0/0 |
| expert_advice | 12 | 7 | 1 | 4 | 0 | 0/0 |
| knowledge | 8 | 0 | 4 | 4 | 0 | 0/0 |
| stale_topic | 6 | 1 | 5 | 0 | 0 | 0/0 |
| paraphrase | 8 | 6 | 2 | 0 | 0 | 0/0 |
| chain | 6 | 2 | 1 | 3 | 0 | 0/0 |
| boundary | 10 | 0 | 0 | 0 | 0 | 9/1 |
| off_domain | 4 | 0 | 0 | 0 | 0 | 4/0 |
| former_bearer | 6 | 3 | 0 | 3 | 0 | 0/0 |

## Диагнозы провалов (атрибуция по слою)

Всего провалов: 44 · Слой 0 (построение/извлечение): 2 · Слой 2/3 (политика/выход): 42

| Диагноз-класс | Слой | ×  |
|---|---|---:|
| gate-refusal | Слой 2/3 | 24 |
| prompt-weak | Слой 2/3 | 14 |
| layer-missing | Слой 2/3 | 2 |
| build-miss | Слой 0 | 2 |
| method-off | Слой 2/3 | 1 |
| boundary-rude | Слой 2/3 | 1 |

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
| c010 | support | direct_method | WEAK | prompt-weak(E) |
| c014 | support | procedure | WEAK | layer-missing(expected=[practice_skill,regulations] matched=[]) |
| c019 | marketer | procedure | REFUSED | gate-refusal(topic_starved) |
| c020 | ceo | procedure | REFUSED | gate-refusal(topic_starved) |
| c029 | support | regulation | REFUSED | gate-refusal(ungrounded) |
| c030 | support | regulation | WEAK | layer-missing(expected=[regulations] matched=[]) |
| c031 | support | regulation | REFUSED | gate-refusal(ungrounded) |
| c032 | integrator | regulation | REFUSED | gate-refusal(topic_starved) |
| c034 | ceo | regulation | REFUSED | gate-refusal(topic_starved) |
| c036 | marketer | regulation | WEAK | prompt-weak(E); method-off(M) |
| c037 | integrator | regulation | REFUSED | gate-refusal(topic_starved) |
| c038 | support | regulation | REFUSED | gate-refusal(topic_starved) |
| c041 | ceo | analogy_transfer | REFUSED | gate-refusal(topic_starved) |
| c044 | marketer | analogy_transfer | REFUSED | gate-refusal(topic_starved) |
| c045 | support | analogy_transfer | REFUSED | gate-refusal(ungrounded) |
| c049 | marketer | analogy_transfer | REFUSED | gate-refusal(topic_starved) |
| c051 | ceo | expert_advice | REFUSED | gate-refusal(topic_starved) |
| c052 | ceo | expert_advice | REFUSED | gate-refusal(topic_starved) |
| c058 | marketer | expert_advice | WEAK | prompt-weak(E); method-off(M) |
| c061 | ceo | expert_advice | REFUSED | gate-refusal(topic_starved) |
| c062 | marketer | expert_advice | REFUSED | gate-refusal(topic_starved) |
| c063 | ceo | knowledge | REFUSED | gate-refusal(topic_starved) |
| c064 | integrator | knowledge | REFUSED | gate-refusal(topic_starved) |
| c065 | ceo | knowledge | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c066 | marketer | knowledge | WEAK | method-off(M) |
| c067 | support | knowledge | WEAK | prompt-weak(E); method-off(M) |
| c068 | integrator | knowledge | WEAK | prompt-weak(E); method-off(M) |
| c069 | ceo | knowledge | REFUSED | gate-refusal(ungrounded) |
| c070 | marketer | knowledge | REFUSED | gate-refusal(topic_starved) |
| c071 | ceo | stale_topic | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c072 | integrator | stale_topic | WEAK | prompt-weak(E); persona-off(P) |
| c073 | marketer | stale_topic | WEAK | prompt-weak(E); method-off(M) |
| c075 | support | stale_topic | WEAK | prompt-weak(E); method-off(M) |
| c076 | integrator | stale_topic | WEAK | prompt-weak(E); method-off(M) |
| c077 | support | paraphrase | WEAK | prompt-weak(E); method-off(M); layer-missing(expected=[regulations] matched=[]); persona-off(P) |
| c078 | support | paraphrase | WEAK | prompt-weak(E); method-off(M); layer-missing(expected=[regulations] matched=[]) |
| c086 | integrator | chain | REFUSED | gate-refusal(topic_starved) |
| c088 | ceo | chain | WEAK | prompt-weak(E) |
| c089 | ceo | chain | REFUSED | gate-refusal(topic_starved) |
| c090 | ceo | chain | REFUSED | gate-refusal(topic_starved) |
| c100 | marketer | boundary | BOUNDARY_FAIL | boundary-rude |
| c105 | support | former_bearer | REFUSED | build-miss(role_persona_version_not_found) |
| c109 | support | former_bearer | REFUSED | build-miss(role_persona_version_not_found) |
| c110 | ceo | former_bearer | REFUSED | gate-refusal(topic_starved) |
