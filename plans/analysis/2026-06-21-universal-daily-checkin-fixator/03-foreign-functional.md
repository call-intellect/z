---
type: analysis
status: research-input
feature: universal-daily-checkin-fixator
date: 2026-06-21
snapshot_date: 2026-06-21
segment: зарубежные daily-standup / async check-in боты — функциональный разрез
---
# Зарубежные standup/check-in боты — функционал

Async = «отвечают когда удобно». Standup = ежедневная летучка. DM = личное сообщение боту. Sentiment = автооценка тональности. Seat = оплачиваемое место.

**Общая механика почти всех:** бот пишет вопросы в **личку** каждому → человек отвечает боту в личке свободным текстом → бот сам публикует оформленный ответ в групповой канал **от имени человека**. Атрибуция = оформленный ботом пост, не «сырое» сообщение. Личка — приватный сбор, канал — витрина.

## Geekbot
1. Сбор в личке (Slack/Teams) → бот постит апдейт в канал от имени человека, обсуждение в треде (платно). [verified — geekbot.com/standups, help.geekbot.com/.../reporting-guidelines, 2026-06-21]
2. По расписанию (локальный TZ) + ручной `report`; напоминания опоздавшим (через N мин/адаптивно, ≤1/5ч). [verified — help.geekbot.com/.../participation-reminders]
3. Дашборд: % отчитавшихся, аватары сдал/не сдал, «Select people to remind», Timeline. Sentiment: +/0/− на ответ, график Team Happiness. [verified]
4. Вопросы шаблонные, ответы — свободный текст (списки, @упоминания, правки). [verified]
5. Free ≤10; Basic **$2.50/участник/мес** (−17% годовая) + $0.75/респ/мес опросы. [verified — geekbot.com/pricing]

## Standuply
1. «Цифровой скрам-мастер»: опрос по расписанию → отчёт в канал/DM/e-mail/Webhook/Excel (витрина настраивается). [verified доставка; inferred точная атрибуция в треде]
2. По расписанию (общий/локальный TZ); напоминания+дедлайны, follow-up. [verified/claimed]
3. Хранение отчётов, Agile-чарты, метрики команды; явного «сдал/не сдал» не подтверждено; отдельного sentiment не заявлено. [claimed]
4. Текст/голос/видео (до 5 мин, приватно на YouTube → ссылка в Slack). [verified]
5. Free ≤3; Standup Bot от **$5–7/мес за 3 респ.**; Scrum/Program выше. [verified — standuply.com/pricing]

## DailyBot
1. Slack/Teams/Google Chat/Discord. Личка `checkin` → ответы постятся в канал; follow-up в личку; в канале видно кто сдал/блокеры. [verified — help.dailybot.com]
2. По расписанию (день/неделя/месяц, TZ); `checkin status`; follow-up встроен. [verified — dailybot.com/lessons/check-ins]
3. Дашборд сводок/инсайтов; ИИ суммирует, детектит блокеры, анализ настроения. [claimed]
4. Вопросы настраиваемые, ответы свободные; ИИ парсит в сводки/блокеры. [claimed]
5. Free (без AI); Essentials **$2.40**; Advanced **$5/польз./мес** (AI-отчёты, mood). [verified — dailybot.com/pricing]

## Контекст
- **Status Hero → Steady** (ребрендинг, не закрыт). Async-чек-ин + mood-score + blocker-alerts (эмодзи-настроение). [verified — runsteady.com/blog/status-hero-to-steady, help.statushero.com/.../mood-score]
- **Range.** Async/realtime, mood-sharing, 350+ ледоколов, уведомление в Slack о настроении/просьбе помощи, цели через хэштеги. Цена 2026 не снята [inferred]. [verified/claimed — range.co]
- **Jell.** Jellbot → статус публикуется в выбранный канал Slack по командам. Essentials $5, Advanced $10/польз. [verified — jell.com/pricing]

## Итоговая таблица
| Продукт | Атрибуция в группе | Расписание + напоминания | Дашборд сдал/не сдал | Sentiment | Цена 2026-06-21 |
|---|---|---|---|---|---|
| Geekbot | личка→пост в канал от имени; тред [v] | расписание+ручной; напоминания [v] | % + аватары + «напомнить» + Timeline [v] | +/0/−, Team Happiness [v] | Free≤10; $2.50/участ [v] |
| Standuply | сбор→канал/DM/email/Webhook/Excel [v]; тред [i] | расписание; напоминания+дедлайны [v/c] | хранение+Agile-чарты; «сдал/не сдал» не подтв [c] | не заявлен [i] | Free≤3; $5–7/3 респ [v] |
| DailyBot | личка `checkin`→канал; follow-up в личку [v] | расписание; `checkin status` [v] | дашборд+канальный отчёт [c] | ИИ mood (Advanced) [c] | Free; $2.40; $5 [v] |
| Steady | async, апдейты показываются команде [v] | расписание; blocker-alerts [v] | отчётность [c] | эмодзи+mood-score [v] | не снято |
| Range | async/realtime, mood-sharing [v] | расписание [c] | команд. чек-ины/цели [c] | mood-sharing [v] | не снято |
| Jell | публикация в канал по командам [v] | автонапоминания [v] | не подтв | не подтв | $5/$10 [v] |

**Главный вывод:** реальный диалог идёт в личке бота, в канал попадает оформленный ботом пост от имени человека (не сырая реплика), обсуждение в треде. Inline-кнопок для атрибуции никто не использует. Ответы — свободный текст, ИИ парсит в сводку/блокеры/настроение.
