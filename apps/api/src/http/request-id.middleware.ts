import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import {
  runWithCorrelation,
  setActiveSpanAttributes,
} from '@payflow/observability';

import { apiLogger } from '../observability';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(
    request: Request & { requestId?: string },
    response: Response,
    next: NextFunction,
  ): void {
    const suppliedRequestId = request.header('x-request-id');
    const requestId = suppliedRequestId?.trim() || randomUUID();

    request.requestId = requestId;
    response.setHeader('x-request-id', requestId);
    const startedAt = performance.now();

    runWithCorrelation({ requestId }, () => {
      setActiveSpanAttributes({ 'request.id': requestId });
      response.once('finish', () => {
        if (process.env.NODE_ENV !== 'test') {
          apiLogger.info('api.request.completed', {
            durationMs: Number((performance.now() - startedAt).toFixed(3)),
            method: request.method,
            path: request.originalUrl,
            status: response.statusCode,
          });
        }
      });
      next();
    });
  }
}
