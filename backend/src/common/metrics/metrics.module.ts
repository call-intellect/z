import { Global, Module } from '@nestjs/common';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';

import { BusinessMetricsService } from './business-metrics.service';

/**
 * Глобальный модуль метрик.
 *
 * - `PrometheusModule.register({ defaultMetrics, path: '/metrics' })`
 *   поднимает `/metrics` с дефолтными процесс-метриками.
 * - `BusinessMetricsService` регистрирует кастомные бизнес-метрики
 *   и доступен через DI везде.
 */
@Global()
@Module({
  imports: [
    PrometheusModule.register({
      defaultMetrics: { enabled: true },
      path: '/metrics',
    }),
  ],
  providers: [BusinessMetricsService],
  exports: [BusinessMetricsService],
})
export class MetricsModule {}
