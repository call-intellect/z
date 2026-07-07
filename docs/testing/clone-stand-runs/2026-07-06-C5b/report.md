# Клон-стенд: baseline-отчёт

Прогон: 2026-07-06-C5b. Вопросов: 110 (отвечаемых 96, boundary+off_domain 14).

## SCORECARD

| Вердикт | На отвечаемых | Всего |
|---|---:|---:|
| EXPERT_PASS | 72/96 (75%) | 72 |
| WEAK | — | 14 |
| REFUSED | — | 10 |
| FABRICATED (инвариант=0) | — | 0 |
| BOUNDARY_OK (инвариант=14) | 10/14 | 10 |
| BOUNDARY_FAIL | — | 4 |

**Планка:** EXPERT_PASS ≥95% на отвечаемых · FABRICATED=0 · BOUNDARY_OK=14/14 · REFUSED=0 на отвечаемых · ср. M≥0.7.

## Две стороны медали (C2)

ПАМЯТЬ (recall) — «как было / почему так решал», должно сходиться почти всегда. АНАЛОГИЯ (transfer) — «похожая ситуация, как быть», перенос принципа.

### ПАМЯТЬ (recall) — 40/58 (69%) EXPERT · планка CORRECT ~99% (это память)

| Вердикт | n |
|---|---:|
| EXPERT_PASS | 40 |
| WEAK | 10 |
| REFUSED | 8 |
| FABRICATED (инв.=0) | 0 |

Оси (на отвеченных): E 0.83 · M 0.76 · G 1.00 · P 0.88

### АНАЛОГИЯ (transfer) — 32/38 (84%) EXPERT · планка EXPERT ≥ согласовать

| Вердикт | n |
|---|---:|
| EXPERT_PASS | 32 |
| WEAK | 4 |
| REFUSED | 2 |
| FABRICATED (инв.=0) | 0 |

Оси (на отвеченных): E 0.93 · M 0.80 · G 1.00 · P 0.94

## Оси (среднее на отвеченных, не отказанных)

- E экспертность: 0.87
- M верность методу: 0.78
- G заземлённость: 1.00
- L опора на слой: 1.00
- P персона: 0.91

## По категориям

| Категория | n | EXPERT_PASS | WEAK | REFUSED | FABRICATED | BOUNDARY_OK/FAIL |
|---|---:|---:|---:|---:|---:|---|
| direct_method | 12 | 12 | 0 | 0 | 0 | 0/0 |
| procedure | 8 | 8 | 0 | 0 | 0 | 0/0 |
| values_tradeoff | 8 | 8 | 0 | 0 | 0 | 0/0 |
| regulation | 10 | 5 | 2 | 3 | 0 | 0/0 |
| analogy_transfer | 12 | 12 | 0 | 0 | 0 | 0/0 |
| expert_advice | 12 | 10 | 2 | 0 | 0 | 0/0 |
| knowledge | 8 | 2 | 3 | 3 | 0 | 0/0 |
| stale_topic | 6 | 2 | 4 | 0 | 0 | 0/0 |
| paraphrase | 8 | 7 | 1 | 0 | 0 | 0/0 |
| chain | 6 | 2 | 2 | 2 | 0 | 0/0 |
| boundary | 10 | 0 | 0 | 0 | 0 | 6/4 |
| off_domain | 4 | 0 | 0 | 0 | 0 | 4/0 |
| former_bearer | 6 | 4 | 0 | 2 | 0 | 0/0 |

## Диагнозы провалов (атрибуция по слою)

Всего провалов: 28 · Слой 0 (построение/извлечение): 2 · Слой 2/3 (политика/выход): 26

| Диагноз-класс | Слой | ×  |
|---|---|---:|
| prompt-weak | Слой 2/3 | 13 |
| gate-refusal | Слой 2/3 | 8 |
| boundary-rude | Слой 2/3 | 4 |
| build-miss | Слой 0 | 2 |
| method-off | Слой 2/3 | 1 |

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
| c031 | support | regulation | WEAK | prompt-weak(E); persona-off(P) |
| c034 | ceo | regulation | REFUSED | gate-refusal(topic_starved) |
| c036 | marketer | regulation | WEAK | prompt-weak(E); persona-off(P) |
| c037 | integrator | regulation | REFUSED | gate-refusal(topic_starved) |
| c038 | support | regulation | REFUSED | gate-refusal(topic_starved) |
| c061 | ceo | expert_advice | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c062 | marketer | expert_advice | WEAK | prompt-weak(E); method-off(M) |
| c063 | ceo | knowledge | REFUSED | gate-refusal(topic_starved) |
| c064 | integrator | knowledge | REFUSED | gate-refusal(topic_starved) |
| c065 | ceo | knowledge | WEAK | prompt-weak(E); method-off(M) |
| c067 | support | knowledge | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c068 | integrator | knowledge | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c070 | marketer | knowledge | REFUSED | gate-refusal(topic_starved) |
| c071 | ceo | stale_topic | WEAK | prompt-weak(E); method-off(M) |
| c072 | integrator | stale_topic | WEAK | prompt-weak(E) |
| c073 | marketer | stale_topic | WEAK | prompt-weak(E); method-off(M) |
| c075 | support | stale_topic | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c083 | marketer | paraphrase | WEAK | prompt-weak(E); persona-off(P) |
| c086 | integrator | chain | REFUSED | gate-refusal(topic_starved) |
| c088 | ceo | chain | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c089 | ceo | chain | REFUSED | gate-refusal(topic_starved) |
| c090 | ceo | chain | WEAK | method-off(M) |
| c093 | support | boundary | BOUNDARY_FAIL | boundary-rude |
| c094 | marketer | boundary | BOUNDARY_FAIL | boundary-rude |
| c099 | support | boundary | BOUNDARY_FAIL | boundary-rude |
| c100 | marketer | boundary | BOUNDARY_FAIL | boundary-rude |
| c105 | support | former_bearer | REFUSED | build-miss(role_persona_version_not_found) |
| c109 | support | former_bearer | REFUSED | build-miss(role_persona_version_not_found) |
