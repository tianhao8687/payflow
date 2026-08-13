import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { apiLogger } from '../observability';

interface ErrorPayload {
  code?: string;
  details?: unknown;
  message?: string | string[];
}

interface ExpressBodyParserError extends Error {
  status?: unknown;
  statusCode?: unknown;
  type?: unknown;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { requestId?: string }>();
    const response = http.getResponse<Response>();
    const status = this.getStatus(exception);
    const payload = this.getPayload(exception);
    const requestId = request.requestId ?? 'unknown';

    if (status >= 500) {
      apiLogger.error('api.request.failed', {
        method: request.method,
        path: request.url,
        requestId,
        status,
        error: exception,
      });
    }

    response.status(status).json({
      code: payload.code ?? `HTTP_${status}`,
      message: this.normalizeMessage(payload.message, status),
      requestId,
      details: payload.details ?? null,
    });
  }

  private getStatus(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }

    if (isPayloadTooLargeError(exception)) {
      return HttpStatus.PAYLOAD_TOO_LARGE;
    }

    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private getPayload(exception: unknown): ErrorPayload {
    if (isPayloadTooLargeError(exception)) {
      return {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body exceeds the maximum allowed size.',
      };
    }

    if (!(exception instanceof HttpException)) {
      return {};
    }

    const response = exception.getResponse();

    if (typeof response === 'string') {
      return { message: response };
    }

    return response;
  }

  private normalizeMessage(
    message: ErrorPayload['message'],
    status: number,
  ): string {
    if (Array.isArray(message)) {
      return message.join('; ');
    }

    if (message) {
      return message;
    }

    return status >= 500 ? 'Internal server error' : 'Request failed';
  }
}

function isPayloadTooLargeError(
  exception: unknown,
): exception is ExpressBodyParserError {
  if (!(exception instanceof Error)) {
    return false;
  }

  const candidate = exception as ExpressBodyParserError;
  return (
    candidate.type === 'entity.too.large' &&
    (candidate.status === HttpStatus.PAYLOAD_TOO_LARGE ||
      candidate.statusCode === HttpStatus.PAYLOAD_TOO_LARGE)
  );
}
