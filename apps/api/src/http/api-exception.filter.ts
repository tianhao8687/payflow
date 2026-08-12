import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorPayload {
  code?: string;
  details?: unknown;
  message?: string | string[];
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { requestId?: string }>();
    const response = http.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = this.getPayload(exception);
    const requestId = request.requestId ?? 'unknown';

    if (status >= 500) {
      this.logger.error(
        JSON.stringify({
          message: 'Unhandled API exception',
          method: request.method,
          path: request.url,
          requestId,
          status,
        }),
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json({
      code: payload.code ?? `HTTP_${status}`,
      message: this.normalizeMessage(payload.message, status),
      requestId,
      details: payload.details ?? null,
    });
  }

  private getPayload(exception: unknown): ErrorPayload {
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
