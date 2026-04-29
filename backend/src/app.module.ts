import { Module } from '@nestjs/common';
import { GitModule } from './git/git.module';
import { OllamaModule } from './ollama/ollama.module';
import { SearchModule } from './search/search.module';

@Module({
  imports: [GitModule, OllamaModule, SearchModule],
})
export class AppModule {}
