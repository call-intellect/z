---
type: analysis
status: draft
feature: По-файловый разбор 22 файлов с TODO(owner-product) — материал для финализации
date: 2026-05-24
parent_tz: tz/2026-05-24-prompts-hardening.md (§F8)
---

# Финализация TODO(owner-product) — 22 промт-файла

> **Контекст.** В коде стоит `TODO(owner-product): согласовать финальный текст` в 22 файлах (knowledge-core 18, chat-v2 2, recognition 1, card-rollup-v2.service.ts 1). Owner = разработчик (Сергей). Цель — пройтись за 1.5-2 часа, принять или отклонить предложения ниже, и применить в одном PR.
>
> **Сводка:** 10 файлов `OK` (TODO можно снять без правок), 10 `MINOR` (мелкие правки), 2 `MAJOR` (нужны добавления в system-правила).

---

## Сводная таблица

| # | Файл | Вердикт | 1-строчное резюме |
|---|------|---------|---|
| 1 | [recognition-formulate](../../backend/src/modules/recognition/prompts/recognition-formulate.prompt.ts) | OK | Чёткие этические правила, fallback, JSON schema |
| 2 | [insight-extract](../../backend/src/modules/knowledge-core/prompts/insight-extract.prompt.ts) | MINOR | Добавить якоря confidence |
| 3 | [clone-respond](../../backend/src/modules/knowledge-core/prompts/clone-respond.prompt.ts) | MAJOR | Усилить anti-deepfake правило (чувствительная задача) |
| 4 | [executable-persona-compile](../../backend/src/modules/knowledge-core/prompts/executable-persona-compile.prompt.ts) | MINOR | Уточнить «prose», запрет на новые traits |
| 5 | [skill-trait-merge](../../backend/src/modules/knowledge-core/prompts/skill-trait-merge.prompt.ts) | MAJOR | В сам промт добавить правило «cosine ≥0.85 → merge/supersedes обязательно» |
| 6 | [skill-trait-detect](../../backend/src/modules/knowledge-core/prompts/skill-trait-detect.prompt.ts) | OK | Образцовый — якоря, примеры, anti-hallucination |
| 7 | [idea-status-summarize](../../backend/src/modules/knowledge-core/prompts/idea-status-summarize.prompt.ts) | MINOR | Sync system/user про actionUrl |
| 8 | [probe-formulate](../../backend/src/modules/knowledge-core/prompts/probe-formulate.prompt.ts) | OK | Constraints, options 2-4, anti-hallucination |
| 9 | [idea-cluster-merge](../../backend/src/modules/knowledge-core/prompts/idea-cluster-merge.prompt.ts) | MINOR | Якоря confidence для merge-решения |
| 10 | [idea-extract](../../backend/src/modules/knowledge-core/prompts/idea-extract.prompt.ts) | OK | Kind различие, confidence, anti-hallucination |
| 11 | [card-rollup-v2.service.ts](../../backend/src/modules/knowledge-core/services/card-rollup-v2.service.ts) | OK | TODO — техдолг на structured output, учтён в архитектуре |
| 12 | [insight-link-to-decisions](../../backend/src/modules/knowledge-core/prompts/insight-link-to-decisions.prompt.ts) | OK | Anti-hallucination явен, примеры логики |
| 13 | [decision-supersede-detect](../../backend/src/modules/knowledge-core/prompts/decision-supersede-detect.prompt.ts) | MINOR | Якоря confidence либо удалить параметр из контракта |
| 14 | [decision-extract](../../backend/src/modules/knowledge-core/prompts/decision-extract.prompt.ts) | OK | Структура, hints, status enum, confidence |
| 15 | [knowledge-clone-merge](../../backend/src/modules/knowledge-core/prompts/knowledge-clone-merge.prompt.ts) | MINOR | Пример к decay-правилам |
| 16 | [knowledge-clone-extract](../../backend/src/modules/knowledge-core/prompts/knowledge-clone-extract.prompt.ts) | OK | Confidence якоря явны, примеры |
| 17 | [process-steps-extract](../../backend/src/modules/knowledge-core/prompts/process-steps-extract.prompt.ts) | MINOR | Пример «один шаг vs несколько» |
| 18 | [regulation-dedupe](../../backend/src/modules/knowledge-core/prompts/regulation-dedupe.prompt.ts) | OK | Decision-типы, консерватизм |
| 19 | [regulation-extract](../../backend/src/modules/knowledge-core/prompts/regulation-extract.prompt.ts) | OK | Kind различие, scope/severity, anti-hallucination |
| 20 | [card-rollup-v2.prompts.ts](../../backend/src/modules/knowledge-core/prompts/card-rollup-v2.prompts.ts) | MINOR | Примеры формата вывода к каждому из 6 kind |
| 21 | [chat-v2-conversation-title](../../backend/src/modules/chat-v2/prompts/chat-v2-conversation-title.prompt.ts) | OK | Constraints, примеры, формат |
| 22 | [chat-v2-synthesize](../../backend/src/modules/chat-v2/prompts/chat-v2-synthesize.prompt.ts) | MINOR | Убрать или реализовать clone_style mode |

