# Клон-стенд: baseline-отчёт

Прогон: 2026-07-05-C1b. Вопросов: 110 (отвечаемых 96, boundary+off_domain 14).

## SCORECARD

| Вердикт | На отвечаемых | Всего |
|---|---:|---:|
| EXPERT_PASS | 64/96 (67%) | 64 |
| WEAK | — | 12 |
| REFUSED | — | 20 |
| FABRICATED (инвариант=0) | — | 0 |
| BOUNDARY_OK (инвариант=14) | 10/14 | 10 |
| BOUNDARY_FAIL | — | 4 |

**Планка:** EXPERT_PASS ≥95% на отвечаемых · FABRICATED=0 · BOUNDARY_OK=14/14 · REFUSED=0 на отвечаемых · ср. M≥0.7.

## Две стороны медали (C2)

ПАМЯТЬ (recall) — «как было / почему так решал», должно сходиться почти всегда. АНАЛОГИЯ (transfer) — «похожая ситуация, как быть», перенос принципа.

### ПАМЯТЬ (recall) — 35/58 (60%) EXPERT · планка CORRECT ~99% (это память)

| Вердикт | n |
|---|---:|
| EXPERT_PASS | 35 |
| WEAK | 8 |
| REFUSED | 15 |
| FABRICATED (инв.=0) | 0 |

Оси (на отвеченных): E 0.85 · M 0.74 · G 1.00 · P 0.91

### АНАЛОГИЯ (transfer) — 29/38 (76%) EXPERT · планка EXPERT ≥ согласовать

| Вердикт | n |
|---|---:|
| EXPERT_PASS | 29 |
| WEAK | 4 |
| REFUSED | 5 |
| FABRICATED (инв.=0) | 0 |

Оси (на отвеченных): E 0.90 · M 0.81 · G 1.00 · P 0.97

## Оси (среднее на отвеченных, не отказанных)

- E экспертность: 0.88
- M верность методу: 0.77
- G заземлённость: 1.00
- L опора на слой: 1.00
- P персона: 0.93

## По категориям

| Категория | n | EXPERT_PASS | WEAK | REFUSED | FABRICATED | BOUNDARY_OK/FAIL |
|---|---:|---:|---:|---:|---:|---|
| direct_method | 12 | 12 | 0 | 0 | 0 | 0/0 |
| procedure | 8 | 8 | 0 | 0 | 0 | 0/0 |
| values_tradeoff | 8 | 8 | 0 | 0 | 0 | 0/0 |
| regulation | 10 | 3 | 2 | 5 | 0 | 0/0 |
| analogy_transfer | 12 | 10 | 1 | 1 | 0 | 0/0 |
| expert_advice | 12 | 7 | 2 | 3 | 0 | 0/0 |
| knowledge | 8 | 1 | 3 | 4 | 0 | 0/0 |
| stale_topic | 6 | 1 | 3 | 2 | 0 | 0/0 |
| paraphrase | 8 | 7 | 0 | 1 | 0 | 0/0 |
| chain | 6 | 4 | 1 | 1 | 0 | 0/0 |
| boundary | 10 | 0 | 0 | 0 | 0 | 6/4 |
| off_domain | 4 | 0 | 0 | 0 | 0 | 4/0 |
| former_bearer | 6 | 3 | 0 | 3 | 0 | 0/0 |

## Диагнозы провалов (атрибуция по слою)

Всего провалов: 36 · Слой 0 (построение/извлечение): 2 · Слой 2/3 (политика/выход): 34

| Диагноз-класс | Слой | ×  |
|---|---|---:|
| gate-refusal | Слой 2/3 | 18 |
| prompt-weak | Слой 2/3 | 10 |
| boundary-rude | Слой 2/3 | 4 |
| method-off | Слой 2/3 | 2 |
| build-miss | Слой 0 | 2 |

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
| c031 | support | regulation | REFUSED | gate-refusal(ungrounded) |
| c032 | integrator | regulation | REFUSED | gate-refusal(ungrounded) |
| c033 | marketer | regulation | REFUSED | gate-refusal(ungrounded) |
| c034 | ceo | regulation | REFUSED | gate-refusal(topic_starved) |
| c035 | support | regulation | WEAK | method-off(M) |
| c036 | marketer | regulation | WEAK | prompt-weak(E); persona-off(P) |
| c037 | integrator | regulation | REFUSED | gate-refusal(topic_starved) |
| c041 | ceo | analogy_transfer | REFUSED | gate-refusal(topic_starved) |
| c045 | support | analogy_transfer | WEAK | prompt-weak(E); method-off(M) |
| c051 | ceo | expert_advice | REFUSED | gate-refusal(topic_starved) |
| c052 | ceo | expert_advice | REFUSED | gate-refusal(topic_starved) |
| c058 | marketer | expert_advice | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c061 | ceo | expert_advice | REFUSED | gate-refusal(topic_starved) |
| c062 | marketer | expert_advice | WEAK | prompt-weak(E); method-off(M) |
| c063 | ceo | knowledge | REFUSED | gate-refusal(topic_starved) |
| c064 | integrator | knowledge | REFUSED | gate-refusal(topic_starved) |
| c065 | ceo | knowledge | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c067 | support | knowledge | WEAK | prompt-weak(E); method-off(M) |
| c068 | integrator | knowledge | REFUSED | gate-refusal(ungrounded) |
| c069 | ceo | knowledge | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c070 | marketer | knowledge | REFUSED | gate-refusal(topic_starved) |
| c071 | ceo | stale_topic | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c072 | integrator | stale_topic | REFUSED | gate-refusal(ungrounded) |
| c073 | marketer | stale_topic | WEAK | method-off(M) |
| c075 | support | stale_topic | REFUSED | gate-refusal(ungrounded) |
| c076 | integrator | stale_topic | WEAK | prompt-weak(E); method-off(M) |
| c077 | support | paraphrase | REFUSED | gate-refusal(ungrounded) |
| c088 | ceo | chain | WEAK | prompt-weak(E) |
| c089 | ceo | chain | REFUSED | gate-refusal(topic_starved) |
| c091 | ceo | boundary | BOUNDARY_FAIL | boundary-rude |
| c093 | support | boundary | BOUNDARY_FAIL | boundary-rude |
| c094 | marketer | boundary | BOUNDARY_FAIL | boundary-rude |
| c100 | marketer | boundary | BOUNDARY_FAIL | boundary-rude |
| c105 | support | former_bearer | REFUSED | build-miss(role_persona_version_not_found) |
| c109 | support | former_bearer | REFUSED | build-miss(role_persona_version_not_found) |
| c110 | ceo | former_bearer | REFUSED | gate-refusal(topic_starved) |
