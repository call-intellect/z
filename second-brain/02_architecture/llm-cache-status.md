---
type: architecture
status: verified
verified_at: 2026-05-25
---

# LLM prompt caching — что работает, что нет

> **Единственный источник правды** о том, в каких LLM-каналах Z prompt caching реально работает, и под какими условиями.
>
> Любое решение про cache prefix / экономику LLM-расходов должно опираться на эту таблицу. Если канал/модель тут отсутствуют — кэш по нему **не проверен**.
>
> **Методология:** контрольный эксперимент 2026-05-25. Скрипты [`probe-deepseek-cache.ts`](../../backend/scripts/eval/probe-deepseek-cache.ts) / [`probe-openai-proxy-cache.ts`](../../backend/scripts/eval/probe-openai-proxy-cache.ts) / [`probe-llm-cache-matrix.ts`](../../backend/scripts/eval/probe-llm-cache-matrix.ts). Полное описание методологии и сырые отчёты — [`backend/test/eval/cache-experiment/README.md`](../../backend/test/eval/cache-experiment/README.md).

## Итоговая матрица

| # | Канал | Модель | Кэш | Hit (идент. payload) | Параллельные 8× | Переменный хвост | Замечания |
|--:|---|---|:--:|--:|--:|--:|---|
| 1 | `deepseek` (прямой) | `deepseek-v4-pro` | ✅ | **99.9%** (до 43k) | 98.8% | 99.6% | Эталон. Chunk 64 ток. Cache hit на ~99% дешевле miss. |
| 2 | `deepseek` (прямой) | `deepseek-v4-flash` | ✅ | **99.9%** (до 50k) | **99.8%** | 99.8% | Идентично pro. |
| 3 | `openai-via-proxy` | `gpt-5-mini` | ✅ | **99.8%** (до 49k) | 96.8% | 97.2% | Chunk 128. Порог ≥1024 ток. Через `proxy.agent-lia.ru/v1/responses`. |
| 4 | `openai-via-proxy` | `gpt-5.4-mini` | ✅ | **99.7%** (до 49k) | 95.7% | 97.8% | Тот же канал, но **порог попадания в кэш выше — ~2048 ток** (при 1024 — 0%). |
| 5 | `minimax` (прямой) | `MiniMax-M2.5` | ✅ | **100.0%** (до 20k) | 87.0% | 99.3% | Anthropic-формат, **требует явный `cache_control: 'ephemeral'`**. ⚠ см. §«MiniMax — расширить cache_control на user». |
| 6 | `grsai` | `gemini-3-pro` (SSE) | ❌ | 0% | 0% | 0% | Канал не возвращает `cached_tokens` в usage. Не закладывать в экономику. |
| 7 | `kie` | `claude-opus-4-7` (Anthropic) | ❌ | 0% | 0% | 0% | `cache_read_input_tokens=0` даже с явным `cache_control`. KIE не пробрасывает caching. |
| 8 | `kie` | `gpt-5-4` (Responses) | ⚠ | 0% sequential, **46.9% parallel** | нестабильно | 0% | Похоже на балансировку на разные backend. Кэш «прыгает», воспроизводимости нет. |
| 9 | `kie` | `gemini-3-flash` (chat-compat) | ❌ | 0% | 0% | 0% | Кэш не работает. Очень медленный канал (~25 сек/запрос). |
| 10 | `ollama` | `qwen3.5:9b` | (не тестирован) | — | — | — | Локальный канал, prompt caching на уровне API не предусмотрен. Тестировать смысла нет. |
| 11 | `anthropic` (прямой) | claude-* | (не используется) | — | — | — | Решение владельца — Claude в Z **не закупаем**. См. [llm-providers-verified.md](../01_projects/llm-providers-verified.md). |

## Главные выводы

