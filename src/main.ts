import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import type { EnvVars } from './config/env.validation';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    // Webhook signatures are computed over the exact bytes received, so the
    // raw body must survive JSON parsing.
    rawBody: true,
  });
  const config = app.get(ConfigService<EnvVars, true>);

  // REST under /api/v1 — the spec splits audiences by path below this
  // (/app/customer/*, /app/instructor/*, /admin/*), not by version.
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties with no DTO decorator
      forbidNonWhitelisted: true, // and reject the request that sent them
      transform: true, // coerce payloads into DTO instances
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  // Explicit host: behind a reverse proxy this must be loopback, or the app
  // answers the internet directly and bypasses whatever the proxy enforces.
  // See HOST in config/env.validation.ts.
  const host = config.get('HOST', { infer: true });
  await app.listen(port, host);

  new Logger('Bootstrap').log(
    `HelloFit API listening on http://${host}:${port}/api/v1`,
  );
}

void bootstrap();
