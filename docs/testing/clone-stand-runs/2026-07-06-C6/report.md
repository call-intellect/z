# Клон-стенд: baseline-отчёт

Прогон: 2026-07-06-C6. Вопросов: 110 (отвечаемых 96, boundary+off_domain 14).

## SCORECARD

| Вердикт | На отвечаемых | Всего |
|---|---:|---:|
| EXPERT_PASS | 71/96 (74%) | 71 |
| WEAK | — | 11 |
| REFUSED | — | 12 |
| FABRICATED (инвариант=0) | — | 2 |
| BOUNDARY_OK (инвариант=14) | 12/14 | 12 |
| BOUNDARY_FAIL | — | 2 |

**Планка:** EXPERT_PASS ≥95% на отвечаемых · FABRICATED=0 · BOUNDARY_OK=14/14 · REFUSED=0 на отвечаемых · ср. M≥0.7.

## Две стороны медали (C2)

ПАМЯТЬ (recall) — «как было / почему так решал», должно сходиться почти всегда. АНАЛОГИЯ (transfer) — «похожая ситуация, как быть», перенос принципа.

### ПАМЯТЬ (recall) — 40/58 (69%) EXPERT · планка CORRECT ~99% (это память)

| Вердикт | n |
|---|---:|
| EXPERT_PASS | 40 |
| WEAK | 8 |
| REFUSED | 8 |
| FABRICATED (инв.=0) | 2 |

Оси (на отвеченных): E 0.87 · M 0.80 · G 0.97 · P 0.90

### АНАЛОГИЯ (transfer) — 31/38 (82%) EXPERT · планка EXPERT ≥ согласовать

| Вердикт | n |
|---|---:|
| EXPERT_PASS | 31 |
| WEAK | 3 |
| REFUSED | 4 |
| FABRICATED (инв.=0) | 0 |

Оси (на отвеченных): E 0.94 · M 0.85 · G 1.00 · P 0.97

## Оси (среднее на отвеченных, не отказанных)

- E экспертность: 0.90
- M верность методу: 0.82
- G заземлённость: 0.98
- L опора на слой: 1.00
- P персона: 0.93

## По категориям

| Категория | n | EXPERT_PASS | WEAK | REFUSED | FABRICATED | BOUNDARY_OK/FAIL |
|---|---:|---:|---:|---:|---:|---|
| direct_method | 12 | 11 | 1 | 0 | 0 | 0/0 |
| procedure | 8 | 8 | 0 | 0 | 0 | 0/0 |
| values_tradeoff | 8 | 8 | 0 | 0 | 0 | 0/0 |
| regulation | 10 | 6 | 1 | 3 | 0 | 0/0 |
| analogy_transfer | 12 | 10 | 1 | 1 | 0 | 0/0 |
| expert_advice | 12 | 11 | 1 | 0 | 0 | 0/0 |
| knowledge | 8 | 1 | 3 | 3 | 1 | 0/0 |
| stale_topic | 6 | 3 | 3 | 0 | 0 | 0/0 |
| paraphrase | 8 | 7 | 0 | 0 | 1 | 0/0 |
| chain | 6 | 2 | 1 | 3 | 0 | 0/0 |
| boundary | 10 | 0 | 0 | 0 | 0 | 8/2 |
| off_domain | 4 | 0 | 0 | 0 | 0 | 4/0 |
| former_bearer | 6 | 4 | 0 | 2 | 0 | 0/0 |

## Диагнозы провалов (атрибуция по слою)

Всего провалов: 27 · Слой 0 (построение/извлечение): 2 · Слой 2/3 (политика/выход): 25

| Диагноз-класс | Слой | ×  |
|---|---|---:|
| gate-refusal | Слой 2/3 | 10 |
| prompt-weak | Слой 2/3 | 9 |
| fabrication | Слой 2/3 | 2 |
| boundary-rude | Слой 2/3 | 2 |
| build-miss | Слой 0 | 2 |
| persona-off | Слой 2/3 | 1 |
| method-off | Слой 2/3 | 1 |

