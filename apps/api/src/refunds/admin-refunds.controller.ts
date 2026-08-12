import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import type { AuthenticatedUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateRefundRequestDto } from './dto/create-refund-request.dto';
import { CreateRefundResponseDto } from './dto/refund-response.dto';
import { RefundsService } from './refunds.service';

@ApiBearerAuth()
@ApiTags('admin', 'refunds')
@Roles('ADMIN')
@Controller('admin/payments')
export class AdminRefundsController {
  constructor(private readonly refundsService: RefundsService) {}

  @Post(':id/refunds')
  @ApiOperation({ summary: 'Create an idempotent full or partial refund' })
  @ApiParam({ format: 'uuid', name: 'id' })
  @ApiCreatedResponse({ type: CreateRefundResponseDto })
  @ApiNotFoundResponse({ description: 'Payment not found' })
  @ApiConflictResponse({
    description: 'Payment state or cumulative refund amount is invalid',
  })
  @ApiBadGatewayResponse({
    description: 'Provider refund request failed safely',
  })
  @ApiServiceUnavailableResponse({
    description: 'Payment provider sandbox mode is not configured',
  })
  create(
    @Param('id', new ParseUUIDPipe({ version: '4' })) paymentId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() request: CreateRefundRequestDto,
  ): Promise<CreateRefundResponseDto> {
    return this.refundsService.create(paymentId, actor.id, request);
  }
}
