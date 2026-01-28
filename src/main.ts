import { HttpAdapterHost, NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExcenptionFilter } from './all-exception.filter';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as express from 'express';
import { AuthGuard } from './module/auth/auth.guard';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './module/auth/auth.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const reflector = app.get(Reflector);

  //app.useGlobalGuards(
  //  new AuthGuard(app.get(JwtService), app.get(AuthService), reflector),
  //);
  app.use(express.json());
  app.use('/uploads', express.static('uploads'));

  const { httpAdapter } = app.get(HttpAdapterHost);

  app.useGlobalFilters(new AllExcenptionFilter(httpAdapter));

  app.enableCors();
  app.setGlobalPrefix('api');

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

  SwaggerModule.setup('api', app, documentFactory, {
    jsonDocumentUrl: 'swagger/json',
  });

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');

  console.log(`app running on port:${await app.getUrl()} happy 4 coding...`);
}
bootstrap();
