import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';

import { TourIdSchema, type TourId, type TourProgressResponse } from './dto/tour-progress.dto';

interface TourEntry {
  completedAt?: string;
  skipped?: boolean;
}

@Injectable()
export class TourProgressService {
  private readonly logger = new Logger(TourProgressService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async get(userId: string): Promise<TourProgressResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tourProgress: true },
    });
    if (!user) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'user_not_found', message: 'Пользователь не найден' },
      });
    }
    return this.normalize(user.tourProgress);
  }

  async update(
    userId: string,
    tenantId: string | null,
    input: { tourId: TourId; completedAt?: string; skipped?: boolean },
  ): Promise<TourProgressResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tourProgress: true },
    });
    if (!user) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'user_not_found', message: 'Пользователь не найден' },
      });
    }

    const current = this.normalize(user.tourProgress);
    const prevEntry = current[input.tourId];
    const isFirstTouch = prevEntry === undefined;
    const isCompleting = input.completedAt !== undefined && prevEntry?.completedAt === undefined;
    const isSkipping = input.skipped === true && prevEntry?.skipped !== true;

    const nextEntry: TourEntry = {
      ...(prevEntry ?? {}),
      ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
      ...(input.skipped !== undefined ? { skipped: input.skipped } : {}),
    };

    const nextProgress: TourProgressResponse = {
      ...current,
      [input.tourId]: nextEntry,
    };

    await this.prisma.user.update({
      where: { id: userId },
      data: { tourProgress: nextProgress as unknown as Prisma.InputJsonValue },
    });

    const tenantLabel = tenantId ?? 'none';
    if (isFirstTouch && !isCompleting && !isSkipping) {
      this.metrics.incTourStarted({
        tenant: tenantLabel,
        tour_id: input.tourId,
      });
    }
    if (isCompleting) {
      this.metrics.incTourCompleted({
        tenant: tenantLabel,
        tour_id: input.tourId,
      });
    }
    if (isSkipping) {
      this.metrics.incTourSkipped({
        tenant: tenantLabel,
        tour_id: input.tourId,
        at_step: 'unknown',
      });
    }

    this.logger.log(
      `tourProgress update userId=${userId} tourId=${input.tourId} completed=${isCompleting} skipped=${isSkipping}`,
    );

    return nextProgress;
  }

  async reset(userId: string): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'user_not_found', message: 'Пользователь не найден' },
      });
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { tourProgress: {} as Prisma.InputJsonValue },
    });
    this.logger.log(`tourProgress reset userId=${userId}`);
    return { ok: true };
  }

  private normalize(raw: unknown): TourProgressResponse {
    if (raw === null || raw === undefined) return {};
    if (typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: TourProgressResponse = {};
    const obj = raw as Record<string, unknown>;
    for (const key of TourIdSchema.options) {
      const entry = obj[key];
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const e = entry as Record<string, unknown>;
        const norm: TourEntry = {};
        if (typeof e.completedAt === 'string') norm.completedAt = e.completedAt;
        if (typeof e.skipped === 'boolean') norm.skipped = e.skipped;
        out[key] = norm;
      }
    }
    return out;
  }
}
