import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('describes the Stage 6 API surface', () => {
      expect(appController.getInfo()).toEqual({
        service: 'PayFlow API',
        stage: 6,
        health: '/health',
        docs: '/docs',
      });
    });
  });
});
