import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import { AdminService } from './admin.service';
import {
  AdminAuditLogsQueryDto,
  AdminOrdersQueryDto,
  AdminPaymentsQueryDto,
  AdminRefundsQueryDto,
  AdminWebhooksQueryDto,
} from './dto/admin-query.dto';
import {
  AdminAuditLogsResponseDto,
  AdminDashboardResponseDto,
  AdminOrderDetailDto,
  AdminOrdersResponseDto,
  AdminPaymentDetailDto,
  AdminPaymentsResponseDto,
  AdminRefundsResponseDto,
  AdminWebhooksResponseDto,
  AdminWebhookQueueResponseDto,
} from './dto/admin-response.dto';

@ApiBearerAuth()
@ApiTags('admin')
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Read operational payment-system counters' })
  @ApiOkResponse({ type: AdminDashboardResponseDto })
  dashboard(): Promise<AdminDashboardResponseDto> {
    return this.adminService.dashboard();
  }

  @Get('orders')
  @ApiOperation({ summary: 'Search and paginate orders' })
  @ApiOkResponse({ type: AdminOrdersResponseDto })
  orders(@Query() query: AdminOrdersQueryDto): Promise<AdminOrdersResponseDto> {
    return this.adminService.orders(query);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'Read an order with items and payment attempts' })
  @ApiParam({ format: 'uuid', name: 'id' })
  @ApiOkResponse({ type: AdminOrderDetailDto })
  @ApiNotFoundResponse({ description: 'Order not found' })
  order(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<AdminOrderDetailDto> {
    return this.adminService.order(id);
  }

  @Get('payments')
  @ApiOperation({ summary: 'Search and paginate payments' })
  @ApiOkResponse({ type: AdminPaymentsResponseDto })
  payments(
    @Query() query: AdminPaymentsQueryDto,
  ): Promise<AdminPaymentsResponseDto> {
    return this.adminService.payments(query);
  }

  @Get('payments/:id')
  @ApiOperation({
    summary: 'Read a payment with provider attempts and refunds',
  })
  @ApiParam({ format: 'uuid', name: 'id' })
  @ApiOkResponse({ type: AdminPaymentDetailDto })
  @ApiNotFoundResponse({ description: 'Payment not found' })
  payment(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<AdminPaymentDetailDto> {
    return this.adminService.payment(id);
  }

  @Get('refunds')
  @ApiOperation({ summary: 'Search and paginate refunds' })
  @ApiOkResponse({ type: AdminRefundsResponseDto })
  refunds(
    @Query() query: AdminRefundsQueryDto,
  ): Promise<AdminRefundsResponseDto> {
    return this.adminService.refunds(query);
  }

  @Get('webhooks')
  @ApiOperation({ summary: 'Search and paginate persisted webhook events' })
  @ApiOkResponse({ type: AdminWebhooksResponseDto })
  webhooks(
    @Query() query: AdminWebhooksQueryDto,
  ): Promise<AdminWebhooksResponseDto> {
    return this.adminService.webhooks(query);
  }

  @Get('queues/webhooks')
  @ApiOperation({
    summary: 'Inspect BullMQ webhook retries and final failures',
  })
  @ApiOkResponse({ type: AdminWebhookQueueResponseDto })
  webhookQueue(): Promise<AdminWebhookQueueResponseDto> {
    return this.adminService.webhookQueueSnapshot();
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'Search and paginate administrator audit logs' })
  @ApiOkResponse({ type: AdminAuditLogsResponseDto })
  auditLogs(
    @Query() query: AdminAuditLogsQueryDto,
  ): Promise<AdminAuditLogsResponseDto> {
    return this.adminService.auditLogs(query);
  }
}