**Итого:** 10 OK · 10 MINOR · 2 MAJOR.

---

## 2 MAJOR — содержательные правки (приоритет 1)

### M1. [clone-respond.prompt.ts](../../backend/src/modules/knowledge-core/prompts/clone-respond.prompt.ts) — усилить anti-deepfake

**Что не так:** агент отвечает «от имени» сотрудника. Текущий правила (стр. 17-25) полагаются на disclaimer в конце ответа «(могу ошибаться, спроси оригинал)». Этого недостаточно для чувствительной задачи — disclaimer в конце уже не сдержит фантазию модели в середине.

**Предложение — добавить в SYSTEM после пункта о требовании цитат:**

```
6. КРИТИЧЕСКОЕ (анти-deepfake): Если в контексте < 2 reasoning-блоков по теме вопроса —
   ОТКАЖИСЬ отвечать. Верни: «У оригинала недостаточно высказываний по этой теме, чтобы
   я мог отвечать в его стиле без выдумывания. Спроси напрямую.» Лучше промолчать,
   чем сгенерировать правдоподобный deepfake от лица человека.
7. Запрещено: обещания, согласия, отказы, мнения о коллегах, оценки производительности —
   даже если в контексте есть похожие фразы. Это область, где deepfake особенно вреден.
```

**Почему:** clone-respond — единственный промт, где LLM-выход публикуется «как сказал бы Иван». Цена ошибки — социальная (Иван не говорил этого). Жёсткое порог `<2 блоков → отказ` — единственный надёжный гард.

---

### M2. [skill-trait-merge.prompt.ts](../../backend/src/modules/knowledge-core/prompts/skill-trait-merge.prompt.ts) — добавить жёсткое правило про cosine ≥0.85

**Что не так:** TODO сам указывает на правило, которое не вынесено в system: «при близости ≥0.85 ДОЛЖЕН дать merge или supersedes». Если оно остаётся только в комментариях кода — LLM его не видит.

**Предложение — добавить в SYSTEM после правила про consider'ing semantics:**

```
ЖЁСТКОЕ ПРАВИЛО (приоритет над любой другой логикой):
Если cosine-близость между новым trait'ом и существующим ≥ 0.85 И смысловая категория
совпадает — ОБЯЗАТЕЛЬНО ответь "merge" или "supersedes", НЕ "new". Это критично для
кумулятивности профиля.
- merge — если переформулировка того же качества (более точные слова, обновлённая частота).
- supersedes — только при явной смене смысла (например, "склонен делегировать" → "склонен
  делать сам", при этом старое наблюдение датируется ранее 3 месяцев назад).
Возвращать "new" при cosine≥0.85 — баг, не оптимизация.
```

