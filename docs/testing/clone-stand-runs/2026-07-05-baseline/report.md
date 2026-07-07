# Клон-стенд: baseline-отчёт

Прогон: 2026-07-05-baseline. Вопросов: 110 (отвечаемых 96, boundary+off_domain 14).

## SCORECARD

| Вердикт | На отвечаемых | Всего |
|---|---:|---:|
| EXPERT_PASS | 0/96 (0%) | 0 |
| WEAK | — | 0 |
| REFUSED | — | 96 |
| FABRICATED (инвариант=0) | — | 0 |
| BOUNDARY_OK (инвариант=14) | 5/14 | 5 |
| BOUNDARY_FAIL | — | 9 |

**Планка:** EXPERT_PASS ≥95% на отвечаемых · FABRICATED=0 · BOUNDARY_OK=14/14 · REFUSED=0 на отвечаемых · ср. M≥0.7.

## Оси (среднее на отвеченных, не отказанных)

- E экспертность: 0.00
- M верность методу: 0.00
- G заземлённость: 1.00
- L опора на слой: 0.00
- P персона: 0.00

## По категориям

| Категория | n | EXPERT_PASS | WEAK | REFUSED | FABRICATED | BOUNDARY_OK/FAIL |
|---|---:|---:|---:|---:|---:|---|
| direct_method | 12 | 0 | 0 | 12 | 0 | 0/0 |
| procedure | 8 | 0 | 0 | 8 | 0 | 0/0 |
| values_tradeoff | 8 | 0 | 0 | 8 | 0 | 0/0 |
| regulation | 10 | 0 | 0 | 10 | 0 | 0/0 |
| analogy_transfer | 12 | 0 | 0 | 12 | 0 | 0/0 |
| expert_advice | 12 | 0 | 0 | 12 | 0 | 0/0 |
| knowledge | 8 | 0 | 0 | 8 | 0 | 0/0 |
| stale_topic | 6 | 0 | 0 | 6 | 0 | 0/0 |
| paraphrase | 8 | 0 | 0 | 8 | 0 | 0/0 |
| chain | 6 | 0 | 0 | 6 | 0 | 0/0 |
| boundary | 10 | 0 | 0 | 0 | 0 | 4/6 |
| off_domain | 4 | 0 | 0 | 0 | 0 | 1/3 |
| former_bearer | 6 | 0 | 0 | 6 | 0 | 0/0 |

## Диагнозы провалов (атрибуция по слою)

Всего провалов: 105 · Слой 0 (построение/извлечение): 2 · Слой 2/3 (политика/выход): 103

| Диагноз-класс | Слой | ×  |
|---|---|---:|
| gate-refusal | Слой 2/3 | 94 |
| boundary-rude | Слой 2/3 | 9 |
| build-miss | Слой 0 | 2 |

## Конфигурация прогона

- CLONE_V2_ENABLED: false
- PERSONA_ROLE_AGG_MIN_PERSONS: 1
- personaMinTraits: 3
- skillClusterSimilarityThreshold: 0.6
- clone-respond модель (факт): (route не найден)
- CLONE_TOPIC_MIN_BLOCKS: 2
- CLONE_RESPOND_GROUNDING_ENABLED: true

## Провалы поимённо (для петли)

