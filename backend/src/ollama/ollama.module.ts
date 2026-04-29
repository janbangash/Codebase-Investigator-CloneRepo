import { Module } from '@nestjs/common';
import { OllamaService } from './ollama.service';
import { OllamaController } from './ollama.controller';
import { GitModule } from '../git/git.module';
import { SearchModule } from '../search/search.module';

@Module({
  imports: [GitModule, SearchModule],
  providers: [OllamaService],
  controllers: [OllamaController],
  exports: [OllamaService],
})
export class OllamaModule {}
