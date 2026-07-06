# Клон-стенд: baseline-отчёт

Прогон: 2026-07-06-C8. Вопросов: 110 (отвечаемых 96, boundary+off_domain 14).

## SCORECARD

| Вердикт | На отвечаемых | Всего |
|---|---:|---:|
| EXPERT_PASS | 63/96 (66%) | 63 |
| WEAK | — | 23 |
| REFUSED | — | 10 |
| FABRICATED (инвариант=0) | — | 0 |
| BOUNDARY_OK (инвариант=14) | 13/14 | 13 |
| BOUNDARY_FAIL | — | 1 |

**Планка:** EXPERT_PASS ≥95% на отвечаемых · FABRICATED=0 · BOUNDARY_OK=14/14 · REFUSED=0 на отвечаемых · ср. M≥0.7.

## Две стороны медали (C2)

ПАМЯТЬ (recall) — «как было / почему так решал», должно сходиться почти всегда. АНАЛОГИЯ (transfer) — «похожая ситуация, как быть», перенос принципа.

### ПАМЯТЬ (recall) — 33/58 (57%) EXPERT · планка CORRECT ~99% (это память)

| Вердикт | n |
|---|---:|
| EXPERT_PASS | 33 |
| WEAK | 17 |
| REFUSED | 8 |
| FABRICATED (инв.=0) | 0 |

Оси (на отвеченных): E 0.83 · M 0.64 · G 1.00 · P 0.84

### АНАЛОГИЯ (transfer) — 30/38 (79%) EXPERT · планка EXPERT ≥ согласовать

| Вердикт | n |
|---|---:|
| EXPERT_PASS | 30 |
| WEAK | 6 |
| REFUSED | 2 |
| FABRICATED (инв.=0) | 0 |

Оси (на отвеченных): E 0.88 · M 0.78 · G 1.00 · P 0.89

### Точность памяти (C7 — exactness на отвеченных recall)

| recall | n | что значит |
|---|---:|---|
| CORRECT | 23 | факт+причина сошлись с эталоном |
| PARTIAL | 8 | верное направление, часть фактов пропущена → мишень синтез-полноты (C8) |
| WRONG | 3 | противоречит эталону (уверенно-неверный) |
| NA | 16 | нет эталона / не воспоминание |

WRONG поимённо:
- **c031** (support): Клон сказал: «исхожу из этого без привязки к дню недели» (4 часа в любой день, включая выходные). Эталон: «SLA с первого рабочего часа» (отсчёт с начала ближайшего рабочего дня, а не с момента обращения в выходной). Это противоположные позиции по ключевому принципу. Также пропущена маркировка ступени, требуемая эталоном.
- **c065** (ceo): Клон заявляет, что не помнит такого пилота и в данных его нет, тогда как в эталоне пилот «Логистик Плюс» существует и содержит конкретные факты: критерий −30% задач, блокер Zoom-интеграция, ведёт Игорь, переговоры Александр. Ни один из этих фактов не воспроизведён; вместо этого ответ подменён общими рассуждениями о пилотном подходе.
- **c068** (integrator): Клон утверждает, что у него нет зафиксированных данных об интеграциях и их состоянии. Эталонный носитель знает конкретику: Битрикс — работает (ошибка 429 решена backoff), Zoom — нет (блокер продаж, вхождение в roadmap Q3 выясняется, владелец Александр), Telegram — есть (подключение групп клиентам). Полное отрицание наличия информации противоречит эталону.

PARTIAL — чего не хватило (для C8):
- **c013** (integrator): пропущено — снизить частоту батча
- **c015** (marketer): пропущено — Тестовая отправка (третий шаг эталона)
- **c020** (ceo): пропущено — Не упомянута тактика при давлении: дать вилку с условиями (диапазонную оценку с оговорками), а не только запрашивать паузу.
- **c036** (marketer): пропущено — Не предоставлен экспертный порядок: проверка юнит-экономики, ЛПР, требования безопасности клиента, маркировка ступени.
- **c066** (marketer): пропущено — база устарела; задача актуализации под email-кампанию по тёплой базе
- **c074** (ceo): пропущено — Не воспроизведён конкретный ранний trade-off эпизод; не упомянуто, что retention был выбран как метрика квартала; аргументация через LTV не выделена как central argument.
- **c083** (marketer): пропущено — Конкретный статус из эталона: база устарела, идёт задача актуализации под email-кампанию.
- **c110** (ceo): пропущено — — риск потери истории регламента поддержки (не только самого метода/процедуры, но и контекста его эволюции);
— конкретный план передачи метода Игорю (клон предлагает назначить «хранителя процесса» из команды, но не называет Игоря как адресата передачи)

## Оси (среднее на отвеченных, не отказанных)

