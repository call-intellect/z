/**
 * Библиотека «современного» визуального языка дашбордов Коры (редизайн
 * 2026-06-08). Стеклянные карточки, градиенты, дата-виз на recharts.
 *
 * Источник стиля — витрина `app/(design-preview)/redesign/page.tsx`.
 * Потребители — все боевые дашборды (переписываются в следующих фазах).
 *
 * Тема пока только тёмная.
 */

export { CHART, GRAD, glass, MODERN_PAGE_BG, STATUS_TONE } from './tokens';

export { GlassCard } from './GlassCard';
export { CardTitle } from './CardTitle';
export { Legend } from './Legend';
export { ChartTip } from './ChartTip';
export { StatCard } from './StatCard';
export { GaugeCard } from './GaugeCard';
export { AreaTrend } from './AreaTrend';
export { BarTrend } from './BarTrend';
export { RadarCard } from './RadarCard';
export { DonutCard } from './DonutCard';
export { AiCard } from './AiCard';
export { Heatmap } from './Heatmap';
export {
  ModernTable,
  Avatar,
  ProgressBar,
  StatusPill,
  type ModernTableColumn,
} from './ModernTable';
