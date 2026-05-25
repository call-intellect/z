# Cache experiment — что работает, что нет

Контрольная серия экспериментов от 2026-05-25, чтобы понять, в каких LLM-каналах Z prompt caching реально работает и под какими условиями.

> **Главный источник правды** — [`second-brain/02_architecture/llm-cache-status.md`](../../../../second-brain/02_architecture/llm-cache-status.md). Этот README описывает методологию и хранит сырые отчёты для воспроизводимости.

## Зачем всё это

Гипотеза «DeepSeek кэширует только первые ~2700 токенов» (артефакт Variant Г эксперимента 3 specialists) выглядела подозрительно. Нужно было:
1. Проверить, действительно ли есть потолок кэша.
2. Понять, где (в каких каналах) кэш работает, где нет.
3. Зафиксировать **технические границы** (минимальный размер, chunk, что должно совпадать в payload).

## Что внутри

```
cache-experiment/
├── README.md                          ← этот файл
└── reports/
    ├── probe-2026-05-25T11-21-55-679Z.{json,csv}             # DeepSeek-V4-Pro прямой канал
    ├── openai-proxy-probe-2026-05-25T11-30-31-049Z.{json,csv} # gpt-5-mini через proxy.agent-lia.ru
    ├── matrix-2026-05-25T12-00-28-126Z.{json,csv}            # Полная матрица 7 каналов (5 ОК, 2 фикс был нужен)
    └── matrix-2026-05-25T12-03-36-223Z.{json,csv}            # Повторный прогон MiniMax + KIE-GPT после фикса
```

## Скрипты

| Скрипт | Что проверяет |
|---|---|
| [`backend/scripts/eval/probe-deepseek-cache.ts`](../../../scripts/eval/probe-deepseek-cache.ts) | DeepSeek-V4-Pro прямой канал, 3 сценария (S1 sequential, S2 8-parallel, S3 переменный хвост). |
| [`probe-openai-proxy-cache.ts`](../../../scripts/eval/probe-openai-proxy-cache.ts) | gpt-5-mini через `proxy.agent-lia.ru/v1/responses` (продовый путь). |
| [`probe-llm-cache-matrix.ts`](../../../scripts/eval/probe-llm-cache-matrix.ts) | **Универсальный матричный probe** для всех 7 production-каналов: deepseek-v4-flash, gpt-5.4-mini, MiniMax-M2.5, GRSAI Gemini-3-pro, KIE Claude opus-4-7, KIE GPT-5-4, KIE Gemini-3-flash. |

## 3 сценария на каждом канале

- **S1 — sequential identical:** 2 идентичных запроса подряд на размерах 1024…50000 токенов. На 2-м запросе должен быть `cached_tokens ≈ promptTokens − последний неполный chunk`. Если есть «потолок» — увидим plateau.
- **S2 — 8 parallel identical:** 8 одинаковых запросов в `Promise.all` на 10k токенов. Воспроизводит условия Variant Г, но без разных tool-схем — изолированно проверяет: ломает ли параллельность кэш?
- **S3 — общий префикс + переменный хвост:** 41-символьный уникальный suffix на конце user. Имитация прода (где обычно meaningfully варьируется только конец).

Метрики: `prompt_tokens`, `cached_tokens`, `completion_tokens`, `latency_ms`, `cache_hit_ratio`, `cost_usd`. Сырое `usage` от провайдера сохраняется в JSON для диагностики.

## Главные находки

| Канал | Кэш | Hit max | Замечания |
|---|:--:|--:|---|
| `deepseek-v4-pro` / `v4-flash` (прямой) | ✅ | 99.9% | Эталон. Chunk 64. Тестировано до 50k токенов. |
| `gpt-5-mini` через прокси | ✅ | 99.8% | Chunk 128. Порог 1024. |
| `gpt-5.4-mini` через прокси | ✅ | 99.7% | **Порог попадания ~2048** (vs 1024 у gpt-5-mini). |
| `MiniMax-M2.5` (прямой Anthropic-формат) | ✅ | 100.0% | Требует явный `cache_control: 'ephemeral'`. |
| `grsai gemini-3-pro` (SSE) | ❌ | 0% | usage не содержит `cached_tokens`. |
| `kie claude-opus-4-7` | ❌ | 0% | `cache_read_input_tokens=0` даже с `cache_control`. |
| `kie gpt-5-4` | ⚠ | parallel 47% | Балансировка на разные backend, нестабильно. |
| `kie gemini-3-flash` | ❌ | 0% | Кэш не работает, ~25 сек/запрос. |

**Полная таблица + интерпретация** — в [`llm-cache-status.md`](../../../../second-brain/02_architecture/llm-cache-status.md).

## Что опровергнуто

1. ❌ **«Потолок 2700 токенов» в DeepSeek** — на самом деле кэш покрывает 99.9% префикса до 43-50k токенов.
2. ❌ **«Параллельные запросы ломают кэш»** — 8 одинаковых параллельных запросов кэшируются на 95-99%.
3. ❌ **«Реалистичные 20-30% — это потолок DeepSeek»** — 21% в Variant Г было артефактом сломанного префикса (разные `system`/`tools`/`submit_<name>` в каждом из 8 специалистов).

## Как воспроизвести

```bash
cd backend

# отдельные probe (быстрее, дешевле):
bun run scripts/eval/probe-deepseek-cache.ts
bun run scripts/eval/probe-openai-proxy-cache.ts

# полная матрица (все 7 каналов; ~10 минут, ~$0.30):
bun run scripts/eval/probe-llm-cache-matrix.ts

# выборочно:
bun run scripts/eval/probe-llm-cache-matrix.ts --targets=deepseek-v4-flash,gpt-5.4-mini
```

Отчёты сохраняются автоматически в `reports/<timestamp>.{json,csv}`. После прогона — обновить `verified_at` в [`llm-cache-status.md`](../../../../second-brain/02_architecture/llm-cache-status.md).

## Бюджет прогона

| Скрипт | ~Стоимость | Время |
|---|--:|--:|
| probe-deepseek-cache | $0.02 | 70 сек |
| probe-openai-proxy-cache | $0.02 | 40 сек |
| probe-llm-cache-matrix (все 7) | $0.30-0.40 | ~10 мин (доминируют GRSAI/KIE-Gemini ~25 сек/запрос) |

## Связанные документы

- [`second-brain/02_architecture/llm-cache-status.md`](../../../../second-brain/02_architecture/llm-cache-status.md) — финальная матрица «что работает, что нет».
- [`plans/tz/2026-05-25-llm-cache-prefix-everywhere.md`](../../../../plans/tz/2026-05-25-llm-cache-prefix-everywhere.md) — ТЗ исполнителю на применение cache-prefix.
- [`plans/tz/2026-05-25-llm-architecture-changes-from-experiments.md`](../../../../plans/tz/2026-05-25-llm-architecture-changes-from-experiments.md) §5 — архитектурный how-to.
- [`plans/tz/2026-05-25-minimax-cache-control-on-user.md`](../../../../plans/tz/2026-05-25-minimax-cache-control-on-user.md) — мини-ТЗ на расширение `cache_control` на user в MiniMax/Anthropic-формате.
