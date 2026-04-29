import { Injectable, Logger } from '@nestjs/common';
import { Ollama } from 'ollama';
import { SemanticSearchService, SemanticChunk, SearchResult } from './semantic-search.service';

export interface SearchPlan {
  intent: 'find' | 'explain' | 'navigate' | 'compare' | 'debug';
  keywords: string[];
  symbols: string[];
  fileTypes: string[];
  strategies: SearchStrategy[];
}

export interface SearchStrategy {
  type: 'semantic' | 'symbol' | 'text' | 'reference';
  query: string;
  priority: number;
}

export interface AgentResponse {
  answer: string;
  results: SearchResult[];
  thoughts: AgentThought[];
  navigation: NavigationSuggestion[];
  confidence: 'high' | 'medium' | 'low';
}

export interface AgentThought {
  phase: 'analyze' | 'plan' | 'search' | 'retrieve' | 'reason' | 'respond';
  thought: string;
  action?: string;
  result?: string;
}

export interface NavigationSuggestion {
  type: 'definition' | 'callers' | 'references' | 'related';
  label: string;
  chunk: SemanticChunk;
}

@Injectable()
export class CodeSearchAgent {
  private readonly logger = new Logger(CodeSearchAgent.name);
  private readonly client: Ollama;
  private readonly model = process.env.OLLAMA_MODEL || 'codellama:7b-instruct';

  constructor(private readonly semanticService: SemanticSearchService) {
    this.client = new Ollama({ host: 'http://localhost:11434' });
  }

  // ============ MAIN SEARCH ORCHESTRATION ============

  async search(
    repoName: string,
    query: string,
    context: { line?: number; filePath?: string } = {}
  ): Promise<AgentResponse> {
    const thoughts: AgentThought[] = [];

    // Phase 1: Analyze the query
    const analysis = await this.analyzeQuery(query, context);
    thoughts.push({
      phase: 'analyze',
      thought: analysis.intent,
      action: 'query_analysis',
      result: `Intent: ${analysis.intent}, Keywords: ${analysis.keywords.join(', ')}`,
    });

    // Phase 2: Create search plan
    const plan = await this.createSearchPlan(analysis);
    thoughts.push({
      phase: 'plan',
      thought: `Executing ${plan.strategies.length} search strategies`,
      action: 'search_planning',
      result: plan.strategies.map(s => `${s.type}:${s.query}`).join(', '),
    });

    // Phase 3: Execute search strategies
    const allResults = await this.executeSearchStrategies(repoName, plan);
    thoughts.push({
      phase: 'search',
      thought: `Found ${allResults.length} potential matches`,
      action: 'parallel_search',
      result: `Retrieved ${allResults.length} chunks`,
    });

    // Phase 4: Retrieve and analyze context
    const enrichedResults = await this.enrichWithContext(repoName, allResults);
    thoughts.push({
      phase: 'retrieve',
      thought: 'Analyzing code context and relationships',
      action: 'context_enrichment',
      result: `Enriched ${enrichedResults.length} results with context`,
    });

    // Phase 5: Reason about results
    const reasoning = await this.reasonAboutResults(query, enrichedResults, plan);
    thoughts.push({
      phase: 'reason',
      thought: reasoning.summary,
      action: 'synthesis',
      result: `Confidence: ${reasoning.confidence}`,
    });

    // Phase 6: Generate response
    const response = await this.generateResponse(query, enrichedResults, reasoning, plan);
    thoughts.push({
      phase: 'respond',
      thought: 'Generated final response with navigation hints',
      action: 'response_generation',
    });

    // Generate navigation suggestions
    const navigation = this.generateNavigationSuggestions(repoName, enrichedResults, plan);

    return {
      answer: response,
      results: enrichedResults.slice(0, 10),
      thoughts,
      navigation,
      confidence: reasoning.confidence,
    };
  }

  // ============ PHASE 1: QUERY ANALYSIS ============

