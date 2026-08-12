import { Module } from '@nestjs/common';

import { AdminRefundsController } from './admin-refunds.controller';
import { RefundsRepository } from './refunds.repository';
import { RefundsService } from './refunds.service';
import { StripeRefundGateway } from './stripe-refund.gateway';

@Module({
  controllers: [AdminRefundsController],
  providers: [RefundsRepository, RefundsService, StripeRefundGateway],
  exports: [RefundsRepository],
})
export class RefundsModule {}
