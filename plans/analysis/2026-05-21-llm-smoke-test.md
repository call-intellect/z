# LLM smoke-test всех провайдеров — 2026-05-21

> Разовый прогон по всем LLM-каналам и моделям, доступным проекту Z, с целью
> зафиксировать **что реально работает прямо сейчас**, чтобы код агентов и
> дальнейшее проектирование `LlmTaskRoute` опирались на верифицированные
> вызовы, а не на «целевую» таблицу плейбука.
>
> Источник правды по результату — [second-brain/01_projects/llm-providers-verified.md](../../second-brain/01_projects/llm-providers-verified.md).
> Этот файл — фиксация контекста (как тестировали, что нашли, что поправили).

## Зачем

Плейбук [llm-models-playbook.md](../../docs/reference/llm-models-playbook.md) описывает целевую
карту моделей и fallback'ов, но не подтверждает их работоспособность на
конкретный момент времени. ENV-ключи могли протухнуть, провайдеры — поменять
требования, на self-hosted Ollama могут не оказаться моделей, которые
обещаны (что и обнаружилось).

Перед тем, как закладывать модели в `LlmTaskRoute` для нового агента, нужна
**verified-карта**, которую можно перепроверять одной командой.

## Что сделано

1. Написан `backend/scripts/smoke-llm-providers.ts` — standalone-скрипт без
   Nest DI и БД, прямые вызовы провайдеров. Грузит `.env` корня репозитория
   через dotenv (`override: true`), потому что `bun` сам подхватывает
   `backend/.env` из CWD раньше — а там лежат плейсхолдеры из `.env.example`.
2. Один и тот же лёгкий промпт «Является ли Москва столицей России? Ответь:
   да или нет» прогоняется по 21 модели + 2 embedding-каналам.
3. Результат — таблица в консоли (status / latency / tokens / reply) + JSON в
   `backend/tmp/llm-smoke-<timestamp>.json`.

Запуск:
```bash
cd backend && bun scripts/smoke-llm-providers.ts
# опционально:
bun scripts/smoke-llm-providers.ts --only=deepseek,openai-via-proxy
bun scripts/smoke-llm-providers.ts --skip=kie-gemini
```

## Результаты финального прогона

**Итого: ok=17, fail=5, всего=22.**

| Провайдер | Модель | Статус | Latency, ms | in/out tokens | Ответ |
|---|---|---|---|---|---|
| anthropic | claude-sonnet-4-6 | ✗ 401 | — | — | invalid x-api-key |
| anthropic | claude-haiku-4-5-20251001 | ✗ 401 | — | — | invalid x-api-key |
| anthropic | claude-opus-4-7 | ✗ 401 | — | — | invalid x-api-key |
| minimax | MiniMax-M2.5 | ✓ | 1849 | 14/74 | да |
| minimax | MiniMax-M2.7 | ✓ | 2932 | 60/110 | да |
| openai-via-proxy | gpt-5.5 | ✓ | 3011 | 48/5 | да |
| openai-via-proxy | gpt-5.4 | ✓ | 1400 | 48/33 | да |
| openai-via-proxy | gpt-5.4-mini | ✓ | 1173 | 48/23 | да |
| openai-via-proxy | gpt-5.4-nano | ✓ | 1481 | 48/23 | да |
| openai-via-proxy | gpt-5-mini | ✓ | 923 | 48/19 | да |
| openai-via-proxy | gpt-4.1-mini | ✓ | 3407 | 49/2 | да |
| openai-via-proxy | gpt-4o-mini | ✓ | 1718 | 49/2 | Да |
| deepseek | deepseek-v4-flash | ✓ | 1325 | 50/37 | да |
| deepseek | deepseek-v4-pro | ✓ | 3157 | 50/39 | да |
| deepseek | deepseek-chat | ✓ | 778 | 50/1 | да |
| ollama | qwen3.5:9b | ✓ | 7998 | 53/255 | да |
| ollama | Nanbeige4.1-3B | ⚠ ok-empty | 12007 | 69/256 | (пусто) |
| grsai-gemini | gemini-3-pro | ✓ | 10509 | 129/262 | Да |
| grsai-gemini | gemini-3.1-pro | ✓ | 9451 | 130/181 | да |
| kie-gemini | gemini-3-pro | ✗ timeout | — | — | таймаут 60s (в предыдущем прогоне отвечал за 9.4s) |
| embeddings-openai | text-embedding-3-small | ✓ | 1366 | 27/0 | dim=1536, vectors=2 |
| embeddings-ollama | bge-m3 | ✗ 404 | — | — | Model "bge-m3" is not installed |

## Что обнаружилось и что решили

### 1. Anthropic-канал — ключа нет

`ANTHROPIC_API_KEY` в `.env` имеет длину 32 и формат `73bcc169…56f1` —
это **значение KIE-ключа**, а не `sk-ant-…`. Видимо при копировании
перепутали.

**Решение владельца:** Anthropic в Z **не используем**. Ключ не закупаем.
Сервис `AnthropicService` остаётся в коде на случай будущего A/B, но в
дефолтных `LlmTaskRoute.providers` Claude не должен фигурировать.

### 2. Embeddings через Ollama — не делаем

На нашем `ollama.agent-lia.ru` физически установлены только:
- `qwen3.5:9b`
- `kwangsuklee/Nanbeige4.1-3B.Q4_K_M:latest`

