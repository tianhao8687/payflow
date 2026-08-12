import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import type { AuthenticatedUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateCheckoutSessionRequestDto } from './dto/create-checkout-session-request.dto';
import {
  CheckoutSessionResponseDto,
  PaymentResponseDto,
} from './dto/payment-response.dto';
import { PaymentsService } from './payments.service';

@ApiBearerAuth()
@ApiTags('payments')
@Roles('USER', 'ADMIN')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('checkout-session')
  @ApiOperation({
    summary: 'Create or reuse a provider sandbox checkout for an owned order',
  })
  @ApiCreatedResponse({ type: CheckoutSessionResponseDto })
  @ApiNotFoundResponse({ description: 'Order not found for this user' })
  @ApiConflictResponse({ description: 'Order or payment state is not payable' })
  @ApiBadGatewayResponse({ description: 'Provider request failed safely' })
  @ApiServiceUnavailableResponse({
    description: 'Selected provider sandbox mode is not configured',
  })
  createCheckoutSession(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: CreateCheckoutSessionRequestDto,
  ): Promise<CheckoutSessionResponseDto> {
    return this.paymentsService.createCheckoutSession(user.id, request);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read local payment state for an owned payment' })
  @ApiParam({ format: 'uuid', name: 'id' })
  @ApiOkResponse({ type: PaymentResponseDto })
  @ApiNotFoundResponse({ description: 'Payment not found for this user' })
  findById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<PaymentResponseDto> {
    return this.paymentsService.findById(id, user.id);
  }
}
