import { Injectable } from '@nestjs/common';
import { type AppConfig, parseEnv } from './env.schema.js';

@Injectable()
export class ConfigService {
  private readonly config: AppConfig = parseEnv(process.env);

  get(): AppConfig {
    return this.config;
  }
}
