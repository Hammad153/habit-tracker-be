import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AdminSystemService {
  constructor(private readonly configSvc: ConfigService) {}

  getSystemConfig() {
    return {
      appName: this.configSvc.get<string>('APP_NAME') || 'Ember',
      environment: process.env.NODE_ENV || 'development',
      privacyFloor: 5,
      rewardEngineDefaults: {
        fullCompletionCoins: 10,
        minimumCompletionCoins: 5,
        emergencyCompletionCoins: 2,
        streakBonus7DayCoins: 25,
        streakBonus30DayCoins: 100,
      },
      trialPeriodDays: 7,
      paystackEnabled: !!this.configSvc.get<string>('PAYSTACK_SECRET_KEY'),
      aiProviderConfigured: !!(
        this.configSvc.get<string>('OPENAI_API_KEY') ||
        this.configSvc.get<string>('NVIDIA_NIM_API_KEY')
      ),
    };
  }
}
