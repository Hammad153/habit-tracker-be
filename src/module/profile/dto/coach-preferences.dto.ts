import { IsBoolean, IsIn } from 'class-validator';
import {
  COACH_FREQUENCY_VALUES,
  COACH_TONE_VALUES,
} from '../../../core/utils/coach-preference.utils';

export class UpdateCoachPreferencesDto {
  @IsBoolean()
  coachEnabled!: boolean;

  @IsBoolean()
  aiCoachEnabled!: boolean;

  @IsIn(COACH_TONE_VALUES as unknown as string[])
  coachTone!: string;

  @IsIn(COACH_FREQUENCY_VALUES as unknown as string[])
  coachFrequency!: string;

  @IsBoolean()
  weeklyReviewEnabled!: boolean;
}
