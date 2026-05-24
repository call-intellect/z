---
type: рефлексия
date: 2026-05-25
session: handoff-full-close v1 (single orchestrator session)
distilled: false
related:
  - plans/sprints/2026-05-25-handoff-full-close.md (исходник handoff)
  - second-brain/02_architecture/data-model.md (новые модели)
  - second-brain/02_architecture/module-map.md (новые модули)
  - second-brain/01_projects/api-layer.md (новые endpoints — created)
  - second-brain/01_projects/frontend-pages.md (новые страницы — created)
  - second-brain/01_projects/ai-jobs.md (T7-F3 + T3 — created)
  - second-brain/01_projects/workers-queues.md (T5 cron — created)
  - second-brain/01_projects/concierge-voice.md (T4 WS — created)
---

# Рефлексия — финальный handoff-full-close: закрыто 7 из 9 тикетов

## Что было поставлено
Hand-off `plans/sprints/2026-05-25-handoff-full-close.md` — 9 тикетов (T1-T9) на ~2-3 недели работы при параллелизации. Просьба: оркестратор, прийти с финалом.

## Что вышло — 7 из 9 закрыто, 11 коммитов в `origin/dev`

| # | Коммит | Тикет |
|---|---|---|
| 1 | `50e4f64` | T1 Gamification — 2 backend endpoint + frontend (2 страницы, 3 виджета) |
| 2 | `caaf678` | T2 Helpfulness frontend (3 страницы, 3 виджета, admin RBAC) |
| 3 | `dcd867d` | T3 kie-grsai — seed + 18/18 тестов + smoke + A/B |
| 4 | `84816fe` | T6 polish — inbox count + scope='issue' + Board.spec.tsx (4 теста) |
| 5 | `2c7c9e6` | Wave 1 integration — Sidebar +2 пункта + feed/spotlights виджеты |
| 6 | `d221f3b` | T5 email-to-task IMAP — общий ящик + per-project alias + UI |
| 7 | `2637c91` | T4 δ-3 voice WebSocket + useVoiceStream + 11 тестов |
| 8 | `2a76784` | T7-F3 prompt caching distribution + cache_tokens accounting |
| 9 | `723582e` | T7 P1 finalize — F1/F2/F4/F5 (carry-over от предыдущей сессии, verified) |
| 10 | `14b8a71` | T8 multi-user коллаборация в IssueComments — presence + @mentions |
| 11 | `937ed4f` | T9 SPO discovery документ (без реализации) |

### Оставлено на следующую сессию (честный scope)
- **T7 P2 (F6-F11)** — tool_use, edge-case policy, _V2 конвенция, чистка γ-1/α-5: ~6-7 дней
- **T7 P3 (F12-F16)** — рефакторинги: ~3-4 дня
- **Tracker Mobile native** — внешний блокер (Apple/Google/RuStore dev accounts)

## Как решал — оркестрация в 3 волны

### Wave 1 (4 параллельных агента)
Pre-разведка через 4 Explore-агента → 4 fullstack/backend агента работают параллельно на разных модулях (T1 recognition + T2 helpfulness + T3 ai/services + T6 chat-v2/tracker). Конфликтов в файлах не было. Интеграция Sidebar и feed/spotlights — оркестратор сам после, чтобы 2 агента не правили один файл.

### Wave 2 (2 параллельных агента)
T4 voice WS (backend gateway + frontend hook) + T5 email-IMAP (новая schema + cron + REST + UI). Оба в отдельных модулях, без конфликтов. После — оркестратор: `prisma:push`, `MailInboundModule` в `app.module.ts`.

### Wave 3 (3 параллельных агента)
T7-F3 caching (исправил учёт cache_tokens — биллинг был занижен ~80%) + T7-F1 finalize (всё уже было от предыдущей сессии) + T8 multi-user (gateway events + notifications + frontend WS subscriptions). T9 SPO — отдельный документатор-агент.

## Что вышло особенно хорошо

1. **Pre-разведка через Explore-агентов экономит часы.** Главный урок прошлых сессий подтвердился: 30-секундный `Explore` перед запуском implementation-агента позволяет:
   - Уточнить «90% backend готово, нужен только frontend» (T2 Helpfulness)
   - Узнать что инфраструктура есть (T5: imapflow + mailparser уже в deps, EmailFetchService — референс)
   - Найти что предыдущая сессия УЖЕ начала тикет (T7-F1 sanitize-custom-prompt в untracked)
