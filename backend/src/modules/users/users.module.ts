import { Global, Module } from '@nestjs/common';

import { TourProgressController } from './controllers/tour-progress.controller';
import { TourProgressService } from './tour-progress.service';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

@Global()
@Module({
  controllers: [TourProgressController],
  providers: [UsersService, UsersRepository, TourProgressService],
  exports: [UsersService],
})
export class UsersModule {}
