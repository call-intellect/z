# regulation-stand — e2e (сырой текст → block-ingest → матч → сборка)

Прогон: `e2e-1` · проверок 5 · PASS 5/5.

> E2e-режим гоняет РЕАЛЬНЫЙ конвейер: block-ingest классифицирует сырой чат (без хардкод-signalType и без contextCardId), петля закрытия матчит блок к открытой задаче (TaskClosureCandidate), суточная сборка материализует решение по этому матчу. Эмбеддер — детерминированный стаб (1536d); Issue.embedding засеян под текст блока (distance≈0), поэтому KNN-матч стабилен.

| проверка | доказывает | вердикт | детали |
|---|---|:---:|---|
| A1-классификация из сырого текста | R1/R7/A1 — block-ingest на сыром чате классифицировал signalType (не хардкод) | ✅ PASS | блоков 1: task_completed |
| Матч блок↔задача (TaskClosureCandidate) | A1 — петля закрытия связала кусок разговора с открытой задачей | ✅ PASS | candidate cmrbv41t1001dxhslvc4ln8js status=pending sim=1 |
| Материализация через матч (без contextCardId) | A1/A2 — решение из чата собрано по TaskClosureCandidate, а не по probe | ✅ PASS | TaskSolution cmrbv474b001ixhslya8renaj, owner=Иван, blocks=1 |
| Рецидив в старый canonical попадает в окно (свежий evidence) | R6/C1 — детекция по GREATEST(evidence.sourceTimestamp), не по IdeaBlock.createdAt | ✅ PASS | задача с createdAt блока 8 дней назад, но свежим evidence → материализована (окно по evidence) |
| Реально старый материал НЕ тянется в окно | C1 ловушка — окно не расширилось на старьё (только свежий evidence) | ✅ PASS | блок 8 дней назад + evidence 8 дней назад → вне окна (корректно) |
