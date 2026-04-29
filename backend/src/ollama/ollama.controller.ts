import { Controller, Post, Get, Body, Param, Query, Res, Sse, Logger } from '@nestjs/common';
import { Response } from 'express';
import { OllamaService, ChatMessage, CodeChunk } from './ollama.service';
import { CodeSearchAgent } from '../search/code-search.agent';

@Controller('api/ai')
export class OllamaController {
  private readonly logger = new Logger(OllamaController.name);

  constructor(
    private readonly ollamaService: OllamaService,
    private readonly searchAgent: CodeSearchAgent
  ) {}

  @Get('status/:repoName')
  getIndexStatus(@Param('repoName') repoName: string) {
    return this.ollamaService.getIndexingStatus(repoName);
  }

  @Post('index/:repoName')
  async indexRepo(@Param('repoName') repoName: string) {
    await this.ollamaService.indexRepository(repoName);
    return { success: true };
  }

  @Post('chat/:repoName')
  async chat(
    @Param('repoName') repoName: string,
    @Body() body: { messages: ChatMessage[] },
  ): Promise<{ response: string; codeReferences: CodeChunk[]; ollamaAvailable: boolean }> {
    return this.ollamaService.chat(repoName, body.messages);
  }

  @Get('available')
  getOllamaStatus(): { available: boolean; model?: string; embedModel?: string } {
    const status = this.ollamaService.isOllamaAvailable();
    return {
      available: status,
      model: status ? process.env.OLLAMA_MODEL : undefined,
      embedModel: status ? process.env.OLLAMA_EMBED_MODEL : undefined,
    };
  }

  @Get('search/:repoName')
  async search(
    @Param('repoName') repoName: string,
    @Query('q') query: string,
  ): Promise<{ results: CodeChunk[]; analysis: { keywords: string[]; intent: string; suggestions: string[] } }> {
    // AI-powered search with query analysis
    const analysis = await this.ollamaService.analyzeQueryIntent(query);
    const results = await this.ollamaService.enhancedTextSearch(repoName, query, 15);
    return { results, analysis };
  }

  @Get('search-stream/:repoName')
  async searchStream(
    @Param('repoName') repoName: string,
    @Query('q') query: string,
  ): Promise<CodeChunk[]> {
    return this.ollamaService.enhancedTextSearch(repoName, query, 20);
  }

  @Post('chat-stream/:repoName')
  async chatStream(
    @Param('repoName') repoName: string,
    @Body() body: { messages: ChatMessage[] },
    @Res() res: Response,
  ) {
    // Use SSE for streaming chat response with progress
    const headers = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    };
    res.writeHead(200, headers);

    try {
      for await (const event of this.ollamaService.chatStream(repoName, body.messages)) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      res.end();
    } catch (error) {
      this.logger.error(`Chat stream error: ${error.message}`);
      res.write(`data: ${JSON.stringify({ type: 'error', data: { message: error.message } })}\n\n`);
      res.end();
    }
  }

  @Post('agent/:repoName')
  async agentSearch(
    @Param('repoName') repoName: string,
    @Body() body: { query: string }
  ) {
    // Agent-based semantic search with RAG
    const response = await this.searchAgent.search(repoName, body.query);
    return response;
  }

  @Sse('agent-stream/:repoName')
  async agentSearchStream(
    @Param('repoName') repoName: string,
    @Body() body: { query: string },
    @Res() res: Response,
  ) {
    const headers = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    };
    res.writeHead(200, headers);

    try {
      for await (const event of this.searchAgent.searchStream(repoName, body.query)) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      res.end();
    } catch (error) {
      this.logger.error(`Agent stream error: ${error.message}`);
      res.write(`data: ${JSON.stringify({ phase: 'error', data: { message: error.message } })}\n\n`);
      res.end();
    }
  }

  @Get('navigate/:repoName')
  async navigate(
    @Param('repoName') repoName: string,
    @Query('file') filePath: string,
    @Query('line') line: number,
    @Query('action') action: 'definition' | 'callers' | 'references'
  ) {
    // Source-level navigation
    const chunk = this.ollamaService.getChunkAtLine(repoName, filePath, line);
    if (!chunk) {
      return { error: 'No chunk found at this location' };
    }

    const result: any = { chunk };

    // Extract potential symbols from chunk content using regex
    const content = chunk.content;
    const symbols: string[] = [];

    // Extract function names, class names, and variable names
    const functionMatches = content.matchAll(/(?:function|class|const|let|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g);
    for (const match of functionMatches) {
      symbols.push(match[1]);
    }

    if (action === 'definition') {
      result.definitions = symbols.slice(0, 3).flatMap(s =>
        this.ollamaService.findDefinitions(repoName, s)
      ).slice(0, 10);
    } else if (action === 'callers') {
      result.callers = symbols.slice(0, 3).flatMap(s =>
        this.ollamaService.findCallers(repoName, s)
      ).slice(0, 10);
    } else if (action === 'references') {
      result.references = symbols.slice(0, 3).flatMap(s =>
        this.ollamaService.searchBySymbol(repoName, s)
      ).slice(0, 10);
    }

    return result;
  }
}
