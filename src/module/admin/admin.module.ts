import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../core/database/database.module';
import { AuditLogService } from './audit-log/audit-log.service';
import { AuditLogController } from './audit-log/audit-log.controller';
import { AdminUsersService } from './users/admin-users.service';
import { AdminUsersController } from './users/admin-users.controller';
import { AdminHabitsService } from './habits/admin-habits.service';
import { AdminHabitsController } from './habits/admin-habits.controller';
import { AdminShopService } from './shop/admin-shop.service';
import { AdminShopController } from './shop/admin-shop.controller';
import { AdminSystemService } from './system/admin-system.service';
import { AdminSystemController } from './system/admin-system.controller';
import { SubscriptionModule } from '../subscription/subscription.module';
import { AdminNotificationsController } from './notifications/admin-notifications.controller';
import { AdminNotificationsService } from './notifications/admin-notifications.service';

@Module({
  imports: [DatabaseModule, SubscriptionModule],
  controllers: [
    AuditLogController,
    AdminUsersController,
    AdminHabitsController,
    AdminShopController,
    AdminSystemController,
    AdminNotificationsController,
  ],
  providers: [
    AuditLogService,
    AdminUsersService,
    AdminHabitsService,
    AdminShopService,
    AdminSystemService,
    AdminNotificationsService,
  ],
  exports: [
    AuditLogService,
    AdminUsersService,
    AdminHabitsService,
    AdminShopService,
    AdminSystemService,
    AdminNotificationsService,
  ],
})
export class AdminModule {}
