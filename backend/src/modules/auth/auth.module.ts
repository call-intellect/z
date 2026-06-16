import { Global, Module } from '@nestjs/common';

import { AuthController } from './auth.controller';
import { AdminGuard } from './guards/admin.guard';
import { CookieAuthGuard } from './guards/cookie-auth.guard';
import { HmacGuard } from './guards/hmac.guard';
import { MustChangePasswordGuard } from './guards/must-change-password.guard';
import { OrgAdminGuard } from './guards/org-admin.guard';
import { SuperAdminGuard } from './guards/super-admin.guard';
import { AdminLoginService } from './services/admin-login.service';
import { HmacService } from './services/hmac.service';
import { JwtService } from './services/jwt.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    JwtService,
    HmacService,
    AdminLoginService,
    CookieAuthGuard,
    HmacGuard,
    AdminGuard,
    SuperAdminGuard,
    OrgAdminGuard,
    MustChangePasswordGuard,
  ],
  exports: [
    JwtService,
    HmacService,
    AdminLoginService,
    CookieAuthGuard,
    HmacGuard,
    AdminGuard,
    SuperAdminGuard,
    OrgAdminGuard,
    MustChangePasswordGuard,
  ],
})
export class AuthModule {}
