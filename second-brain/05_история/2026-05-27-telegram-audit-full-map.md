---
date: 2026-05-27
tags: [telegram, audit, conversational, ingest, testing]
distilled: false
---

# Рефлексия: полный аудит Telegram-интеграции в Z

## Что было поставлено

Пользователь попросил изучить всё, что связано с Telegram в проекте: second-brain, код,
архитектуру, тесты, LLM-маршруты — и дать понимание того, как это работает, и как тестировать.

## Как решал

Запустил три параллельных агента:
1. Агент по second-brain-документам (4 файла: conversational-channels.md + три рефлексии).
2. Агент по 12 основным Telegram-файлам в conversational + admin модулях.
3. Агент по ingest-адаптеру, destinations-сендеру и регистрации в модулях.

Затем ещё два параллельных:
4. Агент по 8 spec-файлам + seed-скриптам.
5. Агент по env.schema.ts + module registrations + кронам.

Итого: изучено ~25 файлов кода + 4 second-brain-документа.
Никаких изменений в коде не было — чисто аудит.

## Что получилось

Сформирована полная карта:

**Три независимых Telegram-потока:**
- Conversational-бот (`@kora_bot`): двусторонний, глобальный, zero-button, задачи+вопросы+дайджест.
- Ingest-адаптер: пассивный сбор из корп-чатов в граф знаний.
- Destinations-сендер: исходящие алерты через токен клиента.

**Архитектурные решения:**
- Прокси `telegram.crossmark.ru` — единственный выход в прод (ДЦ Новосибирска).
- Токен бота — зашифрован в БД, никогда не в ENV.
- Глобальный `Channel` (tenantId IS NULL) — один бот на всю платформу с β-9.
- 4 LLM-задачи засиданы: `telegram-create-task`, `telegram-forward-to-task`, `telegram-reply-classify`, `telegram-digest-formulate`.
- 101+ юнит-тест в 8 spec-файлах.

**Гайд по тестированию:**
- Юнит-тесты — можно запускать сразу без бота.
- Live-тест — нужен токен из `@BotFather` + публичный URL + `TELEGRAM_PROXY_ENABLED=false` на dev-машине.
- Два seed-скрипта нужно проверить/запустить: `seed-global-channels.ts` и `seed-llm-task-routes-tracker-phase4-telegram.ts`.

## Чему научился

- Кроны `TelegramDigestCron` и `TelegramProxyHealthCron` живут в HTTP-процессе (не в worker-процессе).
  Это важно — если HTTP не запущен, крон не работает.
- `seed-global-channels.ts` создаёт только «пустую» запись `Channel` (config={}),
  без токена — токен заполняется отдельно через admin UI.
- При `TELEGRAM_PROXY_ENABLED=true` ingest-адаптер (`/ingest/telegram/:sourceId`) имеет
  ограничение: прокси пропускает только зарегистрированные ботовые токены.
  Per-source ingest-бот нужно регистрировать в admin-панели прокси отдельно.
- `TelegramBotMessageHandler` инжектирует трекерные зависимости (`IssuesService`, `CommentsService`)
  через `@Optional()` — работает в деградированном режиме если трекер не подключён.
