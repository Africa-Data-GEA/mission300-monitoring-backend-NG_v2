import { PLATFORM_NAME } from "@/common/platform-name";
import "reflect-metadata";
import cookieParser from "cookie-parser";
import compression from "compression";
import helmet from "helmet";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";
import { AppModule } from "@/app.module";
import { HttpExceptionFilter } from "@/common/filters/http-exception.filter";
import { isAllowedOrigin, parseAllowedOrigins } from "@/config/cors";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.use(compression({ threshold: 1024 }));
  // Needed to read the httpOnly refresh-token cookie on POST /auth/refresh.
  app.use(cookieParser());

  const allowedOrigins = parseAllowedOrigins(process.env.CORS_ORIGIN);
  const isDevelopment = process.env.NODE_ENV === "development";
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) =>
      callback(null, isAllowedOrigin(origin, allowedOrigins, isDevelopment)),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle(`${PLATFORM_NAME} API`)
    .setDescription(`${PLATFORM_NAME} - backend API`)
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

void bootstrap();
