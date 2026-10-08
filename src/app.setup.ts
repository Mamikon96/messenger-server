import type { INestApplication } from '@nestjs/common';
import { AppExceptionFilter } from './common/app-exception.filter.js';
import { SessionWsAdapter } from './realtime/session-ws-adapter.js';

export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AppExceptionFilter());
  app.useWebSocketAdapter(new SessionWsAdapter(app));
}
