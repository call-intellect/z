---
type: project
status: active
updated: 2026-07-05
---

# Meeting Result Page — карточка результата встречи

Страница, на которую попадает хост после того, как AI-пайплайн отработал. URL: `korateam.ru/meetings/<id>/result`.

## Раскладка — табовый интерфейс

Реальный компонент — [MeetingResultPageReal.tsx](frontend/src/ui/components/meeting-result-v2/MeetingResultPageReal.tsx). Сверху шапка (название, тип • дата • длительность, участники, действия) и плеер общей записи; ниже — переключаемые табы (`TAB_KEYS`):

| Таб | Что показывает |
|---|---|
| **overview** | Краткое саммари + основной AI-отчёт по типу встречи (`AiResult.summaryFast`) |
| **reports** | Доп-отчёты по шаблонам — `ReportsTab`, модуль **meeting-reports** (create/regenerate кастомных отчётов); гейт `feature.multi_reports_per_meeting` + квота `multi_reports_limit_per_meeting` |
| **chapters** | Главы встречи (`MeetingChapter`) с тайм-кодами |
| **transcript** | Транскрипт с тайм-кодами (клик → перемотка плеера) |
| **chat** | Чат участников комнаты (in-meeting) — см. [[meeting-room-chat]] |
| **tasks** | Задачи встречи (источник — tracker `Issue.linkedMeetingIds`) |

Наполнение табов overview/reports идёт из пайплайна отчётов — см. [[meeting-report-pipeline]] (fast-отчёт + доп-отчёты meeting-reports).

## Кто видит

- **Хост** — всегда.
- **Гости** — через публичную share-ссылку. Хост создаёт `MeetingShare` (опц. `allowChat`), гость без аккаунта открывает `/share/[token]` (бэк `GET /api/v1/public/share/:token`).
- **Задачи встречи** (виджет «Задачи», источник — tracker `Issue.linkedMeetingIds`) — видны любому, кто видит встречу (**вариант A**). `GET /api/v1/issues?linkedMeetingId` гейтится `MeetingVisibilityService.assertCanView` и минует strict self-scope трекера, иначе manager+strict видел бы только свои. ТЗ: [meeting-tasks-widget-404-fix](../../plans/tz/2026-06-25-meeting-tasks-widget-404-fix.md).

## Состояния

- **AI ещё не отработал** (`recording_processing` / `transcription_processing` / `ai_processing`) → страница показывает прогресс: «Распознано 7 из 10 дорожек → Склейка → Готовим отчёт». Опрос статуса каждые 5 секунд.
- **AI готов** (`ai_ready`) → полная карточка как выше.
- **AI упал** (`failed`) → состояние «Не удалось обработать встречу. [Повторить попытку]» — действие повторно дёргает пайплайн.

## Что НЕ делаем в MVP

- Комментарии под видео.
- Реакции на саммари.
- «Поделиться в соцсетях».
- Редактирование отчёта руками.

[[../index|← index]]
