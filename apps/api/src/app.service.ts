import { Injectable } from '@nestjs/common';

import { AppInfoResponseDto } from './dto/app-info-response.dto';

@Injectable()
export class AppService {
  getInfo(): AppInfoResponseDto {
    return {
      service: 'PayFlow API',
      stage: 8,
      health: '/health',
      docs: '/docs',
    };
  }
}
