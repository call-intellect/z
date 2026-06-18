import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { GraphService } from './graph.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [GraphService],
  exports: [GraphService],
})
export class GraphModule {}
