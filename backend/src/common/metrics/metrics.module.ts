import { Global, Module } from '@nestjs/common';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';

import { BusinessMetricsService } from './business-metrics.service';

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
