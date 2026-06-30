---
type: analysis
status: research-complete
feature: month-company-and-report-archive
date: 2026-06-29
snapshot_date: 2026-06-29
owner: Сергей (svmazur)
---

# Индекс — «Месяц компании» + архив/навигация прошлых отчётов

Доказательная аналитика под две связанные фичи дашборда операционного директора Z/Кора. Метод: fan-out 6 суб-агентов (3 картографии кода + 2 внешних UX-контура + red-team) через Workflow, синтез автором.

| Файл | Контур | Статус |
|---|---|---|
| [99-synthesis.md](99-synthesis.md) | **Главный синтез** (рамка → решения → архитектура → матрицы → дельта B → ограничения) | research-complete |
| [01-backend-digest-stack.md](01-backend-digest-stack.md) | Картография backend: модели/сервисы/кроны/промпты день/неделя/месяц | research-input · verified |
| [02-frontend-hero-canvas.md](02-frontend-hero-canvas.md) | Картография frontend: герой/canvas/виджеты/навигатор | research-input · verified |
| [03-monthly-executive-composition.md](03-monthly-executive-composition.md) | Внешняя практика: что входит в месячную executive-сводку (MBR/OHI/board) | research-input · triangulated |
| [04-redteam-challenges.md](04-redteam-challenges.md) | Состязательный второй проход: 4 вердикта по ключевым решениям | research-input |

**Сбойные контуры (честно):** navigation-archive-baseline (упал на валидации схемы после 28 чтений — baseline восстановлен в синтезе из 02 + 04 + прямого чтения контроллеров); ux-period-navigation (вернул заглушку «test» — UX-вывод опирается на red-team + код value-recap, см. «Ограничения» в синтезе).

**Решения владельца (2026-06-29):** новая модель `MonthlyOperationsDigest`; герой над canvas на `/month` (таб ведёт ссылкой); смена горизонта (+месячные срезы); навигация — inline + лёгкий архив.

**Следующий шаг → ТЗ:** `plans/tz/2026-06-29-month-company-monthly-brief.md` (A) + `plans/tz/2026-06-30-report-date-navigation-archive.md` (B).
