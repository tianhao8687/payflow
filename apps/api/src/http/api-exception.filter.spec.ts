import type { ArgumentsHost } from '@nestjs/common';

import { ApiExceptionFilter } from './api-exception.filter';

describe('ApiExceptionFilter', () => {
  it('preserves the 413 status emitted by the Express JSON parser', () => {
    const response = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          requestId: 'request-413',
          url: '/orders',
        }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;
    const error = Object.assign(new Error('request entity too large'), {
      status: 413,
      statusCode: 413,
      type: 'entity.too.large',
    });

    new ApiExceptionFilter().catch(error, host);

    expect(response.status).toHaveBeenCalledWith(413);
    expect(response.json).toHaveBeenCalledWith({
      code: 'PAYLOAD_TOO_LARGE',
      details: null,
      message: 'Request body exceeds the maximum allowed size.',
      requestId: 'request-413',
    });
  });
});