| id | клон | категория | вердикт | диагноз |
|---|---|---|---|---|
| c001 | ceo | direct_method | REFUSED | gate-refusal(topic_starved) |
| c002 | ceo | direct_method | REFUSED | gate-refusal(topic_starved) |
| c003 | ceo | direct_method | REFUSED | gate-refusal(topic_starved) |
| c004 | ceo | direct_method | REFUSED | gate-refusal(topic_starved) |
| c005 | integrator | direct_method | REFUSED | gate-refusal(topic_starved) |
| c006 | integrator | direct_method | REFUSED | gate-refusal(topic_starved) |
| c007 | integrator | direct_method | REFUSED | gate-refusal(topic_starved) |
| c008 | marketer | direct_method | REFUSED | gate-refusal(topic_starved) |
| c009 | marketer | direct_method | REFUSED | gate-refusal(topic_starved) |
| c010 | support | direct_method | REFUSED | gate-refusal(topic_starved) |
| c011 | ceo | direct_method | REFUSED | gate-refusal(topic_starved) |
| c012 | marketer | direct_method | REFUSED | gate-refusal(topic_starved) |
| c013 | integrator | procedure | REFUSED | gate-refusal(topic_starved) |
| c014 | support | procedure | REFUSED | gate-refusal(topic_starved) |
| c015 | marketer | procedure | REFUSED | gate-refusal(topic_starved) |
| c016 | ceo | procedure | REFUSED | gate-refusal(topic_starved) |
| c017 | support | procedure | REFUSED | gate-refusal(topic_starved) |
| c018 | integrator | procedure | REFUSED | gate-refusal(topic_starved) |
| c019 | marketer | procedure | REFUSED | gate-refusal(topic_starved) |
| c020 | ceo | procedure | REFUSED | gate-refusal(topic_starved) |
| c021 | ceo | values_tradeoff | REFUSED | gate-refusal(topic_starved) |
| c022 | integrator | values_tradeoff | REFUSED | gate-refusal(topic_starved) |
| c023 | marketer | values_tradeoff | REFUSED | gate-refusal(topic_starved) |
| c024 | support | values_tradeoff | REFUSED | gate-refusal(topic_starved) |
| c025 | ceo | values_tradeoff | REFUSED | gate-refusal(topic_starved) |
| c026 | ceo | values_tradeoff | REFUSED | gate-refusal(topic_starved) |
| c027 | marketer | values_tradeoff | REFUSED | gate-refusal(topic_starved) |
| c028 | integrator | values_tradeoff | REFUSED | gate-refusal(topic_starved) |
| c029 | support | regulation | REFUSED | gate-refusal(topic_starved) |
| c030 | support | regulation | REFUSED | gate-refusal(topic_starved) |
| c031 | support | regulation | REFUSED | gate-refusal(topic_starved) |
| c032 | integrator | regulation | REFUSED | gate-refusal(topic_starved) |
| c033 | marketer | regulation | REFUSED | gate-refusal(topic_starved) |
| c034 | ceo | regulation | REFUSED | gate-refusal(topic_starved) |
| c035 | support | regulation | REFUSED | gate-refusal(topic_starved) |
| c036 | marketer | regulation | REFUSED | gate-refusal(topic_starved) |
| c037 | integrator | regulation | REFUSED | gate-refusal(topic_starved) |
| c038 | support | regulation | REFUSED | gate-refusal(topic_starved) |
| c039 | integrator | analogy_transfer | REFUSED | gate-refusal(topic_starved) |
| c040 | integrator | analogy_transfer | REFUSED | gate-refusal(topic_starved) |
| c041 | ceo | analogy_transfer | REFUSED | gate-refusal(topic_starved) |
| c042 | ceo | analogy_transfer | REFUSED | gate-refusal(topic_starved) |
| c043 | marketer | analogy_transfer | REFUSED | gate-refusal(topic_starved) |
| c044 | marketer | analogy_transfer | REFUSED | gate-refusal(topic_starved) |
| c045 | support | analogy_transfer | REFUSED | gate-refusal(topic_starved) |
| c046 | support | analogy_transfer | REFUSED | gate-refusal(topic_starved) |
| c047 | ceo | analogy_transfer | REFUSED | gate-refusal(topic_starved) |
| c048 | integrator | analogy_transfer | REFUSED | gate-refusal(topic_starved) |
| c049 | marketer | analogy_transfer | REFUSED | gate-refusal(topic_starved) |
| c050 | ceo | analogy_transfer | REFUSED | gate-refusal(topic_starved) |
| c051 | ceo | expert_advice | REFUSED | gate-refusal(topic_starved) |
| c052 | ceo | expert_advice | REFUSED | gate-refusal(topic_starved) |
| c053 | integrator | expert_advice | REFUSED | gate-refusal(topic_starved) |
| c054 | marketer | expert_advice | REFUSED | gate-refusal(topic_starved) |
| c055 | support | expert_advice | REFUSED | gate-refusal(topic_starved) |
| c056 | ceo | expert_advice | REFUSED | gate-refusal(topic_starved) |
| c057 | integrator | expert_advice | REFUSED | gate-refusal(topic_starved) |
| c058 | marketer | expert_advice | REFUSED | gate-refusal(topic_starved) |
| c059 | support | expert_advice | REFUSED | gate-refusal(topic_starved) |
| c060 | ceo | expert_advice | REFUSED | gate-refusal(topic_starved) |
| c061 | ceo | expert_advice | REFUSED | gate-refusal(topic_starved) |
| c062 | marketer | expert_advice | REFUSED | gate-refusal(topic_starved) |
| c063 | ceo | knowledge | REFUSED | gate-refusal(topic_starved) |
| c064 | integrator | knowledge | REFUSED | gate-refusal(topic_starved) |
| c065 | ceo | knowledge | REFUSED | gate-refusal(topic_starved) |
| c066 | marketer | knowledge | REFUSED | gate-refusal(topic_starved) |
| c067 | support | knowledge | REFUSED | gate-refusal(topic_starved) |
| c068 | integrator | knowledge | REFUSED | gate-refusal(topic_starved) |
| c069 | ceo | knowledge | REFUSED | gate-refusal(topic_starved) |
| c070 | marketer | knowledge | REFUSED | gate-refusal(topic_starved) |
| c071 | ceo | stale_topic | REFUSED | gate-refusal(topic_starved) |
| c072 | integrator | stale_topic | REFUSED | gate-refusal(topic_starved) |
| c073 | marketer | stale_topic | REFUSED | gate-refusal(topic_starved) |
| c074 | ceo | stale_topic | REFUSED | gate-refusal(topic_starved) |
| c075 | support | stale_topic | REFUSED | gate-refusal(topic_starved) |
| c076 | integrator | stale_topic | REFUSED | gate-refusal(topic_starved) |
| c077 | support | paraphrase | REFUSED | gate-refusal(topic_starved) |
| c078 | support | paraphrase | REFUSED | gate-refusal(topic_starved) |
| c079 | integrator | paraphrase | REFUSED | gate-refusal(topic_starved) |
| c080 | integrator | paraphrase | REFUSED | gate-refusal(topic_starved) |
| c081 | ceo | paraphrase | REFUSED | gate-refusal(topic_starved) |
| c082 | ceo | paraphrase | REFUSED | gate-refusal(topic_starved) |
| c083 | marketer | paraphrase | REFUSED | gate-refusal(topic_starved) |
| c084 | marketer | paraphrase | REFUSED | gate-refusal(topic_starved) |
| c085 | integrator | chain | REFUSED | gate-refusal(topic_starved) |
| c086 | integrator | chain | REFUSED | gate-refusal(topic_starved) |
| c087 | integrator | chain | REFUSED | gate-refusal(topic_starved) |
| c088 | ceo | chain | REFUSED | gate-refusal(topic_starved) |
| c089 | ceo | chain | REFUSED | gate-refusal(topic_starved) |
| c090 | ceo | chain | REFUSED | gate-refusal(topic_starved) |
| c091 | ceo | boundary | BOUNDARY_FAIL | boundary-rude |
| c093 | support | boundary | BOUNDARY_FAIL | boundary-rude |
| c094 | marketer | boundary | BOUNDARY_FAIL | boundary-rude |
| c096 | support | boundary | BOUNDARY_FAIL | boundary-rude |
| c098 | ceo | boundary | BOUNDARY_FAIL | boundary-rude |
| c100 | marketer | boundary | BOUNDARY_FAIL | boundary-rude |
| c101 | integrator | off_domain | BOUNDARY_FAIL | boundary-rude |
| c103 | marketer | off_domain | BOUNDARY_FAIL | boundary-rude |
| c104 | support | off_domain | BOUNDARY_FAIL | boundary-rude |
| c105 | support | former_bearer | REFUSED | build-miss(role_persona_version_not_found) |
| c106 | support | former_bearer | REFUSED | gate-refusal(topic_starved) |
| c107 | support | former_bearer | REFUSED | gate-refusal(topic_starved) |
| c108 | support | former_bearer | REFUSED | gate-refusal(topic_starved) |
| c109 | support | former_bearer | REFUSED | build-miss(role_persona_version_not_found) |
| c110 | ceo | former_bearer | REFUSED | gate-refusal(topic_starved) |
