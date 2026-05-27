import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { TypedConfigService } from '../../common/config/index';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';

import { AccountsService } from './accounts.service';
import { ChangePasswordSchema, type ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordSchema, type ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginSchema, type LoginDto } from './dto/login.dto';
import {
  AcceptInvitationMagicLinkSchema,
  MagicLinkConsumeSchema,
  MagicLinkRequestSchema,
  type AcceptInvitationMagicLinkDto,
  type MagicLinkConsumeDto,
  type MagicLinkRequestDto,
} from './dto/magic-link.dto';
import { RegisterSchema, type RegisterDto } from './dto/register.dto';
import { ResetPasswordSchema, type ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateProfileSchema, type UpdateProfileDto } from './dto/update-profile.dto';

const SESSION_COOKIE = 'z_session';

/**
 * Контроллер standalone-аккаунтов: lead-style регистрация, login/logout,
 * forgot/reset password, профиль.
 *
 * Throttling — на самых уязвимых эндпоинтах:
 *   - /register, /login, /password/forgot — 5/15 минут на IP (защита от
 *     брутфорса и спама письмами).
 *   - /password/reset — 3/15 минут (защита от перебора reset-токена).
 */
@ApiExcludeController()
@Controller('api/v1/accounts')
export class AccountsController {
  constructor(
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  // ─────────────────────────── public ────────────────────────────

  @Post('register')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  async register(
    @Body(new ZodValidationPipe(RegisterSchema)) body: RegisterDto,
  ): Promise<{ status: 'ok'; email_sent: boolean; email_error?: string }> {
    const result = await this.accounts.register({
      email: body.email,
      name: body.name,
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
      ...(body.companyName !== undefined ? { companyName: body.companyName } : {}),
      ...(body.honeypot !== undefined ? { honeypot: body.honeypot } : {}),
      ...(body.ref !== undefined ? { ref: body.ref } : {}),
      consentDataProcessing: body.consentDataProcessing,
      ...(body.consentMarketing !== undefined ? { consentMarketing: body.consentMarketing } : {}),
    });
    return {
      status: result.status,
      email_sent: result.emailSent,
      ...(result.emailError ? { email_error: result.emailError } : {}),
    };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: ReturnType<AccountsService['getMe']> extends Promise<infer R> ? R : never; mustChangePassword: boolean }> {
    const result = await this.accounts.login(body, {
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      ip: req.ip ?? null,
    });

    res.cookie(SESSION_COOKIE, result.token, {
      domain: this.cfg.auth.cookieStandaloneDomain ?? this.cfg.auth.cookieDomain,
      httpOnly: true,
      secure: !this.cfg.runtime.isDevelopment,
      sameSite: 'lax',
      maxAge: this.cfg.auth.sessionTtlSeconds * 1000,
    });

    return {
      user: result.user,
      mustChangePassword: result.mustChangePassword,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CookieAuthGuard)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    // jti читаем из req.user (установлено CookieAuthGuard) или payload —
    // в зависимости от того, что текущий guard кладёт. Сейчас guard кладёт
    // только { id, email, role }, поэтому подберём jti из самого JWT через
    // повторный парс безопаснее. Но проще: текущая сессия — её мы и хотим
    // отозвать, jti берём из req.user.jti (расширим контракт).
    const jti = (req.user as { jti?: string } | null | undefined)?.jti;
    if (jti) {
      await this.accounts.logout(jti);
    }

    res.clearCookie(SESSION_COOKIE, {
      domain: this.cfg.auth.cookieStandaloneDomain ?? this.cfg.auth.cookieDomain,
      httpOnly: true,
      secure: !this.cfg.runtime.isDevelopment,
      sameSite: 'lax',
    });
    return { ok: true };
  }

  @Post('password/forgot')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  async forgotPassword(
    @Body(new ZodValidationPipe(ForgotPasswordSchema)) body: ForgotPasswordDto,
  ): Promise<{ ok: true }> {
    await this.accounts.forgotPassword(body.email);
    return { ok: true };
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 900_000 } })
  async resetPassword(
    @Body(new ZodValidationPipe(ResetPasswordSchema)) body: ResetPasswordDto,
  ): Promise<{ ok: true }> {
    await this.accounts.resetPassword({
      token: body.token,
      newPassword: body.newPassword,
    });
    return { ok: true };
  }

  /**
   * β-9 (2026-05-25) — запросить одноразовую ссылку для входа без пароля.
   * Публичный эндпоинт с throttling (5 запросов / 15 минут на IP, плюс
   * дополнительный per-email rate-limit внутри сервиса).
   * Возвращает всегда `{ ok: true }` — защита от user enumeration.
   */
  @Post('magic-link/request')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  async requestMagicLink(
    @Body(new ZodValidationPipe(MagicLinkRequestSchema))
    body: MagicLinkRequestDto,
  ): Promise<{ ok: true; email_sent: boolean }> {
    const result = await this.accounts.requestMagicLink({ email: body.email });
    return { ok: true, email_sent: result.emailSent };
  }

  /**
   * β-9 (2026-05-25) — прожечь magic-link, открыть сессию.
   * Публичный эндпоинт (одноразовый токен).
   */
  @Post('magic-link/consume')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  async consumeMagicLink(
    @Body(new ZodValidationPipe(MagicLinkConsumeSchema))
    body: MagicLinkConsumeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: Awaited<ReturnType<AccountsService['consumeMagicLink']>>['user'] }> {
    const result = await this.accounts.consumeMagicLink(
      { token: body.token },
      {
        userAgent:
          typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
        ip: req.ip ?? null,
      },
    );

    res.cookie(SESSION_COOKIE, result.token, {
      domain: this.cfg.auth.cookieStandaloneDomain ?? this.cfg.auth.cookieDomain,
      httpOnly: true,
      secure: !this.cfg.runtime.isDevelopment,
      sameSite: 'lax',
      maxAge: this.cfg.auth.sessionTtlSeconds * 1000,
    });

    return { user: result.user };
  }

  /**
   * β-9 (2026-05-25) — принять приглашение по magic-token из письма.
   * Публичный эндпоинт. Без auth, одноразовый токен. Под капотом
   * создаёт User + Membership, открывает сессию (cookie).
   */
  @Post('invitations/accept-magic')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  async acceptInvitationMagicLink(
    @Body(new ZodValidationPipe(AcceptInvitationMagicLinkSchema))
    body: AcceptInvitationMagicLinkDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{
    user: Awaited<ReturnType<AccountsService['acceptInvitationMagicLink']>>['user'];
  }> {
    const result = await this.accounts.acceptInvitationMagicLink(
      { magicToken: body.magicToken },
      {
        userAgent:
          typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
        ip: req.ip ?? null,
      },
    );

    res.cookie(SESSION_COOKIE, result.token, {
      domain: this.cfg.auth.cookieStandaloneDomain ?? this.cfg.auth.cookieDomain,
      httpOnly: true,
      secure: !this.cfg.runtime.isDevelopment,
      sameSite: 'lax',
      maxAge: this.cfg.auth.sessionTtlSeconds * 1000,
    });

    return { user: result.user };
  }

  // ─────────────────────────── private (cookie) ──────────────────

  @Get('me')
  @UseGuards(CookieAuthGuard)
  async me(@CurrentUser() user: CurrentUserPayload): Promise<{
    user: Awaited<ReturnType<AccountsService['getMe']>>;
  }> {
    const fresh = await this.accounts.getMe(user.id);
    return { user: fresh };
  }

  @Patch('me')
  @UseGuards(CookieAuthGuard)
  async updateMe(
    @Body(new ZodValidationPipe(UpdateProfileSchema)) body: UpdateProfileDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{
    user: Awaited<ReturnType<AccountsService['updateProfile']>>;
  }> {
    const updated = await this.accounts.updateProfile(user.id, body.name);
    return { user: updated };
  }

  @Post('me/change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CookieAuthGuard)
  async changePassword(
    @Body(new ZodValidationPipe(ChangePasswordSchema)) body: ChangePasswordDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    const jti = (req.user as { jti?: string } | null | undefined)?.jti ?? null;
    await this.accounts.changePassword({
      userId: user.id,
      currentJti: jti,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    });
    return { ok: true };
  }
}
