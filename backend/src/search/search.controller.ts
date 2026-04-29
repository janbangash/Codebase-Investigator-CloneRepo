import { Controller, Post, Get, Body, Param, Res, Sse, Logger } from '@nestjs/common';
import { Response } from 'express';
import { SemanticSearchService } from './semantic-search.service';
import { CodeSearchAgent } from './code-search.agent';

@Controller('api/search')
export class SearchController {
  private readonly logger = new Logger(SearchController.name);

  constructor(
    private readonly semanticService: SemanticSearchService,
    private readonly searchAgent: CodeSearchAgent
  ) {}

  @Post('index/:repoName')
  async buildIndex(
    @Param('repoName') repoName: string,
    @Body() body: { files: { path: string; content: string }[] }
  ) {
    await this.semanticService.buildSemanticIndex(repoName, body.files);
    return { success: true, ...this.semanticService.getIndexInfo(repoName) };
  }

  @Get('index/:repoName')
  getIndexInfo(@Param('repoName') repoName: string) {
    return this.semanticService.getIndexInfo(repoName);
  }

  @Post('semantic/:repoName')
  async semanticSearch(
    @Param('repoName') repoName: string,
    @Body() body: { query: string; limit?: number }
  ) {
    const results = await this.semanticService.semanticSearch(
      repoName,
      body.query,
      body.limit || 10
    );
    return { results };
  }

  @Get('symbol/:repoName/:symbol')
  searchBySymbol(
    @Param('repoName') repoName: string,
    @Param('symbol') symbol: string
  ) {
    const chunks = this.semanticService.searchBySymbol(repoName, symbol);
    return { chunks };
  }

  @Get('callers/:repoName/:symbol')
  findCallers(
    @Param('repoName') repoName: string,
    @Param('symbol') symbol: string
  ) {
    const chunks = this.semanticService.findCallers(repoName, symbol);
    return { chunks };
  }

  @Get('definitions/:repoName/:symbol')
  findDefinitions(
    @Param('repoName') repoName: string,
    @Param('symbol') symbol: string
  ) {
    const chunks = this.semanticService.findDefinitions(repoName, symbol);
    return { chunks };
  }

  @Post('agent/:repoName')
  async agentSearch(
    @Param('repoName') repoName: string,
    @Body() body: { query: string; context?: { line?: number; filePath?: string } }
  ) {
    const response = await this.searchAgent.search(repoName, body.query, body.context);
    return response;
  }

  @Sse('agent-stream/:repoName')
  async agentSearchStream(
    @Param('repoName') repoName: string,
    @Body() body: { query: string; context?: { line?: number; filePath?: string } },
    @Res() res: Response
  ) {
    const headers = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    };
    res.writeHead(200, headers);

    try {
      for await (const event of this.searchAgent.searchStream(repoName, body.query, body.context)) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      res.end();
    } catch (error) {
      this.logger.error(`Agent stream error: ${error.message}`);
      res.write(`data: ${JSON.stringify({ phase: 'error', data: { message: error.message } })}\n\n`);
      res.end();
    }
  }

  @Post('navigate/:repoName')
  async navigate(
    @Param('repoName') repoName: string,
    @Body() body: { filePath: string; line: number; action: 'definition' | 'callers' | 'references' }
  ) {
    const chunk = this.semanticService.getChunkAtLine(repoName, body.filePath, body.line);

    if (!chunk) {
      return { error: 'No chunk found at this location' };
    }

    switch (body.action) {
      case 'definition':
        const symbols = chunk.symbols;
        const definitions: any[] = [];
        for (const symbol of symbols) {
          const defs = this.semanticService.findDefinitions(repoName, symbol);
          definitions.push(...defs);
        }
        return { chunk, definitions: definitions.slice(0, 10) };

      case 'callers':
        const callers: any[] = [];
        for (const symbol of chunk.symbols.slice(0, 3)) {
          const callerChunks = this.semanticService.findCallers(repoName, symbol);
          callers.push(...callerChunks);
        }
        return { chunk, callers: callers.slice(0, 10) };

      case 'references':
        const refs: any[] = [];
        for (const symbol of chunk.symbols.slice(0, 3)) {
          const refChunks = this.semanticService.searchBySymbol(repoName, symbol);
          refs.push(...refChunks);
        }
        return { chunk, references: refs.slice(0, 10) };

      default:
        return { chunk };
    }
  }
}
