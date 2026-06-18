import { Body, Controller, INestApplication, Param, Post, UsePipes } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ZodValidationPipe } from './zod-validation.pipe';

const Schema = z.object({
  billingPeriod: z.enum(['monthly', 'yearly']),
  reason: z.string().trim().min(3),
});

@Controller('test')
class FixtureController {
  @Post('usepipes/:tenantId')
  @UsePipes(new ZodValidationPipe(Schema))
  usePipes(@Param('tenantId') tenantId: string, @Body() body: z.infer<typeof Schema>) {
    return { ok: true, tenantId, body };
  }

  @Post('bodypipe/:tenantId')
  bodyPipe(
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(Schema)) body: z.infer<typeof Schema>,
  ) {
    return { ok: true, tenantId, body };
  }
}

describe('ZodValidationPipe — уровень параметра vs @UsePipes (регрессия activate 400)', () => {
  let app: INestApplication;

  async function boot() {
    const mod = await Test.createTestingModule({ controllers: [FixtureController] }).compile();
    app = mod.createNestApplication();
    await app.init();
  }

  afterEach(async () => {
    await app?.close();
  });

  const validBody = { billingPeriod: 'monthly', reason: '111' };

  it('@UsePipes на методе с @Param → 400 даже при валидном теле (источник бага)', async () => {
    await boot();
    const res = await request(app.getHttpServer()).post('/test/usepipes/org123').send(validBody);
    expect(res.status).toBe(400);
  });

  it('@Body(pipe) с валидным телом → 201 и тело проходит', async () => {
    await boot();
    const res = await request(app.getHttpServer()).post('/test/bodypipe/org123').send(validBody);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true, tenantId: 'org123', body: validBody });
  });

  it('@Body(pipe) с невалидным телом → 400 (валидация тела работает)', async () => {
    await boot();
    const res = await request(app.getHttpServer())
      .post('/test/bodypipe/org123')
      .send({ billingPeriod: 'weekly', reason: 'x' });
    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe('validation_error');
  });
});
