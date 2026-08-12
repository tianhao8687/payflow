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
    it('describes the Stage 3 API surface', () => {
      expect(appController.getInfo()).toEqual({
        service: 'PayFlow API',
        stage: 3,
        health: '/health',
        docs: '/docs',
      });
    });
  });
});
