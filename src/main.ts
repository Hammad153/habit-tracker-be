import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { configureApp } from './bootstrap';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Security middleware, validation, error filter, CORS and routing prefix.
  // Authentication is enforced globally via APP_GUARD (see app.module.ts).
  configureApp(app);

  const config = new DocumentBuilder()
    .setTitle('Habit Tracker')
    .setDescription('Manage habit, timeline, and awards')
    .setVersion('1.0')
    .build();

  const documentFactory = () =>
    SwaggerModule.createDocument(app, config, {
      operationIdFactory: (controllerKey: string, methodKey: string) =>
        methodKey,
    });

  SwaggerModule.setup('api/v1/docs', app, documentFactory, {
    jsonDocumentUrl: 'swagger/json',
  });

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');

  console.log(`app running on port:${await app.getUrl()} happy 4 coding...`);
}
bootstrap();
