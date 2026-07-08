# regulation-stand — e2e (сырой текст → block-ingest → матч → сборка)

Прогон: `probe-verify-fix` · проверок 9 · PASS 9/9.

> E2e-режим гоняет РЕАЛЬНЫЙ конвейер. P1 (основной поток владельца): закрытие задачи поднимает probe `task.method_capture` («расскажи как решал»), реальный ответ через `respondToProbe` ингестится с `contextCardId=issue.id`+`signalTypeHint=reasoning`, block-ingest даёт reasoning-блок, сборка материализует `TaskSolution` для УЖЕ ЗАКРЫТОЙ задачи по probe-арму (contextCardId), а не по closure-петле. **Value-гейт диспетчера здесь на реальном дефолте (ON): `task.method_capture` выведен из-под LLM-гейта ценности (`gate()` → `method_capture_complexity_gated`), т.к. уже прошёл детерминированный порог сложности при подъёме — иначе гейт спорадически душил опросник (`dropped_low_value`).** A1/A2: block-ingest классифицирует сырой чат (без хардкод-signalType и contextCardId) → closure-петля матчит блок к открытой задаче (TaskClosureCandidate) → сборка. C1: окно рецидива по `GREATEST(evidence.sourceTimestamp)`. Эмбеддер — детерминированный стаб (1536d); Issue.embedding засеян под текст блока (distance≈0).

| проверка | доказывает | вердикт | детали |
|---|---|:---:|---|
| Опросник «как решал» поднят на закрытии задачи | реальный триггер: задача→completed поднимает probe task.method_capture с contextCardId=issue | ✅ PASS | probe status=dispatched notif=cmrc6r016000wg9slxnuh6w9a |
| Ответ → RawEvent с contextCardId=задача + hint=reasoning | ключевое звено: ответ несёт contextCardId=issue.id и signalTypeHint=reasoning (probe-арм детекции) | ✅ PASS | RawEvent cmrc6r2mu001cg9sld2b15frx contextCardId=cmrc6qwym000jg9slmhy1fvto hint=reasoning |
| Ответ стал каноническим reasoning-блоком | block-ingest ответа → IdeaBlock(reasoning) + IdeaBlockEvidence→RawEvent | ✅ PASS | блоков 10: reasoning, reasoning, reasoning, reasoning, reasoning, reasoning, reasoning, reasoning, reasoning, reasoning |
| Материализация по probe-арму для ЗАКРЫТОЙ задачи | A1 основной поток: закрыл→опросник→ответ→TaskSolution через contextCardId (не closure-петля) | ✅ PASS | TaskSolution cmrc6su5u00a8g9slugkguymy owner=Иван closed=true blocks=10 |
| A1-классификация из сырого текста | R1/R7/A1 — block-ingest на сыром чате классифицировал signalType (не хардкод) | ✅ PASS | блоков 1: task_completed |
| Матч блок↔задача (TaskClosureCandidate) | A1 — петля закрытия связала кусок разговора с открытой задачей | ✅ PASS | candidate cmrc6t8e000c3g9slmc8daf26 status=pending sim=1 |
| Материализация через матч (без contextCardId) | A1/A2 — решение из чата собрано по TaskClosureCandidate, а не по probe | ✅ PASS | TaskSolution cmrc6tcyq00clg9slfi7c3c9e, owner=Иван, blocks=1 |
| Рецидив в старый canonical попадает в окно (свежий evidence) | R6/C1 — детекция по GREATEST(evidence.sourceTimestamp), не по IdeaBlock.createdAt | ✅ PASS | задача с createdAt блока 8 дней назад, но свежим evidence → материализована (окно по evidence) |
| Реально старый материал НЕ тянется в окно | C1 ловушка — окно не расширилось на старьё (только свежий evidence) | ✅ PASS | блок 8 дней назад + evidence 8 дней назад → вне окна (корректно) |
