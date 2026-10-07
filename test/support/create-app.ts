import { INestApplication, ModuleMetadata } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';

export interface ProviderOverride {
  token: unknown;
  value: unknown;
}

export interface TestAppOptions {
  overrides?: ProviderOverride[];
  controllers?: ModuleMetadata['controllers'];
  imports?: ModuleMetadata['imports'];
}

export async function createTestApp(options: TestAppOptions = {}): Promise<INestApplication> {
  let builder = Test.createTestingModule({
    imports: [AppModule, ...(options.imports ?? [])],
    controllers: options.controllers,
  });
  for (const { token, value } of options.overrides ?? []) {
    builder = builder.overrideProvider(token).useValue(value);
  }
  const app = (await builder.compile()).createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}
