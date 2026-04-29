import { Module } from '@nestjs/common';
import { SemanticSearchService } from './semantic-search.service';
import { CodeSearchAgent } from './code-search.agent';
import { GitModule } from '../git/git.module';
import { SearchController } from './search.controller';

@Module({
  imports: [GitModule],
  providers: [SemanticSearchService, CodeSearchAgent],
  exports: [SemanticSearchService, CodeSearchAgent],
  controllers: [SearchController],
})
export class SearchModule {}
