import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express, { Express } from 'express';
import { AppModule } from '../src/app.module';
import { AllExcenptionFilter } from '../src/all-exception.filter';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

const expressApp: Express = express();

const bootstrap = async () => {
  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(expressApp),
  );

  const { httpAdapter } = app.get(HttpAdapterHost);

  app.use(express.json());
  app.use('/uploads', express.static('uploads'));
  app.useGlobalFilters(new AllExcenptionFilter(httpAdapter));
  app.enableCors();
  app.setGlobalPrefix('api/v1');

  const config = new DocumentBuilder()
    .setTitle('SME GLOBAL')
    .setDescription('Manage invoices, payroll, and products')
    .setVersion('1.0')
    .addTag('sme')
    .addBearerAuth()
    .build();

  const documentFactory = () =>
    SwaggerModule.createDocument(app, config, {
      operationIdFactory: (controllerKey: string, methodKey: string) =>
        methodKey,
    });

  SwaggerModule.setup('docs', app, documentFactory, {
    jsonDocumentUrl: 'docs/json',
    customCssUrl:
      'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui.min.css',
    customJs: [
      'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui-bundle.js',
      'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui-standalone-preset.js',
    ],
  });

  await app.init();
};

bootstrap();

export default expressApp;
