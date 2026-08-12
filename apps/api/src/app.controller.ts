import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AppInfoResponseDto } from './dto/app-info-response.dto';
import { AppService } from './app.service';
import { Public } from './auth/decorators/public.decorator';

@Public()
@ApiTags('system')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Describe the PayFlow API bootstrap' })
  @ApiOkResponse({ type: AppInfoResponseDto })
  getInfo(): AppInfoResponseDto {
    return this.appService.getInfo();
  }
}