1. **Все 4 production-канала через `LlmRouter` поддерживают кэш на 95-99%:** `deepseek`, `openai-via-proxy` (любая gpt-5*), `minimax`. Это покрывает 100% LLM-вызовов в Z.
2. **KIE и GRSAI кэш НЕ пробрасывают** — это согласуется с тем, что они и так не подключены к `LlmRouter` (см. ТЗ [`2026-05-24-kie-grsai-llm-router-integration.md`](../../plans/archive/2026-05-24-kie-grsai-llm-router-integration.md)). При интеграции их в роутер — **в расчётах экономики кэш не учитывать**.
3. **`gpt-5.4-mini` порог попадания в кэш — ~2048 токенов** (vs ~1024 у `gpt-5-mini`). В проде это не проблема (типичные промпты >2k), но в малых классификаторах (`gpt-5.4-nano` для `theme-classify`, `entity-resolver`) кэша может не быть.
4. **`MiniMax` кэширует только с явным `cache_control: 'ephemeral'`.** В коде это сейчас выставляется **только на system**, не на user — см. [`llm-router.service.ts:1149`](../../backend/src/modules/ai/services/llm-router.service.ts#L1149). На больших user-промптах (транскрипт встречи) кэш упускается.

## Что должно быть идентично между вызовами для cache hit

| Поле payload | Должно совпадать? |
|---|:--:|
| `model` | ✅ да |
| `messages[]` (содержимое и порядок) | ✅ да, целиком до точки расхождения |
| `tools[]` (если есть) | ✅ да, та же сериализация |
| `tool_choice` | ✅ да |
| `response_format` | ✅ да |
| `reasoning` (effort) | ✅ да |
| `instructions` (OpenAI Responses) | ✅ да |
| `system[]` блоки + `cache_control` (Anthropic-формат) | ✅ да |
| `max_tokens` / `max_output_tokens` | ❌ не влияет |
| `temperature` | ❌ не влияет |
| `stream` | ❌ не влияет |

## 6 анти-паттернов, ломающих кэш

1. ❌ **Разный `system` на каждый шаг цепочки** — главная ошибка Variant Г эксп.3, где 8 параллельных специалистов имели свои промпты.
2. ❌ **Разные `tools[]` между вызовами** (даже того же набора, но в другом порядке).
3. ❌ **Переменное поле в начале user** — `Date.now()`, `requestId`, ID встречи в первой строке.
4. ❌ **Разный `response_format`** между вызовами.
5. ❌ **Разные модели** для одной цепочки.
6. ❌ **Изменение `tool_choice`** (`'auto'` vs forced) между вызовами.

## Размерные пороги

- **DeepSeek** (любая модель): минимум для кэша — **64 токена**. Chunk 64. Последний неполный chunk не кэшируется (норма).
- **OpenAI gpt-5-mini** через прокси: минимум — **1024 токена**, chunk 128.
- **OpenAI gpt-5.4-mini** через прокси: минимум — **~2048 токенов**, chunk 128.
- **MiniMax-M2.5**: chunk ~1024 (Anthropic-style). Минимум похожий.
- **KIE / GRSAI / Ollama**: кэш не пробрасывается — пороги не применимы.

## Где смотреть рабочие реализации

- DeepSeek: [`backend/src/modules/ai/services/deepseek.service.ts:235-239`](../../backend/src/modules/ai/services/deepseek.service.ts#L235-L239) — извлечение `cached_tokens`.
- OpenAI Responses через прокси: [`openai-proxy.service.ts:145`](../../backend/src/modules/ai/services/openai-proxy.service.ts#L145) — `input_tokens_details.cached_tokens`.
- Anthropic / MiniMax: [`anthropic.service.ts`](../../backend/src/modules/ai/services/anthropic.service.ts) — `cache_read_input_tokens` + `cache_creation_input_tokens` через `cache_control: 'ephemeral'`.

## Что делать с этим знанием

1. **§3 Б+ (объединённый вызов)** и **§1 meeting-report-fast** — кэш не нужен, нечего кэшировать (один вызов).
2. **§5 cache-prefix-everywhere** — применяем там, где есть цепочки ≥2 вызовов на одних данных. Гарантия экономии: **90-99%** на DeepSeek и OpenAI-via-proxy.
3. **MiniMax — расширить `cache_control: 'ephemeral'` также на user-сообщение** (сейчас только на system). Мини-ТЗ: [`plans/tz/2026-05-25-minimax-cache-control-on-user.md`](../../plans/tz/2026-05-25-minimax-cache-control-on-user.md).
4. **KIE/GRSAI** — в расчётах экономики Кора `cache hit` для них = 0. При подключении в `LlmRouter` (ТЗ [`2026-05-24-kie-grsai-llm-router-integration.md`](../../plans/archive/2026-05-24-kie-grsai-llm-router-integration.md)) — не закладывать скидку.

## Как переверифицировать

```bash
cd backend && bun scripts/eval/probe-llm-cache-matrix.ts                          # все 7 каналов
cd backend && bun scripts/eval/probe-llm-cache-matrix.ts --targets=deepseek-v4-flash,gpt-5.4-mini  # выборочно
```

Отчёт пишется в `backend/test/eval/cache-experiment/reports/matrix-<timestamp>.{json,csv}`. После прогона — обновить таблицу выше + дату `verified_at` в frontmatter.

## Связанные документы

- [llm-providers-verified.md](../01_projects/llm-providers-verified.md) — какие каналы вообще работают.
- [llm-router.md](../01_projects/llm-router.md) — реализация маршрутизации.
- [code-pitfalls.md](code-pitfalls.md) — раздел «LLM prompt caching».
- [§5 копилки ТЗ](../../plans/archive/2026-05-25-llm-architecture-changes-from-experiments.md) — архитектурный how-to применения cache-prefix.
- [cache-prefix-everywhere.md](../../plans/archive/2026-05-25-llm-cache-prefix-everywhere.md) — основное ТЗ исполнителю.

[[../index|← index]]
