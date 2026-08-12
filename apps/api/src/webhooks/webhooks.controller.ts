import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { Public } from '../auth/decorators/public.decorator';
import { WebhookResponseDto } from './dto/webhook-response.dto';
import { WebhooksService } from './webhooks.service';

@Public()
@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify, persist, deduplicate, and enqueue a Stripe webhook',
  })
  @ApiBody({
    description: 'Unmodified Stripe Event JSON; signature uses exact bytes',
    schema: { type: 'object', additionalProperties: true },
  })
  @ApiOkResponse({ type: WebhookResponseDto })
  @ApiBadRequestResponse({
    description: 'Missing raw body or invalid signature',
  })
  @ApiServiceUnavailableResponse({
    description: 'Webhook signing secret is not configured',
  })
  handleStripe(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<WebhookResponseDto> {
    return this.webhooksService.handleStripe(request.rawBody, signature);
  }

  @Post('paypal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify, persist, deduplicate, and enqueue a PayPal webhook',
  })
  @ApiBody({
    description: 'Unmodified PayPal event JSON; verification uses exact bytes',
    schema: { type: 'object', additionalProperties: true },
  })
  @ApiOkResponse({ type: WebhookResponseDto })
  @ApiBadRequestResponse({
    description: 'Missing raw body or invalid signature',
  })
  @ApiServiceUnavailableResponse({
    description: 'PayPal webhook verification is not configured',
  })
  handlePayPal(
    @Req() request: RawBodyRequest<Request>,
    @Headers('paypal-transmission-sig') signature: string | undefined,
    @Headers('paypal-transmission-id') transmissionId: string | undefined,
    @Headers('paypal-transmission-time') transmissionTime: string | undefined,
    @Headers('paypal-cert-url') certUrl: string | undefined,
    @Headers('paypal-auth-algo') authAlgo: string | undefined,
  ): Promise<WebhookResponseDto> {
    return this.webhooksService.handlePayPal(request.rawBody, signature, {
      'paypal-auth-algo': authAlgo,
      'paypal-cert-url': certUrl,
      'paypal-transmission-id': transmissionId,
      'paypal-transmission-time': transmissionTime,
    });
  }
}
