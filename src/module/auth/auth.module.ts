import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConfigModule } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { DatabaseService } from '../../core/database/database.service';

@Module({
  imports: [
    UsersModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configSvc: ConfigService): JwtModuleOptions => ({
        global: true,
        secret: configSvc.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configSvc.get<string>('JWT_EXPIRES_IN') || '1h',
        } as JwtModuleOptions['signOptions'],
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, UsersService, DatabaseService],
  exports: [AuthService],
})
export class AuthModule {}
