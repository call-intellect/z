# Runbook: высокая стоимость LLM

## Симптомы

- Алерт `llm_cost_runrate_high` (стоимость в час × 720 > бюджет на месяц).
- Дашборд cost показывает резкий рост.
- Уведомление админу при 80% / 95% / 100% бюджета.

## Диагностика

### 1. Какие модели тратят больше всего?

```
Grafana → Cost dashboard → breakdown by model
```

Обычно проблема:
- Слишком много вызовов к Sonnet/GPT-4o (надо понизить до Haiku).
- Reframer (M-14) запустился в рабочее время, не ночью.
- Большой historical backfill идёт через cloud, а не через local.

### 2. Какие операции тратят больше всего?

```
Langfuse → Traces → group by operation
```

Топ операций по cost:
- M-11 linker — нормально, основной траффик.
- M-05 analyzer — нормально на ingest spike.
- M-14 reframer — должен быть только ночью.
- M-23 chat — должен быть умеренно.

### 3. Какой тенант / пользователь / источник?

(Не для multi-tenant, но если SaaS-режим)

```
Langfuse → Traces → filter by tenant_id
```

## Действия

### A. Краткосрочное (немедленно)

#### A1. Переключить sensitive на локальные

```bash
./scripts/llm-policy.sh --data-class=sensitive --route=smart-local
```

Это безопасно — sensitive и так должны быть только локально, проверьте, что было.

#### A2. Принудительно использовать fast-default для классификаторов

```bash
./scripts/llm-policy.sh --task=theme_match --route=fast-default
./scripts/llm-policy.sh --task=signal_classify --route=fast-default
```

Snowball-эффект: классификаторы дешевле, но при перегрузке и они дают шум. Watch carefully.

#### A3. Включить semantic cache агрессивнее

```bash
./scripts/llm-cache.sh --semantic-similarity-threshold=0.90  # default 0.95
```

Это снижает качество ответов на 1-3%, но снижает стоимость на 30-50%.

#### A4. Лимит на пользователя

Если один пользователь генерирует много трафика:

```bash
./scripts/user-limit.sh --user-id=${USER_ID} --requests-per-day=50
```

#### A5. Hard cutoff

Если бюджет превышен на 200%+ → переключение всего на локальные:

```bash
./scripts/llm-policy.sh --emergency-mode
```

Это сильно деградирует UX, но останавливает счёт. Используется в крайнем случае.

### B. Среднесрочное (в течение недели)

#### B1. Анализ паттернов

Дашборд Grafana «Cost analysis» → найти аномалии.

Типичные находки:
- Один источник прислал 100k событий за день (например, импорт CSV) → анализировать только sample, остальное в очередь.
- Чат-сессии с длинной историей → ограничить контекст до 20 последних сообщений.
- Reframer работает > 4 часов → распределить на чанки или увеличить локальный hardware.

#### B2. Оптимизация промптов

Через Langfuse experiments:
- Сократить системный промпт на 30% — снижает input tokens.
- Использовать prompt caching (для Anthropic / Gemini).

#### B3. Hardware для local LLM

Если основная стоимость — cloud LLM, а данных по чувствительности много (что не должно быть так после A1) → инвестировать в GPU:
- 1× RTX 4090 24 GB (~250 000 ₽) → 70B Qwen в Q4 quantization.
- 1× A100 40 GB (~3 000 000 ₽) → 70B без quantization.

Оценить экономику: при > 20 000 ₽/мес внешний LLM cost — GPU окупается за 1-2 года.

### C. Долгосрочное

#### C1. Self-hosted models

Полный переход на локальные модели для не-public данных. Cloud — только для верхнего ультра-качественного analysis.

#### C2. Distillation

Если есть golden set — можно «дистиллировать» Sonnet в Qwen 14B на наших задачах. Сильно снижает cost.

#### C3. Контракт с провайдером

Для постоянного трафика — Pay-as-you-go превышается. Можно договориться:
- Volume commit с Anthropic/OpenAI (обычно 20-30% дешевле).
- Reserved capacity.

## Расследование (после кризиса)

Каждый cost spike → postmortem:
- Что вызвало?
- Почему мониторинг не предупредил раньше?
- Какие changes в политике / лимитах нужны?

Документировать в `runbook/postmortems/YYYY-MM-DD-cost-spike.md`.

## Превентивные меры

В постоянной работе:
- Дашборд cost всегда виден дежурному админу.
- Алерты на 50% / 80% / 95% / 100% бюджета.
- Soft-limits на embeddings, transcription (отдельные счётчики).
- Регулярный аудит трафика (раз в неделю).
- Performance review промптов и моделей (раз в квартал).
