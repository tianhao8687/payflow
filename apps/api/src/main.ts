import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { AppModule } from './app.module';
import type { ApiEnvironment } from './config/environment';
import { ApiExceptionFilter } from './http/api-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const configService = app.get(ConfigService<ApiEnvironment, true>);
  const appBaseUrl = configService.get('APP_BASE_URL', { infer: true });
  const port = configService.get('PORT', { infer: true });

  app.use(helmet());
  app.enableCors({
    origin: appBaseUrl,
    credentials: true,
  });
  app.enableShutdownHooks();
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('PayFlow API')
    .setDescription('PayFlow payment system REST API')
    .setVersion('0.8.0')
    .addBearerAuth({ bearerFormat: 'JWT', scheme: 'bearer', type: 'http' })
    .build();
  const documentFactory = () =>
    SwaggerModule.createDocument(app, swaggerConfig);

  SwaggerModule.setup('docs', app, documentFactory, {
    customSiteTitle: 'PayFlow API Docs',
    jsonDocumentUrl: 'openapi.json',
  });

  await app.listen(port, '0.0.0.0');
}

void bootstrap();
