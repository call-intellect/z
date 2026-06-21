---
type: analysis
status: research-input
feature: universal-daily-checkin-fixator
date: 2026-06-21
snapshot_date: 2026-06-21
segment: технический разрез + OSS + ограничения Telegram Bot API + маппинг на стек Z
---
# Технический разбор: групповые standup-боты, OSS, Telegram Bot API

## КЛЮЧЕВОЙ ВЫВОД — ограничения Telegram Bot API для групп
Два жёстких ограничения определяют всю архитектуру «бота в группе»:

**1. Privacy mode — бот по умолчанию НЕ видит обычные сообщения группы.** Включён по умолчанию для всех ботов, кроме админов группы. С ним бот получает только: команды `/cmd@bot`; общие команды если бот писал последним; inline; **reply на сообщения бота**. Обычный «отчёт в чат» бот не увидит. Чтобы видеть всё — выключить privacy (`/setprivacy` у @BotFather → **переподключить бота к группе**) или сделать ботом-админом. [core.telegram.org/bots/features, 2026-06-21]

**2. Bot API не отдаёт историю — нет метода «забрать чат за сутки».** Нет `getChatHistory`/`getMessages` (только sendMessage/edit/delete/forward/copy/getFile). `getUpdates`/`setWebhook` — только real-time с момента добавления бота, не возвращают сообщения ДО подключения. Полную историю даёт только MTProto/Client API (userbot), не Bot API. [core.telegram.org/bots/api, grokipedia Telegram Bot API Limitations, 2026-06-21]

**Следствие для Z.** Модель «бот пассивно сидит в группе и раз в сутки скачивает переписку» на Bot API **нереализуема**. Возможны две модели:
- **(A) Реактивный перехват real-time:** бот-админ (или privacy off) ловит каждое сообщение через webhook → пишет в свою БД немедленно; «раз в сутки» = cron по своей БД. Атрибуция `message.from.id`.
- **(B) Структурированный сбор личкой/reply:** бот инициирует standup, сотрудник отвечает в личке или reply — privacy mode такие сообщения пропускает всегда. Атрибуция тривиальна. Совпадает с принятым в Z вектором единого помощника.

Атрибуция: `Message.from.id` — стабильный надёжный ключ в группах (может быть пуст для channel posts). [core.telegram.org/bots/api]

## OSS daily-standup боты (GitHub)
| Проект | Стек | Хранилище | Сбор | Атрибуция | Лиц/★ |
|---|---|---|---|---|---|
| maddevsio/mad-telegram-standup-bot (Telegram, async, RU/EN — самый релевантный) | Go 98%, Docker | БД (тип не задекл.) | реактивный: тег бота + ключевые слова; трекинг отсутствующих (дедлайн) | `from.id` | MIT ~11★ активен |
| colestrode/slack-standup-bot | Node/JS | Redis | реактивный `@bot start/end` | Slack token | MIT ~28★ |
| niclabs/bot | Node+telegraf.js | — | `/standup` диалог 3 вопроса | — | Apache-2.0, архив 2024 |
| sapumar/dailybot | Python | — | только напоминание | — | — |
| hsdevelops/cron-telebot | Python | — | планировщик повторов | — | — |

**Наблюдение:** ни один не «скачивает историю» — все либо реактивно ловят (privacy off / админ), либо ведут диалог. maddevsio требует тег+ключевые слова (reply/mention обходят privacy mode). «Раз в сутки» = свой scheduler по своей БД, не забор из Telegram.

**Python → портировать в TS:** sapumar/dailybot, hsdevelops/cron-telebot, python-telegram-bot/aiogram (JobQueue/APScheduler). В Z: BullMQ repeatable / `@Cron` вместо APScheduler; telegraf/node-telegram-bot-api вместо aiogram. Go-бот maddevsio — референс-архитектура, не код. [тег: port-to-ts]

## LLM-классификация «план/отчёт/прочее»
- Few-shot + строгий enum меток + structured JSON output надёжнее словесного описания. [dev.to, agenta.ai]
- DeepSeek JSON mode: `response_format={type:'json_object'}` + слово «json» + пример схемы. [api-docs.deepseek.com/guides/json_mode]
- Модель: `deepseek-v4-flash` с выключенным thinking для классификатора (совпадает с правилом Z). [ofox.ai]
- Prompt caching: переменное в конце, стабильный SYSTEM+few-shot; батч сообщений гонять последовательно через один префикс — экономия ~80%. [ofox.ai DeepSeek caching]

**Маппинг на Z:** ложится на `llm-router.service.ts` (taskType→flash), JSON-режим поддержан, cache-friendly промпт — правило Z. Anthropic не используется.

## Сводка для архитектуры Z
1. Группа через Bot API ≠ «скачать чат раз в сутки». Только real-time ingest (бот-админ/privacy off, атрибуция from.id) или диалоговая модель (reply/личка обходят privacy mode).
2. «Раз в сутки» = BullMQ repeatable/`@Cron` по своей БД (агрегация, напоминания «кто не сдал»), не вызов Telegram.
3. Атрибуция — from.id на каждом апдейте → Person/User.
4. Классификатор — flash, JSON mode, few-shot enum, cache-friendly, последовательный батч.
5. Юр.бонус диалоговой модели B: нет ретроспективного сбора чужой переписки → меньше риска 152-ФЗ.

Sources: core.telegram.org/bots/features, /bots/api; grokipedia Telegram Bot API Limitations; github maddevsio/mad-telegram-standup-bot, colestrode/slack-standup-bot, niclabs/bot, sapumar/dailybot, hsdevelops/cron-telebot, python-telegram-bot; api-docs.deepseek.com/guides/json_mode; ofox.ai DeepSeek caching; dev.to reliable-llm-json; agenta.ai structured-outputs.
