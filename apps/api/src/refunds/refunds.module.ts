import { Module } from '@nestjs/common';

import { AdminRefundsController } from './admin-refunds.controller';
import { RefundsRepository } from './refunds.repository';
import { RefundsService } from './refunds.service';

@Module({
  controllers: [AdminRefundsController],
  providers: [RefundsRepository, RefundsService],
  exports: [RefundsRepository],
})
export class RefundsModule {}
