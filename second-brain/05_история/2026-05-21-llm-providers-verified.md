---
date: 2026-05-21
tags: [ai, llm, smoke-test, инфраструктура, документация]
distilled: false
---

# Verified-карта LLM-провайдеров — smoke + фиксация

## Что было поставлено

Пользователь попросил «найти у нас все LLM, написать тесты, прогнать все рабочие текстовые модели (Ollama, наши внутренние, GPT), чтобы потом можно было использовать в проекте». После прогона уточнил: Anthropic не используем (ключа нет), embeddings через Ollama не делаем; **главное — зафиксировать рабочие вызовы где-то, чтобы при проектировании агентов оба (код и я) обращались только к проверенным каналам**.

## Как решал

### 1. Карта существующих каналов

Прочитал `docs/reference/llm-models-playbook.md` (плейбук переехал из корня в `docs/reference/` — старая ссылка из memory была неверной), `backend/src/modules/ai/services/*` и `env.schema.ts`. В коде есть 5 провайдеров: `anthropic`, `minimax`, `openai-via-proxy`, `deepseek`, `ollama`. Плейбук также упоминает `grsai` и `kie` для Gemini — в коде их нет, но ENV для них в schema есть.

### 2. Standalone smoke-test без Nest DI

Написал `backend/scripts/smoke-llm-providers.ts` — прямые вызовы через `@anthropic-ai/sdk` / `openai` / `fetch`, без БД и DI. Один и тот же промпт «Москва — столица РФ? Ответь: да или нет» по всем моделям, лог `status / latency / tokens / reply` в консоль + JSON-отчёт в `backend/tmp/`.

### 3. Три прогона — каждый дал свой урок

- **Первый прогон**: 20/21 fail с `401 invalid api key`. Причина: `bun` сам грузит `backend/.env` (плейсхолдеры из `.env.example`) из CWD до того, как мой dotenv доходит до root `.env`. Без `override: true` корневые реальные ключи проигрывают плейсхолдерам.
- **Второй прогон** (после `override: true`): 12/21 ok. Открылись новые проблемы:
  - `gpt-5.4*` / `gpt-5.5` не принимают `reasoning.effort='minimal'` — только `'none'|'low'|'medium'|'high'` (это допустимо лишь у старого `gpt-5`/`gpt-5-mini`/`gpt-5-nano`).
  - `deepseek-v4-flash`/`v4-pro`/`MiniMax-M2.5/M2.7` при `max_tokens=16` возвращают пустой текст — токены съедены reasoning.
  - На `ollama.agent-lia.ru` физически нет `qwen3:30b-a3b-instruct-2507` и нет `bge-m3` — только `qwen3.5:9b` и `kwangsuklee/Nanbeige4.1-3B`. Плейбук в этих местах **врёт**.
- **Третий прогон**: 17/22 ok. Anthropic 401 остаётся (ключ в .env — формат KIE, длина 32, начинается с `73bcc169…`; реального `sk-ant-…` нет). bge-m3 — нет на инстансе. KIE — нестабилен (timeout 60s после ok'а на 9s в прошлый раз). Nanbeige отвечает пустотой при выходе 256 токенов.

### 4. Фиксация в трёх местах

Пользователь явно попросил «оба обращались к рабочим вызовам» — то есть нужен жёсткий контракт для будущих сессий и для агентов.

1. **`second-brain/01_projects/llm-providers-verified.md`** — главный источник правды: 17 verified-моделей с готовыми snippets вызова на каждый канал; раздел «что НЕ работает / не используем» (Anthropic не закупаем, bge-m3 нет, qwen3:30b → qwen3.5:9b); 7 обязательных правил вызова (`max_tokens >= 256` для reasoning, корректный `reasoning.effort` для gpt-5.x, провайдеры только из verified).
2. **`plans/analysis/2026-05-21-llm-smoke-test.md`** — методология прогона, что нашли, какие правки внесли, дата следующей переверификации.
3. **`docs/reference/llm-models-playbook.md`** — баннер «целевая карта, не verified» + явный список расхождений (Anthropic / bge-m3 / qwen3:30b).
4. **`.claude/skills/z-ai-agent-rules/SKILL.md`** — добавил «Главное правило №0»: перед выбором LLM-канала сверяться с verified-картой; убрал устаревшие упоминания Claude как primary и неверные имена ENV (`ASR_BASE_URL` → `VOX_API_URL` и т.п.).
5. **`second-brain/index.md`** + memory `project_z_infra_and_ai.md` + `reference_llm_integration_crossmark.md` + `MEMORY.md` — ссылки и обновлённые статусы.

Коммит: `7ff40e5 docs(ai): verified-карта LLM-провайдеров (smoke-test 2026-05-21)`.

## Что вышло

- Прогнаны 22 модели, 17 verified, JSON-отчёт в `backend/tmp/llm-smoke-2026-05-21T14-21-50-086Z.json`.
- Verified-канал embeddings один: `text-embedding-3-small` через прокси (dim=1536).
- Все будущие AI-агенты (включая запланированные специалисты β/γ из зонтичного ТЗ «Второй мозг компании») должны использовать только модели из verified-карты.
- Memory `project_z_infra_and_ai.md` теперь явно фиксирует: Anthropic не используем, embeddings — только OpenAI через прокси, Ollama chat — только `qwen3.5:9b`.

## Чему научился

1. **Плейбук ≠ реальность.** «Целевая» карта моделей в плейбуке стихийно расходится с фактом: `bge-m3` обещан как primary embedding, но на инстансе не установлен; `qwen3:30b-a3b-instruct-2507` фигурирует везде, но физически нет (есть только `qwen3.5:9b`). Решение — отдельная verified-карта в `second-brain/01_projects/` с датой прогона; плейбук остаётся «целевым», но с баннером расхождений.
2. **`bun` + `.env` ловушка.** При запуске скриптов через `bun` из `backend/` он сам грузит `backend/.env` из CWD **до** старта пользовательского кода. Если там лежат плейсхолдеры из `.env.example` (как у нас), а реальные ключи — в корневом `.env`, нужно `dotenv.config({ path: '../.env', override: true })`. Без `override` корневые ключи проигрывают.
3. **Reasoning effort и max_tokens — два разных «бюджета».** `gpt-5.4*`/`gpt-5.5` не принимают `'minimal'` (только `'none'|'low'|'medium'|'high'`); старые `gpt-5`/`5-mini`/`5-nano` принимают. И reasoning-модели (`deepseek-v4-pro`, gpt-5*) при `max_tokens=16` возвращают пустой text — все токены ушли в скрытое рассуждение. Правило: для smoke и любых reasoning-задач — `max_tokens >= 256`.
4. **Anthropic в Z — закрыт.** Не как «опциональный fallback», как в плейбуке, а полностью: ключа нет, не закупаем. Любое упоминание Claude в новых ТЗ — повод напомнить пользователю, что мы решили иначе. Это перенесено в memory `project_z_infra_and_ai.md` и в skill `z-ai-agent-rules`.
5. **Verified-карта как контракт.** Сам факт того, что есть отдельный файл `second-brain/01_projects/llm-providers-verified.md` с готовыми snippets — это контракт: при проектировании агентов и я, и любой другой код-генератор должен сначала открыть этот файл, а не плейбук. Раз в квартал — или при появлении 401/403/404 в `AiUsageLog` — переверификация одной командой.