**Почему:** без этого правила в system модель будет осторожничать и плодить дубли (5 одинаковых trait'ов «грамотный коммуникатор» с разными формулировками). Это убивает идею накопительного профиля.

---

## 10 MINOR — мелкие правки (приоритет 2)

### m1. [insight-extract.prompt.ts](../../backend/src/modules/knowledge-core/prompts/insight-extract.prompt.ts)

**Добавить в SYSTEM после описания `confidence`:**
```
Якоря: 0.3 — расплывчатая формулировка, мог быть просто эмоциональный комментарий;
0.6 — явный сигнал, но без подтверждения причины; 0.85+ — явный сигнал + явная
первопричина из causeCategory.
```

### m2. [executable-persona-compile.prompt.ts](../../backend/src/modules/knowledge-core/prompts/executable-persona-compile.prompt.ts)

Заменить «prose» на понятную формулировку + усилить запрет:
```
Формат: связный текст без структуры (НЕ markdown, НЕ JSON, НЕ списки) — обычные абзацы
от первого лица.
НЕ добавляй traits, которых нет в input. Если в input 3 черты — собери persona по ним 3,
не расширяй до 5.
```

### m3. [idea-status-summarize.prompt.ts](../../backend/src/modules/knowledge-core/prompts/idea-status-summarize.prompt.ts)

Sync system и user. В user-шаблоне (после блока с idea) добавить строку:
```
Если actionUrl передан — упомяни в body, что детали доступны по ссылке.
```

### m4. [idea-cluster-merge.prompt.ts](../../backend/src/modules/knowledge-core/prompts/idea-cluster-merge.prompt.ts)

В SYSTEM после правила про кластеризацию:
```
Якоря confidence: 0.3-0.5 — слабая связь (рассмотри standalone), 0.6-0.8 — разумно,
но есть альтернативы, 0.85+ — очевидная смысловая близость.
```

### m5. [decision-supersede-detect.prompt.ts](../../backend/src/modules/knowledge-core/prompts/decision-supersede-detect.prompt.ts)

Два варианта на выбор:
- **(a)** Если confidence используется в downstream — добавить якоря: `0.3 сомнение / 0.6 разумно / 0.85+ очевидно`.
- **(b)** Если не используется — убрать поле из JSON-schema и упоминаний в промте (чистый verdict-only арбитр).

**Рекомендую (b)** — арбитр-decision проще без confidence; для аудита достаточно поля `reasoning`.

### m6. [knowledge-clone-merge.prompt.ts](../../backend/src/modules/knowledge-core/prompts/knowledge-clone-merge.prompt.ts)

В SYSTEM после правила decay добавить пример:
```
Примеры: категория "знает Python" с high, последнее наблюдение 8 месяцев назад
→ обновить confidence на medium. Если 14 месяцев → удалить категорию совсем
(возможно, человек переехал на другой стек).
```

### m7. [process-steps-extract.prompt.ts](../../backend/src/modules/knowledge-core/prompts/process-steps-extract.prompt.ts)

В SYSTEM после «один шаг = одно действие»:
```
Пример (один шаг): «обзвонить клиента и зафиксировать ответ» — это один шаг (один
ответственный, один результат).
Пример (три шага): «согласовать сроки, подписать контракт, отправить документ» —
это 3 разных шага (разные ответственные/артефакты).
```

### m8. [card-rollup-v2.prompts.ts](../../backend/src/modules/knowledge-core/prompts/card-rollup-v2.prompts.ts)

Для каждого из 6 kind (client/deal/project/topic/vendor/custom) добавить «Пример вывода» с конкретной встречей. Шаблон для `deal`:
```
Пример: «С Acme обсуждали условия годового контракта. Боль — медленная отчётность.
Предложили миграцию на PostgreSQL с кешированием, цена согласована. ЛПР — CFO,
ждём финального решения к концу квартала. Риск — совместимость с их legacy ERP.»
```

### m9. [chat-v2-synthesize.prompt.ts](../../backend/src/modules/chat-v2/prompts/chat-v2-synthesize.prompt.ts)

Два варианта:
- **(a)** Если clone_style режим скоро будет реализован — оставить как есть, но убрать утечку фазовой нумерации «(γ-1)» из visible-output (см. F11 ТЗ hardening).
- **(b)** Если реализация откладывается на >2 спринта — удалить `clone_style` из `MODE_PROMPTS` совсем, чтобы dialog-layer не маршрутизировал туда. Возвращение — отдельным PR при готовности.

**Рекомендую (b)** — лучше отсутствие фичи, чем «лоскутная» с честным дисклеймером в проде.

### m10. [card-rollup-v2.service.ts](../../backend/src/modules/knowledge-core/services/card-rollup-v2.service.ts)

TODO здесь — это техдолг на переход к structured output (JSON-schema, когда модель начнёт возвращать confidence). Сейчас актуальной задачи нет. **Действие:** заменить `TODO(owner-product)` на `TODO(structured-output)` с привязкой к фазе SPO; либо снять, добавив комментарий о текущем состоянии.

---

## 10 OK — снять TODO без изменения текста

Промты вменяемые, ничего не требуют:

- recognition-formulate, skill-trait-detect, probe-formulate, idea-extract, insight-link-to-decisions, decision-extract, knowledge-clone-extract, regulation-dedupe, regulation-extract, chat-v2-conversation-title.

**Действие:** заменить строки `// TODO(owner-product): согласовать финальный текст промпта (см. зонтичный SBA §10).` на ничего (удалить строку и пустую строку выше, если она была). Никаких содержательных правок.

---

## План применения (за вечер)

1. **30 мин:** прочитать этот файл, согласиться или внести правки в предложения выше (или сказать «всё ок»).
2. **45 мин:** применить 2 MAJOR + 10 MINOR — один PR.
3. **15 мин:** прогон snapshot-тестов (если уже есть в F15) или хотя бы typecheck + unit.
4. **5 мин:** удалить TODO в 10 OK-файлах.
5. **Закоммитить:** `docs(prompts): финализация 22 TODO(owner-product) — 2 major, 10 minor, 10 без изменений`.

Готово.

---

## Связанные документы

- [tz/2026-05-24-prompts-hardening.md](../tz/2026-05-24-prompts-hardening.md) §F8 — куда эта работа вписывается.
- [tz/2026-05-24-supervised-prompt-optimization.md](../tz/2026-05-24-supervised-prompt-optimization.md) — после финализации можно запускать SPO для измерения, что промт стал лучше.