Никакого `bge-m3`. Плейбук §2.1 и §10 врут — там обещаны `bge-m3` и
`qwen3:30b-a3b-instruct-2507`.

**Решение владельца:** embeddings через Ollama **не делаем**. Единственный
verified канал embeddings — `text-embedding-3-small` через прокси (dim=1536).

### 3. Reasoning effort 'minimal' — только для старого gpt-5

`gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5.5` отвечают 400:
> Unsupported value: 'minimal' is not supported with the 'gpt-5.4' model.
> Supported values are: 'none', 'low', 'medium', 'high'.

Старые `gpt-5`, `gpt-5-mini`, `gpt-5-nano` 'minimal' принимают.

В smoke поправили — для не-старых gpt-5* шлём `effort: 'low'`. В
`OpenAiProxyService.complete()` сейчас дефолт `'medium'`, что работает — но
надо учитывать при кастомных вызовах.

### 4. max_tokens=16 убивает reasoning-модели

`deepseek-v4-flash`, `deepseek-v4-pro`, `MiniMax-M2.5/M2.7` при `max_tokens=16`
возвращают пустой `content`: токены целиком уходят в reasoning/thinking. После
поднятия до `max_tokens=256` все четыре отвечают «да».

**Правило:** для reasoning-моделей всегда закладывать `max_tokens >= 256`
(и больше, если ожидается осмысленный ответ).

### 5. Nanbeige4.1-3B бесполезна

Истратила 256 output-токенов, текст пустой — несовместимость формата
ответа с OpenAI-compat chat. Не использовать.

### 6. KIE нестабилен

В одном прогоне ответил за 9.4 сек, в следующем — timeout 60 сек. Это
согласуется с плейбуком §9 (отдельная длинная retry-лестница
`[3000, 6000, 10000, 15000]ms`). В дефолтные fallback'ы класть **только с
ретраями**.

### 7. dotenv override:true для root .env

`bun` сам грузит `.env` из CWD до старта пользовательского кода. Если в
`backend/.env` лежат плейсхолдеры из `.env.example` (а у нас именно так),
а реальные ключи лежат в `c:/work/z/.env`, то без `override: true` в
`dotenv.config()` корневые ключи проигрывают плейсхолдерам и все 401.

Зафиксировано в коде smoke-теста и в комментарии в файле.

## Решения для проектирования агентов

Все занесены в **[second-brain/01_projects/llm-providers-verified.md](../../second-brain/01_projects/llm-providers-verified.md)** — это теперь единственный источник правды:

1. **Primary stack:** DeepSeek V4 (flash + pro) и OpenAI gpt-5.x через
   прокси — оба работают, дефолты из плейбука §2.1 валидны.
2. **Embeddings:** только `text-embedding-3-small` через прокси (dim=1536).
3. **Anthropic — не используем**, в дефолты не класть.
4. **`bge-m3` — не используем**, в дефолты не класть.
5. **Ollama secondary fallback** — только `qwen3.5:9b`; везде, где плейбук
   упоминает `qwen3:30b-a3b-instruct-2507`, читать как `qwen3.5:9b`.
6. **`max_tokens >= 256`** для reasoning-моделей (deepseek-v4-pro, gpt-5*).
7. **reasoning effort** для gpt-5.4*/gpt-5.5 — `'none'|'low'|'medium'|'high'`
   (без `'minimal'`); для старых gpt-5*/mini/nano — `'minimal'` тоже ок.

## Что обновлено в репозитории

- `backend/scripts/smoke-llm-providers.ts` — standalone smoke-test (новый файл).
- `second-brain/01_projects/llm-providers-verified.md` — verified-карта
  с образцами вызова (новый файл).
- `second-brain/index.md` — ссылка на verified-карту.
- `llm-models-playbook.md` — пометки о расхождениях между целевой картой и
  реальностью (отмечены датой verified).
- `.claude/skills/z-ai-agent-rules/SKILL.md` — обновлён раздел LLM
  (Claude не дефолт, embeddings → только прокси) + ссылка на verified-карту.
- Memory `project_z_infra_and_ai.md` — отмечено, что Anthropic и Ollama
  embeddings не используем.

## Что НЕ сделано (осознанно)

- **Plain text** на reasoning-tradeoffs (`'high'` vs `'low'` для конкретных
  задач) — это работа бенчмарка §15 плейбука, не smoke.
- **Retry для KIE** — в smoke оставлен один проход, чтобы быстро видеть
  состояние. Для прод-использования KIE надо ставить длинную ретрай-лестницу
  на уровне сервиса (в коде сервиса для KIE его пока нет вообще, потому что
  KIE не подключён к `LlmRouter` как provider — только как кандидат).
- **Метрики стоимости** — `costUsd` в smoke не считается, потому что нет
  доступа к `LlmModelPrice` (это standalone-скрипт без БД). Для биллинга
  считает `LlmRouterService.computeCostUsd()`.

## Дата следующей переверификации

Запускать smoke перед любым из событий:
- Раз в квартал (2026-08-21 в плановом порядке).
- При добавлении новой модели в плейбук.
- Перед сменой `LlmTaskRoute.providers` через Z-Admin на проде.
- Если в логах `AiUsageLog` появляются 401 / 403 / 404 от провайдера.
