import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import converterConfig from './converter.config';
import { HtmlConverterService } from './converter.service';

@Global()
@Module({
  imports: [ConfigModule.forFeature(converterConfig)],
  providers: [HtmlConverterService],
  exports: [HtmlConverterService],
})
export class HtmlConverterModule {}
