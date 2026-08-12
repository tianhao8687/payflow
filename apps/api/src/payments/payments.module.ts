import { Module } from '@nestjs/common';

import { PaymentsController } from './payments.controller';
import { PaymentsRepository } from './payments.repository';
import { PaymentsService } from './payments.service';
import { StripeCheckoutGateway } from './stripe-checkout.gateway';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsRepository, PaymentsService, StripeCheckoutGateway],
  exports: [PaymentsService],
})
export class PaymentsModule {}