  private async analyzeQuery(
    query: string,
    context: { line?: number; filePath?: string }
  ): Promise<{ intent: string; keywords: string[]; symbols: string[] }> {
    try {
      const response = await this.client.chat({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are a code search analyst. Extract the search intent and key terms from the user's query.

Intent types:
- find: Looking for specific code, files, or symbols
- explain: Wanting to understand how something works
- navigate: Wanting to go to a specific location
- compare: Comparing different approaches
- debug: Troubleshooting an issue

Respond in JSON: {"intent": "find", "keywords": ["term1", "term2"], "symbols": ["SymbolName"]}`,
          },
          {
            role: 'user',
            content: query + (context.filePath ? ` (context: ${context.filePath}${context.line ? ':' + context.line : ''})` : ''),
          },
        ],
        stream: false,
      });

      const content = response.message.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          intent: parsed.intent || 'find',
          keywords: parsed.keywords || this.extractKeywords(query),
          symbols: parsed.symbols || this.extractSymbols(query),
        };
      }
    } catch (err) {
      this.logger.debug(`Query analysis failed: ${err.message}`);
    }

    // Fallback heuristic analysis
    return {
      intent: this.detectIntent(query),
      keywords: this.extractKeywords(query),
      symbols: this.extractSymbols(query),
    };
  }

  private detectIntent(query: string): string {
    const q = query.toLowerCase();

    if (q.includes('explain') || q.includes('how does') || q.includes('what does')) {
      return 'explain';
    }
    if (q.includes('go to') || q.includes('navigate') || q.includes('open')) {
      return 'navigate';
    }
    if (q.includes('compare') || q.includes('difference') || q.includes('vs')) {
      return 'compare';
    }
    if (q.includes('error') || q.includes('bug') || q.includes('not working') || q.includes('fix')) {
      return 'debug';
    }

    return 'find';
  }

  private extractKeywords(query: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
      'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
      'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
      'through', 'during', 'before', 'after', 'above', 'below', 'between',
      'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
      'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other',
      'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
      'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until',
      'while', 'although', 'though', 'which', 'that', 'this', 'these', 'those',
      'what', 'who', 'whom', 'whose', 'show', 'me', 'find', 'get', 'tell',
      'explain', 'give', 'looking', 'for', 'want', 'need', 'search', 'code',
    ]);

    const words = query
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()));

    return [...new Set(words)].slice(0, 10);
  }

  private extractSymbols(query: string): string[] {
    const symbols: string[] = [];

    // CamelCase symbols
    const camelMatches = query.matchAll(/[A-Z][a-z]+[A-Z]?[a-z]*/g);
    for (const match of camelMatches) {
      if (match[0].length > 2) symbols.push(match[0]);
    }

    // snake_case symbols
    const snakeMatches = query.matchAll(/\b[a-z]+_[a-z_]+\b/g);
    for (const match of snakeMatches) {
      symbols.push(match[0]);
    }

    // Quoted strings (often symbol names)
    const quoteMatches = query.matchAll(/['"`]([A-Za-z][A-Za-z0-9_]*)['"`]/g);
    for (const match of quoteMatches) {
      symbols.push(match[1]);
    }

    return [...new Set(symbols)].slice(0, 10);
  }

  // ============ PHASE 2: SEARCH PLANNING ============

  private async createSearchPlan(analysis: {
    intent: string;
    keywords: string[];
    symbols: string[];
  }): Promise<SearchPlan> {
    const strategies: SearchStrategy[] = [];

    // Strategy 1: Semantic search with primary keywords
    if (analysis.keywords.length > 0) {
      strategies.push({
        type: 'semantic',
        query: analysis.keywords.join(' '),
        priority: 1,
      });
    }

    // Strategy 2: Symbol search
    for (const symbol of analysis.symbols.slice(0, 3)) {
      strategies.push({
        type: 'symbol',
        query: symbol,
        priority: 2,
      });
    }

    // Strategy 3: Reference search
    for (const symbol of analysis.symbols.slice(0, 2)) {
      strategies.push({
        type: 'reference',
        query: symbol,
        priority: 3,
      });
    }

    // Strategy 4: Text search for exact matches
    if (analysis.keywords.length > 0) {
      strategies.push({
        type: 'text',
        query: analysis.keywords[0],
        priority: 4,
      });
    }

    // Determine file types based on keywords
    const fileTypes = this.inferFileTypes(analysis.keywords);

    return {
      intent: analysis.intent as any,
      keywords: analysis.keywords,
      symbols: analysis.symbols,
      fileTypes,
      strategies,
    };
  }

  private inferFileTypes(keywords: string[]): string[] {
    const types: string[] = [];

    const keywordToType: Record<string, string[]> = {
      'api': ['.ts', '.controller.ts', 'routes'],
      'auth': ['.ts', 'auth', 'middleware'],
      'database': ['.ts', 'repository', 'entity', 'migration'],
      'config': ['.ts', '.json', '.yaml', '.env'],
      'test': ['.spec.ts', '.test.ts', 'test'],
      'component': ['.tsx', '.vue', '.svelte'],
      'style': ['.css', '.scss', '.less', '.module.css'],
    };

    for (const keyword of keywords) {
      const matchingTypes = keywordToType[keyword.toLowerCase()];
      if (matchingTypes) {
        types.push(...matchingTypes);
      }
    }

    return [...new Set(types)].slice(0, 5);
  }

  // ============ PHASE 3: STRATEGY EXECUTION ============

  private async executeSearchStrategies(
    repoName: string,
    plan: SearchPlan
  ): Promise<SearchResult[]> {
    const allResults: SearchResult[] = [];
    const seenChunks = new Set<string>();

    for (const strategy of plan.strategies) {
      let results: SearchResult[] = [];

      switch (strategy.type) {
        case 'semantic':
          results = await this.semanticService.semanticSearch(repoName, strategy.query, 15);
          break;

        case 'symbol':
          const symbolChunks = this.semanticService.searchBySymbol(repoName, strategy.query);
          results = symbolChunks.map(chunk => ({
            chunk,
            score: 0.8,
            reason: `Symbol match: ${strategy.query}`,
          }));
          break;

        case 'reference':
          const refChunks = this.semanticService.findCallers(repoName, strategy.query);
          results = refChunks.map(chunk => ({
            chunk,
            score: 0.6,
            reason: `References ${strategy.query}`,
          }));
          break;

        case 'text':
          // Fall back to basic text search if semantic fails
          results = await this.semanticService.semanticSearch(repoName, strategy.query, 10);
          break;
      }

      // Deduplicate
      for (const result of results) {
        if (!seenChunks.has(result.chunk.id)) {
          seenChunks.add(result.chunk.id);
          allResults.push(result);
        }
      }
    }

    return allResults;
  }

  // ============ PHASE 4: CONTEXT ENRICHMENT ============

  private async enrichWithContext(
    repoName: string,
    results: SearchResult[]
  ): Promise<SearchResult[]> {
    // Add related chunks (same file, nearby lines)
    const enriched: SearchResult[] = [];

    for (const result of results) {
      const relatedChunks: SemanticChunk[] = [];

      // Find chunks in the same file
      const sameFileChunks = this.getRelatedChunks(repoName, result.chunk.filePath, result.chunk.symbols);

      result.chunk.references = [...new Set([...result.chunk.references, ...sameFileChunks.flatMap(c => c.symbols)])];

      enriched.push(result);
    }

    return enriched;
  }

  private getRelatedChunks(
    repoName: string,
    filePath: string,
    symbols: string[]
  ): SemanticChunk[] {
    const related: SemanticChunk[] = [];

    // Get other chunks in the same file
    const repoIndex = (this.semanticService as any).semanticIndex.get(repoName);
    if (repoIndex) {
      for (const chunk of repoIndex.values()) {
        if (chunk.filePath === filePath && !symbols.some(s => chunk.symbols.includes(s))) {
          related.push(chunk);
        }
      }
    }

    return related.slice(0, 5);
  }

  // ============ PHASE 5: REASONING ============

  private async reasonAboutResults(
    query: string,
    results: SearchResult[],
    plan: SearchPlan
  ): Promise<{ summary: string; confidence: 'high' | 'medium' | 'low'; gaps: string[] }> {
    if (results.length === 0) {
      return {
        summary: 'No relevant code found for the query',
        confidence: 'low',
        gaps: ['Insufficient code matches'],
      };
    }

    const topScore = results[0]?.score || 0;

    if (topScore > 0.8 && results.length >= 3) {
      return {
        summary: `Found ${results.length} highly relevant code sections with strong matches`,
        confidence: 'high',
        gaps: [],
      };
    }

    if (topScore > 0.5 && results.length >= 2) {
      return {
        summary: `Found ${results.length} moderately relevant code sections`,
        confidence: 'medium',
        gaps: results.length < 5 ? ['May need more context'] : [],
      };
    }

    return {
      summary: `Found ${results.length} weak matches - results may be incomplete`,
      confidence: 'low',
      gaps: ['Low confidence matches', 'Consider refining search query'],
    };
  }

  // ============ PHASE 6: RESPONSE GENERATION ============

  private async generateResponse(
    query: string,
    results: SearchResult[],
    reasoning: { summary: string; confidence: string; gaps: string[] },
    plan: SearchPlan
  ): Promise<string> {
    if (results.length === 0) {
      return `I couldn't find any code matching "${query}".

**Suggestions:**
- Try using specific technical terms (e.g., "authentication middleware" instead of "login code")
- Search for symbol names if you know them
- Use file type hints (e.g., "config", "controller", "test")`;
    }

    let response = `${reasoning.summary}\n\n`;

    // Group by file
    const byFile = new Map<string, SearchResult[]>();
    for (const result of results.slice(0, 10)) {
      if (!byFile.has(result.chunk.filePath)) {
        byFile.set(result.chunk.filePath, []);
      }
      byFile.get(result.chunk.filePath)!.push(result);
    }

    response += `**Found in ${byFile.size} file(s):**\n\n`;

    for (const [filePath, fileResults] of byFile) {
      const topResult = fileResults[0];
      response += `📄 \`${filePath}\`\n`;
      response += `   Lines ${topResult.chunk.startLine}-${topResult.chunk.endLine}\n`;
      response += `   ${topResult.chunk.summary}\n`;
      response += `   _Match: ${topResult.reason}_\n\n`;
    }

    if (reasoning.gaps.length > 0) {
      response += `**Note:** ${reasoning.gaps.join('. ')}\n\n`;
    }

    return response.trim();
  }

  // ============ NAVIGATION SUGGESTIONS ============

  private generateNavigationSuggestions(
    repoName: string,
    results: SearchResult[],
    plan: SearchPlan
  ): NavigationSuggestion[] {
    const suggestions: NavigationSuggestion[] = [];

    for (const result of results.slice(0, 5)) {
      // Suggest definition navigation
      for (const symbol of result.chunk.symbols.slice(0, 2)) {
        const definitions = this.semanticService.findDefinitions(repoName, symbol);
        if (definitions.length > 0) {
          suggestions.push({
            type: 'definition',
            label: `Go to definition: ${symbol}`,
            chunk: definitions[0],
          });
        }
      }

      // Suggest caller navigation
      for (const symbol of result.chunk.symbols.slice(0, 2)) {
        const callers = this.semanticService.findCallers(repoName, symbol);
        if (callers.length > 0) {
          suggestions.push({
            type: 'callers',
            label: `Show callers of ${symbol}`,
            chunk: callers[0],
          });
        }
      }
    }

    return suggestions;
  }

  // ============ STREAMING SEARCH ============

  async *searchStream(
    repoName: string,
    query: string,
    context?: { line?: number; filePath?: string }
  ): AsyncGenerator<{ phase: string; data: any }> {
    yield { phase: 'start', data: { message: 'Starting intelligent code search...' } };

    // Phase 1: Analyze
    yield { phase: 'analyzing', data: { message: `Analyzing query: "${query}"...` } };
    const analysis = await this.analyzeQuery(query, context || {});
    yield {
      phase: 'analyzed',
      data: {
        intent: analysis.intent,
        keywords: analysis.keywords,
        symbols: analysis.symbols,
      },
    };

    // Phase 2: Plan
    yield { phase: 'planning', data: { message: 'Creating search strategy...' } };
    const plan = await this.createSearchPlan(analysis);
    yield {
      phase: 'planned',
      data: {
        strategies: plan.strategies.map(s => `${s.type}:${s.query}`),
        fileTypes: plan.fileTypes,
      },
    };

    // Phase 3: Search
    const allResults: SearchResult[] = [];
    const seenChunks = new Set<string>();

    for (const strategy of plan.strategies) {
      yield { phase: 'searching', data: { message: `Searching (${strategy.type}): ${strategy.query}...` } };

      let results: SearchResult[] = [];

      switch (strategy.type) {
        case 'semantic':
          results = await this.semanticService.semanticSearch(repoName, strategy.query, 15);
          break;
        case 'symbol':
          const symbolChunks = this.semanticService.searchBySymbol(repoName, strategy.query);
          results = symbolChunks.map(chunk => ({ chunk, score: 0.8, reason: `Symbol: ${strategy.query}` }));
          break;
        case 'reference':
          const refChunks = this.semanticService.findCallers(repoName, strategy.query);
          results = refChunks.map(chunk => ({ chunk, score: 0.6, reason: `References: ${strategy.query}` }));
          break;
        default:
          results = await this.semanticService.semanticSearch(repoName, strategy.query, 10);
      }

      for (const result of results) {
        if (!seenChunks.has(result.chunk.id)) {
          seenChunks.add(result.chunk.id);
          allResults.push(result);
          if (allResults.length <= 5) {
            yield {
              phase: 'found',
              data: {
                file: result.chunk.filePath,
                line: result.chunk.startLine,
                summary: result.chunk.summary,
              },
            };
          }
        }
      }
    }

    yield { phase: 'retrieved', data: { count: allResults.length } };

    // Phase 4: Reason
    const reasoning = await this.reasonAboutResults(query, allResults, plan);
    yield {
      phase: 'reasoning',
      data: {
        summary: reasoning.summary,
        confidence: reasoning.confidence,
      },
    };

    // Phase 5: Respond
    const response = await this.generateResponse(query, allResults, reasoning, plan);
    const navigation = this.generateNavigationSuggestions(repoName, allResults, plan);

    yield {
      phase: 'complete',
      data: {
        response,
        results: allResults.slice(0, 10),
        navigation,
        confidence: reasoning.confidence,
      },
    };
  }
}
