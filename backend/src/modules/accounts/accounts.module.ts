import { Module } from '@nestjs/common';

import { OrgsModule } from '../orgs/orgs.module';

import { AccountsController } from './accounts.controller';
import { AccountsRepository } from './accounts.repository';
import { AccountsService } from './accounts.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { UnifiedLoginController } from './unified-login.controller';

@Module({
  imports: [OrgsModule],
  controllers: [AccountsController, UnifiedLoginController],
  providers: [AccountsService, AccountsRepository, PasswordService, SessionService],
  exports: [AccountsService, SessionService],
})
export class AccountsModule {}
