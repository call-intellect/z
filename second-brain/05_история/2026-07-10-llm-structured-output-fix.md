# 2026-07-10 — Фикс структурной выемки LLM: forced tool_choice / thinking-модели

## Что было поставлено
Начался как прогон логов прода (скилл `progon`). На прогоне вскрылся отказ извлечения графа (`entity-graph-builder`/`block-linker` FAIL). Владелец расширил до **полной доказательной ревизии всех ~166 LLM-агентов**: раньше модели были в коде, вынесли в БД — после этого «сломалось»; проверить всё, доказательно, разными стендами и через прод; про flash→pro — **доказать**, что нужен только pro, иначе не трогать (дорого). Затем — критичная вводная: **с 29 июня не создаётся ни одной задачи** после встреч/чатов. Ультра-режим: оркестратор + агенты проверяют агентов. Итог: фикс-ТЗ → код на новой ветке → коммит+push → handoff.

## Как решал
- **Заземление на коде** (vexp недоступен для backend — искал через Bash/Read): нашёл `LlmRouterService`, `deepseek.service`, `isThinkingModel`, дефолт-сид роутинга, стенды `backend/scripts/eval/*`.
- **Репро (реальные ключи в `.env`, api.deepseek.com):** `probe-deepseek-formats` (flash==pro по форматам; `json_schema`→400, `tool_choice:required/forced`→400, `json_object`/`auto`→ok), `repro-block-linker`/`repro-entity-conformance`/`repro-intake` (flash+auto соответствует 4/4 на реальных схемах). Доказал корень: `forced tool_choice → 400 «Thinking mode does not support this tool_choice»` на ОБЕИХ моделях.
- **Прод-каталог (Playwright, суперадмин `admin@crossmark.ru` из `.env` `DIAG_ADMIN_*`):** `/admin/ai/catalog` — deepseek = api.deepseek.com/v1 OpenAI Chat; KIE smoke = «пустой ответ». `/admin/ai/routing` — 166 задач, 78 flash-primary.
- **Ультра-оркестрация `ww943hm9y`** (17 агентов, 1.4M токенов): health-матрица 125 агентов (healthy 107 · broken-forced 4 · broken-other 2 · unknown 12); adversarial flash vs pro (72 вызова, разрыв 0).
- **Фикс** (ветка `fix/2026-07-10-llm-structured-output` от dev, коммиты `9766d36e` + `6a0eebe0`): `isThinkingModel` → все `deepseek-v4*` thinking; `LLM_DEEPSEEK_FORCE_TOOL_CHOICE_ENABLED` дефолт false; диаг-логи (router validate-fail `out.text` + deepseek `finish=length`/битый JSON); тесты; feature-flags + prod-deploy-log; ТЗ + handoff.

## Что вышло
- **Верификация зелёная:** typecheck; vitest 87 (thinking 3, deepseek 12, llm-router 66, openai-chat adapter 6); lint 0.
- **Вердикт flash→pro: pro НЕ нужен** — доказано числами (flash==pro до десятой, ~3-12× дешевле). Модель не меняли.
- **Корень:** name-эвристика `isThinkingModel` мисклассифицировала `deepseek-v4-flash` → форс tool_choice → 400 → поверх validate-гейта каскад. Само-лечение маскировало это на задачах без validate-гейта.
- **Честно НЕ добито:** прод-фейл малых схем (`intake`) локально не воспроизводится — каждый честный путь против api.deepseek.com проходит. Диаг-логи (Фаза 0) в фиксе → следующий прод-прогон покажет фактический вывод. Фазы 2 (gemini-схемы), 3 (max_tokens/thinking), 4 (смежное) — в handoff.
- **Артефакт:** handoff `plans/2026-07-10-llm-structured-output-HANDOFF.md` для передачи агенту.

## Чему научился
- **DeepSeek-v4 (flash и pro) на api.deepseek.com — thinking-модели:** не поддерживают `response_format: json_schema` и `tool_choice: required/forced` (HTTP 400). Единственный рабочий структурный путь — `json_object` или tools+`tool_choice:'auto'`. Имя-эвристика для классификации моделей (`includes('pro')`) — грабля: ломается на новых именах (`-flash`); признак модели должен быть явным (список/флаг), не по подстроке.
- **«ok» в usage ≠ создан результат.** LLM ответил (ok), но вывод мог не пройти caller-validate → задача/ребро не создались. Провайдер-агностичный validate-fail (deepseek И gemini) объясняет «нет задач даже на kie».
- **Self-heal (retry на auto) маскирует баг:** задачи без validate-гейта «зелёные», хотя тратят лишний 400+retry; падают только те, где validate-callback превращает деградацию в отказ роутера.
- **Локально-проходит-прод-падает** — сигнал прод-рантайм-фактора (ревизия/флаги/входы), а не кода. Вывод: если нет лога фактического вывода на отказе — сначала добавь диаг-лог, деплой = диагностика (Шаг C протокола прогона).
- **Adversarial с числами** (равные условия auto, N прогонов, реальные схемы) — правильный способ закрыть «дорогая модель лучше?»: разрыв 0 → не тратим.

distilled: false