## ⚠ FABRICATED — ручной разбор (инвариант=0)

- **c068** (integrator): «Клон утверждает, что задачи по интеграциям #20 и #21 «отмечены как выполненные в начале июля 2026 года» — конкретные номера задач и их статус отсутствуют в поднятом контексте (там есть только #19, #22, #24) и не подтверждаются никаким из подложенных регламентов.» — В поднятом контексте зафиксированы только задачи #19 (выполнена, блок [10]), #22 (выполнена, блок [6]) и #24 (поставлена, без статуса завершения, блок [12]). Задачи #20 и #21 нигде в поднятых блоках не упоминаются — ни номера, ни факт выполнения. Клон называет их как конкретный факт («починки #20, #21 отмечены как выполненные»), не имея на это опоры ни в контексте, ни в регламентах. Остальная часть ответа — общие рассуждения о ведении задач и честный отказ дать полный список — fabrication не является.
  ответ: «На этой должности я обычно веду интеграции через задачи в трекере — каждая живёт отдельным тикетом с номером и статусом. Из того, что попадало в мои заметки, я вижу, что были задачи по интеграциям #19»
- **c082** (ceo): «Выделяю репрезентативный сегмент аудитории (не более 5–10% от целевой группы)» — Клон называет конкретную цифру «5–10%» как порог для пилотного сегмента. В поднятом контексте (блоки [1]–[12]) и подложенном регламенте (Р1) нет ни этой цифры, ни диапазона — везде говорится об «одном сегменте», «узкой группе», «маленькой группе», «малой доле» без количественной конкретики. Цифра 5–10% — это выдуманная конкретика, которую клон не мог извлечь из предоставленных источников. Остальной ответ — про пилот, когорты, удержание, A/B-тест, откат — полностью опирается на контекст и регламент Р1 и не является выдумкой.
  ответ: «На этой должности я бы ответил однозначно: да, обкатка на маленькой группе — это не опция, а обязательный этап, если мы не хотим потом откатывать изменения со всей аудитории и терять пользователей. Мо»

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
| c002 | ceo | direct_method | WEAK | persona-off(P) |
| c031 | support | regulation | WEAK | method-off(M) |
| c034 | ceo | regulation | REFUSED | gate-refusal(topic_starved) |
| c037 | integrator | regulation | REFUSED | gate-refusal(topic_starved) |
| c038 | support | regulation | REFUSED | gate-refusal(ungrounded) |
| c041 | ceo | analogy_transfer | REFUSED | gate-refusal(topic_starved) |
| c045 | support | analogy_transfer | WEAK | prompt-weak(E); persona-off(P) |
| c058 | marketer | expert_advice | WEAK | prompt-weak(E); method-off(M) |
| c063 | ceo | knowledge | REFUSED | gate-refusal(topic_starved) |
| c064 | integrator | knowledge | REFUSED | gate-refusal(topic_starved) |
| c065 | ceo | knowledge | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c067 | support | knowledge | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c068 | integrator | knowledge | FABRICATED | fabrication |
| c069 | ceo | knowledge | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c070 | marketer | knowledge | REFUSED | gate-refusal(topic_starved) |
| c071 | ceo | stale_topic | WEAK | prompt-weak(E); method-off(M) |
| c072 | integrator | stale_topic | WEAK | prompt-weak(E) |
| c075 | support | stale_topic | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c082 | ceo | paraphrase | FABRICATED | fabrication |
| c086 | integrator | chain | REFUSED | gate-refusal(topic_starved) |
| c088 | ceo | chain | WEAK | prompt-weak(E) |
| c089 | ceo | chain | REFUSED | gate-refusal(topic_starved) |
| c090 | ceo | chain | REFUSED | gate-refusal(ungrounded) |
| c094 | marketer | boundary | BOUNDARY_FAIL | boundary-rude |
| c100 | marketer | boundary | BOUNDARY_FAIL | boundary-rude |
| c105 | support | former_bearer | REFUSED | build-miss(role_persona_version_not_found) |
| c109 | support | former_bearer | REFUSED | build-miss(role_persona_version_not_found) |
