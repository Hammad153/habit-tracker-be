import { Module } from '@nestjs/common';
import { AI_PROVIDER } from './ai-provider.interface';
import { NvidiaProvider } from './providers/nvidia/nvidia.provider';

/**
 * Registers the concrete provider behind the AiProvider abstraction.
 * Swapping vendors later means changing ONLY this module (spec §41).
 */
@Module({
  providers: [
    NvidiaProvider,
    { provide: AI_PROVIDER, useExisting: NvidiaProvider },
  ],
  exports: [AI_PROVIDER],
})
export class AiProviderModule {}
