import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './module/users/users.module';
import { DatabaseModule } from './core/database/database.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { MyLoggerModule } from '../log/my-logger/my-logger.module';
import { MyLoggerService } from '../log/my-logger/my-logger.service';
import { AuthModule } from './module/auth/auth.module';
import { AuthGuard } from './module/auth/auth.guard';
import { ProfileModule } from './module/profile/profile.module';
import { AwardsModule } from './module/awards/awards.module';
import { TimelineModule } from './module/timeline/timeline.module';
import { HabitModule } from './module/habit/habit.module';
import { ConfigModule } from '@nestjs/config';
import { MailerModule } from './module/mailer/mailer.module';
import { TemplateModule } from './module/template/template.module';
import { SubscriptionModule } from './module/subscription/subscription.module';
import { AnalyticsModule } from './module/analytics/analytics.module';
import { ExportModule } from './module/export/export.module';
import { ReminderModule } from './module/reminder/reminder.module';
import { BudgetModule } from './module/budget/budget.module';
import { DailyPlanModule } from './module/daily-plan/daily-plan.module';
import { JournalModule } from './module/journal/journal.module';
import { configValidationSchema } from './core/config/config.validation';

@Module({
  imports: [
    UsersModule,
    DatabaseModule,
    MyLoggerModule,
    AuthModule,
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'short', ttl: 1000, limit: 10 },
        { name: 'long', ttl: 60000, limit: 100 },
      ],
    }),
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: configValidationSchema,
    }),
    MailerModule,
    ProfileModule,
    HabitModule,
    TimelineModule,
    AwardsModule,
    TemplateModule,
    SubscriptionModule,
    AnalyticsModule,
    ExportModule,
    ReminderModule,
    BudgetModule,
    DailyPlanModule,
    JournalModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    MyLoggerService,
    // Rate limiting runs first so it protects even public routes (e.g. login).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Global authentication: every route requires a valid JWT unless marked
    // with @Public(). Reuses the instance exported by AuthModule.
    { provide: APP_GUARD, useExisting: AuthGuard },
  ],
})
export class AppModule {}
