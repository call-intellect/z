# Orchestrator-prompt — «Помощник как единый мозг каналов (Telegram/MAX)»

Самодостаточный промпт для запуска `tz-orchestrator`. **Не дублирует тело ТЗ — ссылается.** Запускать только по явному «начни реализацию» от владельца.

## Что реализуем
ТЗ: `plans/archive/2026-06-11-assistant-channels-telegram-max.md` (status: ready-to-implement). Идея: усилить существующего AI-помощника (`concierge`) и сделать Telegram/MAX **каналами-окнами** к нему — один мозг, много окон. 6 фаз, **один прод-релиз** (Ship-On, решение владельца В2). НЕ дублировать tool-логику в адаптерах (второй мозг — запрещено).

## Порядок чтения на старте
1. `CLAUDE.md` + `.claude/CLAUDE.md` (принципы 7 Bun-стек, 8 Ship-On/флаги; vexp-правило).
2. `second-brain/index.md` → `01_projects/conversational-channels.md`.
3. Анализ: `plans/analysis/2026-06-11-telegram-agentic-interface.md` (доказательство, gap-таблица, прод-логи) + PLAIN `…-tochka-A-tochka-B.md`.
4. Само ТЗ (контракты, фазы, acceptance).
5. Код-якоря (перечитать по символу, номера строк дрейфуют): `concierge/services/{concierge.service,tool-router.service,service-map-generator.service}.ts`; `conversational/conversational.service.ts` (`sendChatReply`/`selectBindingsForNotification`/`isQuietHour`); `conversational/conversational.module.ts` (`handleFreeNote`); `conversational/adapters/telegram-bot/telegram-bot.adapter.ts` (`renderText`/`classifyIntent`/`ingestUpdate`); `conversational/adapters/max-bot/max-bot.adapter.ts` (`renderText`); `chat-v2/chat-v2.module.ts` (`handleChatQuery`); `ai/services/{llm-router,deepseek,openai-proxy}.service.ts` (`tools`/`tool_calls`); `knowledge-core/services/dataclass-policy.service.ts` (`canEmit`/`checkLattice`); `rbac/policies/policy.csv`.

## Инструменты
- vexp-демон **выключен** (проверь `index_status`/попытку `run_pipeline`; если недоступен — хук НЕ блокирует) → используй Grep/Read/Glob. Если демон поднимут — `run_pipeline` первым.
- Внешние либы не вводим (нет новых зависимостей). Поведение провайдерского function-calling — проверять мини-e2e на моках, не угадывать.

## Граф фаз (волны)
- **Волна 1 (параллельно, независимы):** Ф1 (стоп-молчание), Ф2 (рендер Telegram+MAX), Ф3 (native-tools за kill-switch), Ф4 (service-auth путь ToolRouter).
- **Волна 2:** Ф5 (каналы→помощник; нужны Ф3+Ф4).
- **Волна 3:** Ф6 (whitelist self/all + текст-confirm; нужен Ф5).
- Между волнами: зелёная верификация → commit → следующая волна в том же ответе (push — с подтверждением владельца). Релиз — когда ВСЕ 6 зелёные ([[feedback_orchestration_no_stop_between_waves]]).

## Факт-чек (не верь отчёту суб-агента — [[feedback_agents_can_lie_about_edits]])
После каждой фазы — сам:
- Грепни маркеры: `dataClass: 'internal'`+`solicited` (Ф1); кейсы новых eventType в обоих renderText (Ф2); `CONCIERGE_NATIVE_TOOLS_ENABLED` (Ф3); `mode: 'service'` в ToolRouter (Ф4); `assistant_turn`+`ASSISTANT_CHANNEL_ROUTING_ENABLED` (Ф5); whitelist self/manager + отсутствие ссылки на `commitment-reliability` (Ф6).
- Re-Read изменённые файлы; свой `bun run typecheck && bun run lint && bun run build`; vitest по затронутым `*.spec.ts`.
- `git status` в отчёт; коммит по фазам (`feat(conversational+concierge): …`).

## Определение «фаза закрыта»
Все acceptance-предикаты фазы выполнены машинно (греп/тест/typecheck), «Что НЕ входит» соблюдено, `Закрывает: Rn` подтверждено.

## Развилки, которые НЕ переоткрывать (решены владельцем, ТЗ §«Принятые решения»)
В1 единый помощник; В2 все 4 шага один релиз; В3 self/all по RBAC; В5 channel-agnostic (Telegram сейчас, MAX скоро); В6 без кнопок; В7 «32 пачкой» вне scope; В8 память у помощника; В9 kill-switch на Ф3.

## Failure-modes / на что смотреть
- Ф1: не понизить `private`-факты (только `sensitive→internal`); не трогать другие вызовы `sendChatReply`.
- Ф3: OFF-ветка (regex) обязана работать без изменений; SYSTEM cache-friendly (tools уходят в API, не в текст).
- Ф4: cookie-путь web-чата НЕ менять; service-заголовок принимать только intra-process.
- Ф5: чек-ин (daily_plan/report) и task/show_tasks НЕ ломать; промежуточные события помощника НЕ слать в чат (text-only, без шума).
- Ф6: рядовой не должен видеть/исполнять manager-инструменты (двойная защита whitelist+RBAC); confirm-состояние одноразовое (Redis TTL).
- Если для памяти потребуется колонка `ConciergeConversation.channelBindingId` — это **HIGH**: Prisma-миграция + `02_architecture/data-model.md` + prod-deploy Шаг 4, согласовать с владельцем до правки схемы.

## После реализации
- Обнови ТЗ статусы фаз `[ ]→[x]` + «Итог».
- second-brain по таблице производных + `feature-flags.md` + prod-deploy-log Шаг 1 (и Шаг 4 если миграция).
- Реестр «не сделано»: vNext-хвосты (стрим в Telegram; новые руководительские инструменты; чек-ин через помощника).
- Рефлексия в `05_история/` + prod-инструкция в чат (diff команд: 2 флага + smoke).
