---
type: analysis
status: research-input
feature: month-company-and-report-archive
date: 2026-06-29
snapshot_date: 2026-06-29
source: web fan-out (external agent monthly-executive-composition)
---

# 03 — Что входит в месячную executive-сводку сверх недельной

Вывод: **месяц не повторяет неделю — он меняет горизонт** (снимок состояния → накопленная траектория + нарратив + решения). Заявленный Z состав месячных виджетов практикой **подтверждён**.

## Паттерны (с продуктовым следствием для Z)

| Паттерн | Следствие для Z | Тег |
|---|---|---|
| Смена горизонта (WBR операционный, MBR — факт-vs-план за 30 дней с трендами) | Месячный герой показывает **изменение** 4 осей за 4 недели (тренд/дельта), не текущее значение; «динамика по неделям» — первый экран | triangulated |
| Нарратив-«почему» как форсинг-функция MBR | Письмо месяца разбирает каждую ось «почему» (сильная сторона Z — граф знаний за месяц; дифференциатор от BI) | verified |
| Динамика к цели = линейность/% плана + ведущие индикаторы | Компас усилить: темп, прогноз «при текущем — к дате X», ведущий сигнал следующего месяца | triangulated |
| Статус инициатив R/Y/G за недели | Виджет «вехи/крупные ставки» (статус + след. веха), отдельно от таблицы людей | verified |
| Bus-factor — периодическая орг-метрика «критичность × хрупкость» | Незаменимость: «зона × единственный носитель × критичность» + дельта к прошлому месяцу; только месяц | triangulated |
| Снятая рутина как месячный накопительный итог | Виджет «что AI снял за месяц» — на позиционирование «AI операционный директор» | inferred |
| Health/зрелость как сводный индекс (McKinsey OHI) | Зрелость: суб-оси + сводный балл + дельта, связать с 4 осями (агрегат, не параллельная шкала) | triangulated |
| Board/CEO-репортинг = одно решение периода + риски среды | Блок «что решить собственнику в этом месяце» (1–3) + реестр рисков | verified |
| MBR закрывается приоритетами/прогнозом | Секция «фокус следующего месяца» (3 приоритета) | triangulated |

## Антипаттерны (НЕ класть в месяц)

- Перегруз >12 KPI (−40% вовлечённости) — держать 5–8 срезов на первом экране.
- Повтор недельной операционки (блокеры/статус отдельных задач) — территория недели.
- Vanity-тоталы без «и что?» (всегда растущие счётчики).
- Дублирующая параллельная шкала здоровья мимо 4 осей.
- Пересчёт медленных метрик (зрелость/bus-factor) с недельной дельтой = шум.
- Незаменимость поимённым ярлыком без действия (нужна пара «риск + дублёр»).

## Источники

- [Working Backwards — QBR/MBR](https://workingbackwards.com/concepts/quarterly-monthly-business-reviews/) — канон Amazon, разграничение WBR/MBR (нарратив, R/Y/G, среда, course-correction).
- [WBR/MBR/QBR деконструкция](https://engineeringmanager.info/docs/Effective%20Meetings/Weekly-Monthly-and-Quarterly-Business-Reviews-WBR-MBR-QBR)
- [McKinsey OHI](https://www.mckinsey.com/solutions/orgsolutions/overview/organizational-health-index) — сводный health-индекс (3 исхода, 9 элементов).
- [Bus-factor/key-person risk](https://www.ardentworkshop.com/blog/bus-factor-team-risk/) — периодическая метрика, «критичность × хрупкость».
- [CEO/board report](https://www.boardpro.com/blog/writing-a-ceo-report-that-delights-your-board) — exec-summary = событие + вызов + решение.
- [Dashboard overload](https://www.storypointlab.com/blog/metrics-anti-patterns/dashboard-overload-explained) — >12 KPI = −40% вовлечённости.
- [Leading vs lagging](https://amplitude.com/blog/leading-lagging-indicators)
- RU: [profiz — отчёт руководителю](https://www.profiz.ru/peo/10_2023/otchet_dlya_rukovoditelya/), [if24 — 7 метрик собственника](https://www.if24.ru/7-metrik-kotorye-derzhat-biznes-v-rukah-sobstvennika/) — приоритет дистилляции над полнотой, 5–8 метрик, трендовый акцент.
- [Operational maturity scorecard](https://www.cortex.io/post/how-to-measure-operational-maturity) — месячная/квартальная частота зрелости.
