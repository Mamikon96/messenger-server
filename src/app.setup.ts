import type { INestApplication } from '@nestjs/common';
import { AppExceptionFilter } from './common/app-exception.filter.js';

export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AppExceptionFilter());
}
