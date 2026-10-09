import { Logger, type INestApplication } from '@nestjs/common';
import { AppExceptionFilter } from './common/app-exception.filter.js';
import { ConfigService } from './config/config.service.js';
import { SessionWsAdapter } from './realtime/session-ws-adapter.js';

export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService).get();
  app.getHttpAdapter().getInstance().set('trust proxy', config.trustProxy);
  if (config.publicUrl.startsWith('https:') && config.trustProxy === 0) {
    new Logger('Bootstrap').warn(
      'PUBLIC_URL is https but TRUST_PROXY=0: behind a reverse proxy all clients share one IP rate-limit bucket; set TRUST_PROXY to the number of proxies',
    );
  }
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AppExceptionFilter());
  app.useWebSocketAdapter(new SessionWsAdapter(app));
}
