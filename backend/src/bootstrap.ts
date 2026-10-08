import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Config } from './infrastructure/config';

export function configureApp(app: INestApplication) {
  const config = app.get(Config);
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: config.origin, credentials: true });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, forbidNonWhitelisted: true, transform: true,
  }));
  const swagger = new DocumentBuilder()
    .setTitle('FML API').setDescription('Fantasy Manager League — prices in tenths of a million')
    .setVersion('1.0').addBearerAuth().addCookieAuth('fml_refresh').build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger));
}