2. **Параллелизация по модулям**. 4+2+3 параллельных агента — это ~9 человеко-дней работы за час времени.
3. **Точечные `git add` (без `-A`)** — ни разу не зацепил «чужие» untracked файлы от соседних сессий (operations/commitments, sexy-пилот UI, etc.).
4. **Schema-правка отдельным шагом**. T6 enum 'issue' + T5 MailInboundLog применял через `prisma:push && prisma:generate` ДО запуска агентов — давало им свежий типизированный Prisma Client.
5. **Carry-over от предыдущей сессии**. Узнал из git status, что previous orchestrator оставил T7-F1/F2/F4/F5 unстейджнутым (sanitize + 27 модифицированных prompts/*.ts). Закоммитил их с пометкой carry-over.

## Что было неожиданным / уроки

1. **T6c useMyInboxCount агент не довёл до конца** — backend endpoint создал, hook оставил с workaround. Заметил при проверке git diff перед коммитом. Дописал сам. **Урок:** проверять hook'и/потребители backend endpoint после агента.
2. **T6b нужно было править больше мест чем в ТЗ** — кроме enum в DTO ещё `schema.prisma` + `synthesis.mapScope` + frontend `api/chat-v2.api.ts` + `domain/chat-v2.ts`. Агент сам нашёл и поправил.
3. **T7-F3 главное открытие не там где ожидалось** — caching в `LlmRouter.dispatch()` уже был автоматический, реальные дыры: `LlmFallbackService` не пробрасывал, `cache_creation/read_tokens` игнорировались (биллинг занижен ~80%), `LlmCompleteInput.user: string` не давал кешировать user-блоки. Агент перестроил архитектуру вместо «добавить ephemeral в 15 мест».
4. **T8 чат в IssueComments, не в IssueChat** — IssueChat это AI synthetic-чат с задачей, multi-user комментарии — IssueComments. Агент discovered и сделал в правильном месте.
5. **Vox poll-модель ограничивает δ-3 latency ≥ 2 сек** — даже с WebSocket. TODO миграция на streaming ASR (OpenAI Whisper realtime) для p50 200-500ms.
6. **Цены `gemini-3-flash` / `gpt-5-4` не указаны в ТЗ T3** — placeholder 0/0 + TODO. Владельцу узнать на pricing pages KIE/GRSAI.
7. **Pre-existing typecheck errors в `operations/commitments.*`** — не от моих изменений (beta-8.2 promise-keeper от соседней сессии). Не блокируют merge моих коммитов.

## Чему научился

- **Делегирование разведки через Explore-агента** — лучший паттерн для оркестратора. Сам подходи к коду только когда нужно сшить (Sidebar, feed/spotlights, app.module).
- **Длинные коммит-message с разделами TL;DR / changes / risk** — полезно для будущих оркестраторов читать git log.
- **Подсветка carry-over от предыдущей сессии** в commit message — честно про авторство, не присваиваю чужое.
- **Раздельные коммиты по тикетам** даже когда файлы пересекаются (business-metrics в T5 + T7) — описывай в commit-message в каком из двух найти конкретную метрику.

## Метрика темпа

| Wave | Тикетов | Агентов | Коммитов | Длительность |
|---|---|---|---|---|
| 1 | 4 | 4+4 (разведка+impl) | 5 | ~45 мин агентов параллельно + 10 мин интеграция |
| 2 | 2 | 2+2 | 2 | ~30 мин + 10 мин |
| 3 | 3 | 3+3 | 4 | ~40 мин + 10 мин |
| **Итого** | **7** | **18** | **11** | **~2.5 часа** |

При последовательной работе одного программиста — ~14 дней.

## Что осталось владельцу

1. **Цены KIE/GRSAI** для `gemini-3-flash` и `gpt-5-4` — узнать на pricing pages и подставить в `model-prices.ts`. До этого `AiUsageLog.costUsd` нулевой для этих SKU.
2. **T9 SPO discovery** — прочитать `plans/analysis/2026-05-24-spo-discovery.md` и ответить на 5 ключевых вопросов (bootstrap-тип, бюджет, promotion-политика, channel mention, attachment policy).
3. **DNS MX-запись `inbox.kora.app`** → IMAP-сервер для T5 email-to-task. См. prod-инструкцию.
4. **ENV vars** для T5 (`MAIL_INBOX_*`), T3 (`KIE_API_KEY`, `GRSAI_API_KEY`).
5. **T7 P2/P3 + Mobile native** — следующая сессия оркестратора.

## Файлы second-brain — что обновил

| Файл | Действие |
|---|---|
| `02_architecture/data-model.md` | +раздел финальный handoff: MailInboundLog, Project.emailInboxAlias, ChatV2Scope+'issue' |
| `02_architecture/module-map.md` | +раздел Wave 1-3: T1-T9 модули, ENV, события WS, метрики |
| `01_projects/chat-v2.md` | +секция ChatV2Scope+'issue' |
| `01_projects/tracker.md` | +раздел Email-to-task (T5) + Multi-user чат (T8) |
| `01_projects/api-layer.md` | **created** — реестр REST endpoints |
| `01_projects/frontend-pages.md` | **created** — реестр Next.js страниц |
| `01_projects/ai-jobs.md` | **created** — провайдеры + taskType + caching |
| `01_projects/workers-queues.md` | **created** — BullMQ + @Cron |
| `01_projects/concierge-voice.md` | **created** — WebSocket voice streaming |
| `index.md` | +запись 2026-05-25, ссылки на новые реестры |

## Anti-патерны, замеченные у соседних сессий

1. **`git stash --include-untracked` без явных путей** — агент T2 случайно унёс большой массив незакоммиченных файлов. Восстановил через `git stash pop`. **Урок:** для diff-сравнений с базовой веткой не использовать `--include-untracked` агентам.
2. **Untracked файлы от прошлой сессии в operations/commitments** дают 5+ pre-existing typecheck errors. Не блокирует мерж моих, но фоном «шумит». **Урок:** оркестратор должен явно отделять «свои» файлы от «чужих» через git status фильтрацию.

## Не забыть в следующую сессию

- **T7 P2 (F6-F11)**: разбить на параллельных агентов по группам промтов (chapters + tasks-structured + regenerate-section + 5 dialog-layer). Уже разведано — каждая фича известна.
- **T7 P3 (F12-F16)**: рефакторинги — последовательно.
- **Mobile native** — только когда у владельца появятся Apple/Google/RuStore dev accounts + RN/Expo среда.
- **SPO** — после ответа владельца на 5 вопросов из discovery.
