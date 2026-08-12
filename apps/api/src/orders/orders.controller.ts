import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import type { AuthenticatedUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateOrderRequestDto } from './dto/create-order-request.dto';
import { OrderListResponseDto } from './dto/order-list-response.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { OrdersService } from './orders.service';

@ApiBearerAuth()
@ApiTags('orders')
@Roles('USER', 'ADMIN')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ApiOperation({
    summary: 'Create an order from product IDs and server-calculated prices',
  })
  @ApiCreatedResponse({ type: OrderResponseDto })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: CreateOrderRequestDto,
  ): Promise<OrderResponseDto> {
    return this.ordersService.create(user.id, request);
  }

  @Get()
  @ApiOperation({ summary: 'List orders owned by the current user' })
  @ApiOkResponse({ type: OrderListResponseDto })
  list(@CurrentUser() user: AuthenticatedUser): Promise<OrderListResponseDto> {
    return this.ordersService.list(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an order owned by the current user' })
  @ApiParam({ format: 'uuid', name: 'id' })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiNotFoundResponse({ description: 'Order not found for this user' })
  findById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<OrderResponseDto> {
    return this.ordersService.findById(id, user.id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a pending order owned by the current user' })
  @ApiParam({ format: 'uuid', name: 'id' })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiNotFoundResponse({ description: 'Order not found for this user' })
  @ApiConflictResponse({
    description: 'Order cannot be cancelled from its state',
  })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<OrderResponseDto> {
    return this.ordersService.cancel(id, user.id);
  }
}
