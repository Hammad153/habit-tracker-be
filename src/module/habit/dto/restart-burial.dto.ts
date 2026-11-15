import { IsUUID } from 'class-validator';

export class RestartBurialDto {
  @IsUUID()
  newHabitId!: string;
}
