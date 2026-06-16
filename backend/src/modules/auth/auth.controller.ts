import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { TypedConfigService } from '../../common/config/index';
import {
  DeepLinkExpiredError,
  DeepLinkMismatchError,
  NotAuthorizedError,
} from '../../common/errors/domain-errors';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UsersService } from '../users/users.service';

import { CurrentUser, type CurrentUserPayload } from './decorators/current-user.decorator';
import { OptionalAuth } from './decorators/optional-auth.decorator';
import { CookieAuthGuard } from './guards/cookie-auth.guard';
import { AdminLoginService } from './services/admin-login.service';
import { JwtService } from './services/jwt.service';

const SESSION_COOKIE = 'z_session';

const ExchangeQuerySchema = z.object({
  token: z.string().min(1, 'token обязателен'),
  meeting_id: z.string().min(1, 'meeting_id обязателен'),
});

const AdminLoginBodySchema = z.object({
  email: z.string().email('Невалидный email'),
  password: z.string().min(1, 'password обязателен'),
});
type AdminLoginBody = z.infer<typeof AdminLoginBodySchema>;

const SwitchOrgBodySchema = z.object({
  orgId: z.string().min(1, 'orgId обязателен'),
});
type SwitchOrgBody = z.infer<typeof SwitchOrgBodySchema>;

@ApiExcludeController()
@Controller('api/v1/auth')
export class AuthController {
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(AdminLoginService) private readonly adminLogin: AdminLoginService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get('exchange')
  async exchange(
    @Query(new ZodValidationPipe(ExchangeQuerySchema))
    query: { token: string; meeting_id: string },
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ ok: true; redirect: string }> {
    let payload;
    try {
      payload = this.jwt.verifyDeepLink(query.token);
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new DeepLinkExpiredError();
      }
      throw new NotAuthorizedError('deep_link_invalid');
    }

    if (payload.meetingId !== query.meeting_id) {
      throw new DeepLinkMismatchError();
    }

    const user = await this.users.findById(payload.sub);
    if (!user) throw new NotAuthorizedError('user_not_found');

    const sessionJwt = this.jwt.signSession({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    response.cookie(SESSION_COOKIE, sessionJwt, {
      domain: this.cfg.auth.cookieDomain,
      httpOnly: true,
      secure: !this.cfg.runtime.isDevelopment,
      sameSite: 'lax',
      maxAge: this.cfg.auth.sessionTtlSeconds * 1000,
    });

    return { ok: true, redirect: `/m/${payload.meetingId}` };
  }

  @Get('me')
  @UseGuards(CookieAuthGuard)
  @OptionalAuth()
  async me(@CurrentUser() user: CurrentUserPayload | null | undefined): Promise<{
    user: { id: string; email: string; name: string; role: 'user' | 'admin' } | null;
  }> {
    if (!user) return { user: null };
    const fresh = await this.users.findById(user.id);
    if (!fresh) return { user: null };
    return {
      user: {
        id: fresh.id,
        email: fresh.email,
        name: fresh.name,
        role: fresh.role,
      },
    };
  }

  @Post('admin-login')
  @HttpCode(HttpStatus.OK)
  async adminLoginAction(
    @Body(new ZodValidationPipe(AdminLoginBodySchema)) body: AdminLoginBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ ok: true }> {
    const { sessionToken } = await this.adminLogin.login(body.email, body.password);
    response.cookie(SESSION_COOKIE, sessionToken, {
      domain: this.cfg.auth.cookieDomain,
      httpOnly: true,
      secure: !this.cfg.runtime.isDevelopment,
      sameSite: 'lax',
      maxAge: this.cfg.auth.sessionTtlSeconds * 1000,
    });
    return { ok: true };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) response: Response): { ok: true } {
    response.clearCookie(SESSION_COOKIE, {
      domain: this.cfg.auth.cookieDomain,
      httpOnly: true,
      secure: !this.cfg.runtime.isDevelopment,
      sameSite: 'lax',
    });
    return { ok: true };
  }

  @Post('switch-org')
  @UseGuards(CookieAuthGuard)
  @HttpCode(HttpStatus.OK)
  async switchOrg(
    @Body(new ZodValidationPipe(SwitchOrgBodySchema)) body: SwitchOrgBody,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{
    success: true;
    user: {
      id: string;
      email: string;
      name: string;
      currentOrgId: string;
      currentOrgRole: 'owner' | 'admin' | 'manager' | 'coo' | 'hr_partner' | 'demo_observer';
    };
    todo: string;
  }> {
    const membership = await this.prisma.membership.findUnique({
      where: { orgId_userId: { orgId: body.orgId, userId: user.id } },
      include: {
        user: { select: { id: true, email: true, name: true } },
      },
    });
    if (!membership) {
      const u = await this.users.findById(user.id);
      if (!u) {
        throw new NotFoundException({
          ok: false,
          error: { code: 'user_not_found', message: 'Пользователь не найден' },
        });
      }
      const userRow = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { isSuperAdmin: true },
      });
      if (!userRow?.isSuperAdmin) {
        throw new ForbiddenException({
          ok: false,
          error: {
            code: 'no_membership',
            message: 'У вас нет доступа к этой организации',
          },
        });
      }
      return {
        success: true,
        user: {
          id: u.id,
          email: u.email,
          name: u.name,
          currentOrgId: body.orgId,
          currentOrgRole: 'admin',
        },
        todo: 'session update — Фаза 0a.3 шаг 2 (пока используется X-Org-Id на каждый запрос)',
      };
    }
    return {
      success: true,
      user: {
        id: membership.user.id,
        email: membership.user.email,
        name: membership.user.name,
        currentOrgId: membership.orgId,
        currentOrgRole: membership.role,
      },
      todo: 'session update — Фаза 0a.3 шаг 2 (пока используется X-Org-Id на каждый запрос)',
    };
  }
}
