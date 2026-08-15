import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { AppModule } from './app.module';
import type { ApiEnvironment } from './config/environment';
import { ApiExceptionFilter } from './http/api-exception.filter';
import { apiLogger } from './observability';

export async function bootstrap(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: apiLogger,
    rawBody: true,
  });
  const configService = app.get(ConfigService<ApiEnvironment, true>);
  const appBaseUrl = configService.get('APP_BASE_URL', { infer: true });
  const nodeEnvironment = configService.get('NODE_ENV', { infer: true });
  const port = configService.get('PORT', { infer: true });
  const swaggerExplicitlyEnabled = configService.get('ENABLE_SWAGGER', {
    infer: true,
  });

  app.use(helmet());
  app.enableCors({
    origin: appBaseUrl,
    credentials: true,
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );

  if (nodeEnvironment !== 'production' || swaggerExplicitlyEnabled) {
    if (nodeEnvironment === 'production') {
      apiLogger.warn('api.swagger.production_enabled');
    }
    const swaggerConfig = new DocumentBuilder()
      .setTitle('PayFlow API')
      .setDescription('PayFlow payment system REST API')
      .setVersion('0.11.0')
      .addBearerAuth({ bearerFormat: 'JWT', scheme: 'bearer', type: 'http' })
      .build();
    const documentFactory = () =>
      SwaggerModule.createDocument(app, swaggerConfig);

    SwaggerModule.setup('docs', app, documentFactory, {
      customSiteTitle: 'PayFlow API Docs',
      jsonDocumentUrl: 'openapi.json',
    });
  }

  await app.listen(port, '0.0.0.0');
  apiLogger.info('api.ready', { port });
  return app;
}
