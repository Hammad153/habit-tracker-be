import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersController } from './module/users/users.controller';
import { UsersModule } from './module/users/users.module';
import { UsersService } from './module/users/users.service';
import { DatabaseModule } from './core/database/database.module';
// import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { MyLoggerModule } from '../log/my-logger/my-logger.module';
import { MyLoggerService } from '../log/my-logger/my-logger.service';
import { AuthModule } from './module/auth/auth.module';
import { ProfileModule } from './module/profile/profile.module';
import { AwardsModule } from './module/awards/awards.module';
import { TimelineModule } from './module/timeline/timeline.module';
import { HabitModule } from './module/habit/habit.module';
import { SubscriptionModule } from './module/subscription/subscription.module';
import { ReminderModule } from './module/reminder/reminder.module';
import { TemplateModule } from './module/template/template.module';
import { ExportModule } from './module/export/export.module';
import { AnalyticsModule } from './module/analytics/analytics.module';
import { ConfigModule } from '@nestjs/config';
import { MailerModule } from './module/mailer/mailer.module';
import { configValidationSchema } from './core/config/config.validation';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    UsersModule,
    DatabaseModule,
    MyLoggerModule,
    AuthModule,
    /*
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'short',
          ttl: 1000,
          limit: 10,
        },
        {
          name: 'long',
          ttl: 60000,
          limit: 100,
        },
      ],
    }),
    */
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: configValidationSchema,
    }),
    JwtModule.register({}),
    MailerModule,
    ProfileModule,
    HabitModule,
    TimelineModule,
    AwardsModule,
    SubscriptionModule,
    ReminderModule,
    TemplateModule,
    ExportModule,
    AnalyticsModule,
  ],
  controllers: [AppController, UsersController],
  providers: [
    AppService,
    UsersService,
    MyLoggerService,
    // { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