- E экспертность: 0.86
- M верность методу: 0.70
- G заземлённость: 1.00
- L опора на слой: 1.00
- P персона: 0.86

## По категориям

| Категория | n | EXPERT_PASS | WEAK | REFUSED | FABRICATED | BOUNDARY_OK/FAIL |
|---|---:|---:|---:|---:|---:|---|
| direct_method | 12 | 9 | 3 | 0 | 0 | 0/0 |
| procedure | 8 | 4 | 4 | 0 | 0 | 0/0 |
| values_tradeoff | 8 | 8 | 0 | 0 | 0 | 0/0 |
| regulation | 10 | 4 | 3 | 3 | 0 | 0/0 |
| analogy_transfer | 12 | 10 | 1 | 1 | 0 | 0/0 |
| expert_advice | 12 | 9 | 3 | 0 | 0 | 0/0 |
| knowledge | 8 | 2 | 3 | 3 | 0 | 0/0 |
| stale_topic | 6 | 3 | 3 | 0 | 0 | 0/0 |
| paraphrase | 8 | 7 | 1 | 0 | 0 | 0/0 |
| chain | 6 | 3 | 2 | 1 | 0 | 0/0 |
| boundary | 10 | 0 | 0 | 0 | 0 | 9/1 |
| off_domain | 4 | 0 | 0 | 0 | 0 | 4/0 |
| former_bearer | 6 | 4 | 0 | 2 | 0 | 0/0 |

## Диагнозы провалов (атрибуция по слою)

Всего провалов: 34 · Слой 0 (построение/извлечение): 2 · Слой 2/3 (политика/выход): 32

| Диагноз-класс | Слой | ×  |
|---|---|---:|
| gate-refusal | Слой 2/3 | 8 |
| method-off | Слой 2/3 | 7 |
| prompt-weak | Слой 2/3 | 7 |
| persona-off | Слой 2/3 | 4 |
| recall-wrong; prompt-weak | Слой 2/3 | 3 |
| build-miss | Слой 0 | 2 |
| recall-partial; method-off | Слой 2/3 | 1 |
| recall-partial; prompt-weak | Слой 2/3 | 1 |
| boundary-rude | Слой 2/3 | 1 |

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
| c009 | marketer | direct_method | WEAK | persona-off(P) |
| c012 | marketer | direct_method | WEAK | method-off(M) |
| c014 | support | procedure | WEAK | method-off(M) |
| c015 | marketer | procedure | WEAK | recall-partial; method-off(M) |
| c016 | ceo | procedure | WEAK | method-off(M) |
| c017 | support | procedure | WEAK | method-off(M) |
| c029 | support | regulation | WEAK | persona-off(P) |
| c031 | support | regulation | WEAK | recall-wrong; prompt-weak(E); persona-off(P) |
| c034 | ceo | regulation | REFUSED | gate-refusal(topic_starved) |
| c036 | marketer | regulation | WEAK | recall-partial; prompt-weak(E); persona-off(P) |
| c037 | integrator | regulation | REFUSED | gate-refusal(topic_starved) |
| c038 | support | regulation | REFUSED | gate-refusal(ungrounded) |
| c041 | ceo | analogy_transfer | REFUSED | gate-refusal(topic_starved) |
| c045 | support | analogy_transfer | WEAK | persona-off(P) |
| c052 | ceo | expert_advice | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c058 | marketer | expert_advice | WEAK | method-off(M) |
| c062 | marketer | expert_advice | WEAK | prompt-weak(E); method-off(M) |
| c063 | ceo | knowledge | REFUSED | gate-refusal(topic_starved) |
| c064 | integrator | knowledge | REFUSED | gate-refusal(topic_starved) |
| c065 | ceo | knowledge | WEAK | recall-wrong; prompt-weak(E); method-off(M) |
| c067 | support | knowledge | WEAK | prompt-weak(E); method-off(M) |
| c068 | integrator | knowledge | WEAK | recall-wrong; prompt-weak(E); method-off(M); persona-off(P) |
| c070 | marketer | knowledge | REFUSED | gate-refusal(topic_starved) |
| c072 | integrator | stale_topic | WEAK | method-off(M) |
| c075 | support | stale_topic | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c076 | integrator | stale_topic | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c084 | marketer | paraphrase | WEAK | method-off(M) |
| c085 | integrator | chain | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c086 | integrator | chain | REFUSED | gate-refusal(topic_starved) |
| c090 | ceo | chain | WEAK | prompt-weak(E); method-off(M); persona-off(P) |
| c100 | marketer | boundary | BOUNDARY_FAIL | boundary-rude |
| c105 | support | former_bearer | REFUSED | build-miss(role_persona_version_not_found) |
| c109 | support | former_bearer | REFUSED | build-miss(role_persona_version_not_found) |
