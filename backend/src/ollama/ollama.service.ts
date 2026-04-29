import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Ollama } from 'ollama';
import { GitService } from '../git/git.service';
import * as path from 'path';
import * as fs from 'fs';
import { Observable } from 'rxjs';

export interface CodeChunk {
  repoName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  embedding?: number[];
  score?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  codeReferences?: { filePath: string; startLine: number; endLine: number; content: string }[];
}

export interface SearchProgress {
  type: 'start' | 'file' | 'match' | 'complete' | 'suggestion';
  message: string;
  file?: string;
  matches?: number;
  suggestions?: string[];
}

@Injectable()
export class OllamaService implements OnModuleInit {
  private readonly logger = new Logger(OllamaService.name);
  private client: Ollama;
  private readonly model = process.env.OLLAMA_MODEL || 'codellama:7b-instruct';
  private readonly embeddingModel = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
  private codeIndex = new Map<string, CodeChunk[]>();
  private isIndexing = new Map<string, boolean>();
  private ollamaAvailable = false;
  // Cache search results by query for 2 minutes to avoid repeated heavy searches
  private searchCache = new Map<string, { results: CodeChunk[]; timestamp: number }>();
  private readonly CACHE_TTL = 120000; // 2 minutes
  private readonly cacheDir = path.join(process.cwd(), '.cache');

  constructor(private readonly gitService: GitService) {
    this.client = new Ollama({ host: 'http://localhost:11434' });
  }

  async onModuleInit() {
    try {
      await this.client.list();
      this.logger.log('Ollama connection established');
      this.ollamaAvailable = true;
      this.indexAllRepos();
    } catch (error) {
      this.logger.warn(`Ollama not available: ${error.message}. AI features will be disabled.`);
      this.ollamaAvailable = false;
    }

    // Load search cache from disk
    this.loadSearchCache();

    // Save cache periodically every minute
    setInterval(() => this.saveSearchCache(), 60000);
  }

  isOllamaAvailable(): boolean {
    return this.ollamaAvailable;
  }

  private async indexAllRepos() {
    const repos = this.gitService.getClonedRepos();
    for (const repo of repos) {
      await this.indexRepository(repo);
    }
  }

  async indexRepository(repoName: string): Promise<void> {
    if (this.isIndexing.get(repoName)) return;
    this.isIndexing.set(repoName, true);

    try {
      const chunks: CodeChunk[] = [];
      const files = this.gitService.getAllFilesRecursive(repoName);

      for (const file of files) {
        const content = this.gitService.getFileContent(repoName, file.path);
        if (!content) continue;

        const lines = content.split('\n');
        const chunkSize = 50;

        for (let i = 0; i < lines.length; i += chunkSize) {
          const chunkLines = lines.slice(i, i + chunkSize);
          if (chunkLines.length < 5) continue;

          const chunk: CodeChunk = {
            repoName,
            filePath: file.path,
            startLine: i + 1,
            endLine: Math.min(i + chunkSize, lines.length),
            content: chunkLines.join('\n'),
          };

          try {
            const embedding = await this.generateEmbedding(chunk.content);
            chunk.embedding = embedding;
            chunks.push(chunk);
          } catch (err) {
            this.logger.debug(`Failed to embed chunk: ${file.path}:${i}`);
          }
        }
      }

      this.codeIndex.set(repoName, chunks);
      this.logger.log(`Indexed ${chunks.length} chunks from ${repoName}`);
    } catch (error) {
      this.logger.error(`Failed to index ${repoName}: ${error.message}`);
    } finally {
      this.isIndexing.set(repoName, false);
    }
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.client.embed({
      model: this.embeddingModel,
      input: text,
    });
    return response.embeddings[0] || [];
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dot / (magA * magB);
  }

  // Extract keywords from query using AI or heuristic analysis
  private extractKeywords(query: string): string[] {
    // Remove common programming stop words and extract meaningful terms
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while', 'although', 'though', 'after', 'before', 'when', 'whenever', 'where', 'wherever', 'whether', 'which', 'that', 'this', 'these', 'those', 'what', 'whatever', 'who', 'whom', 'whose', 'show', 'me', 'find', 'get', 'tell', 'explain', 'give']);

    // Extract potential keywords
    const words = query.toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));

    // Also extract compound terms (camelCase, snake_case, kebab-case)
    const compounds = query.match(/[a-z]+[A-Z][a-z]+|[a-z]+_[a-z]+|[a-z]+-[a-z]+/gi) || [];
    const compoundParts = compounds.flatMap(c => {
      if (c.includes('_') || c.includes('-')) {
        return c.split(/[_-]/);
      }
      return c;
    });

    // Combine and deduplicate
    const allKeywords = [...new Set([...words, ...compoundParts.map(p => p.toLowerCase())])];

    // Prioritize technical terms
    const technicalTerms = allKeywords.filter(w =>
      /^(api|route|controller|service|repository|model|entity|dto|auth|token|session|database|db|sql|query|endpoint|http|rest|graphql|config|env|middleware|guard|interceptor|pipe|module|component|directive|injectable|observable|promise|async|await|interface|class|function|method|property|variable|constant|export|import|require|module|package|json|yaml|xml|html|css|scss|less|typescript|javascript|python|java|go|rust|php|ruby|perl|shell|bash|git|docker|kubernetes|aws|azure|gcp|firebase|mongodb|postgres|mysql|redis|elastic|kafka|rabbitmq|nginx|apache|server|client|browser|node|npm|yarn|webpack|vite|rollup|babel|eslint|prettier|jest|mocha|chai|cypress|playwright|puppeteer|testing|unit|integration|e2e|ci|cd|deploy|build|compile|transpile|bundle|minify|optimize|cache|memory|cpu|gpu|thread|process|async|sync|blocking|nonblocking|stream|buffer|pipe|socket|tcp|udp|http|https|ws|wss|ftp|ssh|ssl|tls|encryption|hash|salt|token|jwt|oauth|saml|sso|ldap|active|directory|user|role|permission|access|control|policy|rule|validation|sanitization|xss|csrf|injection|attack|security|vulnerability|exploit|patch|update|upgrade|migrate|backup|restore|snapshot|clone|fork|branch|merge|rebase|commit|push|pull|fetch|remote|origin|upstream|downstream|pipeline|workflow|action|trigger|event|listener|observer|subscriber|publisher|message|queue|topic|subscription|notification|alert|log|trace|debug|info|warn|error|fatal|audit|monitor|metric|dashboard|report|analytics|telemetry|instrument|probe|health|status|ready|live|check|test|mock|stub|fake|spy|fixture|sandbox|staging|production|development|testing|environment|configuration|setting|option|flag|feature|toggle|experiment|ab|test|canary|blue|green|deploy|release|version|tag|label|annotation|metadata|schema|migration|seed|fixture|factory|builder|constructor|initializer|destroyer|cleanup|teardown|setup|bootstrap|startup|shutdown|restart|reload|refresh|invalidate|clear|reset|default|null|undefined|void|any|never|unknown|object|array|map|set|weakmap|weakset|symbol|bigint|number|string|boolean|date|regexp|error|promise|generator|async|iterator|iterable|proxy|reflect|math|json|parse|stringify|serialize|deserialize|encode|decode|encrypt|decrypt|sign|verify|hash|digest|random|uuid|nanoid|slug|normalize|trim|pad|slice|splice|split|join|concat|flat|flatMap|reduce|map|filter|find|findindex|some|every|includes|entries|keys|values|foreach|sort|reverse|copywithin|fill|at|tolocalestring|tostring|valueof|isprototypeof|defineproperty|defineproperties|getownpropertydescriptor|getownpropertydescriptors|getprototypeof|setprototypeof|preventextensions|seal|freeze|isfrozen|issealed|isextensible|assign|create|from|of|parse|stringify|is|isnan|isfinite|isinteger|issafeinteger|parsefloat|parseint|max|min|abs|round|ceil|floor|trunc|sign|copysign|abs|exp|expm1|log|log1p|log10|log2|sqrt|cbrt|square|pow|hypot|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|hypot|pi|e|ln2|ln10|log2e|log10e|sqrt1_2|sqrt2|clz32|imul|fround|random)/.test(w)
    );

    // Return technical terms first, then other keywords
    const others = allKeywords.filter(w => !technicalTerms.includes(w));
    return [...technicalTerms, ...others].slice(0, 10); // Limit to 10 keywords
  }

  // Analyze query intent using AI (when Ollama is available)
  async analyzeQueryIntent(query: string): Promise<{ keywords: string[]; intent: string; suggestions: string[] }> {
    if (!this.ollamaAvailable) {
      // Fallback to heuristic analysis
      const keywords = this.extractKeywords(query);
      return {
        keywords,
        intent: 'search',
        suggestions: this.generateSuggestions(keywords),
      };
    }

    try {
      const response = await this.client.chat({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are a code search assistant. Analyze the user's query and extract:
1. Keywords: Important technical terms to search for (max 5)
2. Intent: What the user is trying to find (one word: "implementation", "definition", "usage", "configuration", "structure", "pattern")
3. Suggestions: Alternative search terms or related concepts if initial search fails (max 3)

Respond in JSON format: {"keywords": ["term1", "term2"], "intent": "implementation", "suggestions": ["alt1", "alt2"]}`,
          },
          { role: 'user', content: query },
        ],
        stream: false,
      });

      const content = response.message.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          keywords: parsed.keywords || this.extractKeywords(query),
          intent: parsed.intent || 'search',
          suggestions: parsed.suggestions || [],
        };
      }
    } catch (err) {
      this.logger.debug(`Query analysis failed: ${err.message}, using fallback`);
    }

    // Fallback
    const keywords = this.extractKeywords(query);
    return {
      keywords,
      intent: 'search',
      suggestions: this.generateSuggestions(keywords),
    };
  }


  // Multi-keyword search with scoring
  async enhancedTextSearch(repoName: string, query: string, limit: number): Promise<CodeChunk[]> {
    // Check cache first
    const cacheKey = `${repoName}:${query.toLowerCase()}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return cached.results;
    }

    const startTime = Date.now();
    this.logger.log(`Search: "${query}" in ${repoName}`);

    // Extract multiple keywords
    const keywords = this.extractKeywords(query);
    const primaryKeyword = keywords[0] || query;

    // Search with primary keyword
    const results = this.gitService.searchInRepo(repoName, primaryKeyword, limit * 2);

    // Score results based on additional keyword matches
    const scoredResults = results.map(r => {
      let score = 1;
      const contentLower = r.content.toLowerCase();
      for (const keyword of keywords.slice(1)) {
        if (contentLower.includes(keyword.toLowerCase())) {
          score += 0.5;
        }
      }
      return {
        repoName,
        filePath: r.filePath,
        startLine: r.line,
        endLine: r.line + 5,
        content: r.content,
        score,
      };
    });

    // Sort by score and limit
    const finalResults = scoredResults
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // Cache results
    this.searchCache.set(cacheKey, { results: finalResults, timestamp: Date.now() });
    const elapsed = Date.now() - startTime;
    this.logger.log(`Search completed in ${elapsed}ms, found ${finalResults.length} results`);

    return finalResults;
  }

  // Instant keyword extraction (no LLM overhead)
  private extractKeywordsFast(query: string): string[] {
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while', 'although', 'though', 'which', 'that', 'this', 'these', 'those', 'what', 'who', 'whom', 'whose', 'show', 'me', 'find', 'get', 'tell', 'explain', 'give', 'looking', 'want', 'need', 'search', 'code', 'make', 'using', 'use']);

    const words = query
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()));

    // Extract compound terms (camelCase, snake_case)
    const compounds = query.match(/[a-z]+[A-Z][a-z]+|[a-z]+_[a-z]+/g) || [];
    const compoundParts = compounds.flatMap(c => c.includes('_') ? c.split('_') : c.match(/[A-Z]?[a-z]+/g) || []);

    return [...new Set([...words, ...compoundParts.map(p => p.toLowerCase())])].slice(0, 8);
  }

  // Streaming search with CURSOR-LIKE progress updates
  async *searchWithProgress(repoName: string, query: string, limit: number): AsyncGenerator<SearchProgress, CodeChunk[], unknown> {
    const startTime = Date.now();

    // INSTANT keyword extraction (no LLM call - saves 30-60 seconds)
    const keywords = this.extractKeywordsFast(query);
    const primaryKeyword = keywords[0] || query;

    yield { type: 'start', message: `Extracted keywords: ${keywords.join(', ')}` };

    // Get files to search
    const files = this.gitService.getAllFilesRecursive(repoName);
    const priorityExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java', '.rs', '.php', '.rb'];
    const sortedFiles = [...files].sort((a, b) => {
      const extA = path.extname(a.path);
      const extB = path.extname(b.path);
      const aPriority = priorityExtensions.includes(extA) ? 0 : 1;
      const bPriority = priorityExtensions.includes(extB) ? 0 : 1;
      return aPriority - bPriority;
    });

    yield { type: 'start', message: `Searching ${sortedFiles.length} files (prioritizing code files)...` };

    const allMatches: CodeChunk[] = [];
    let filesSearched = 0;
    const totalFiles = sortedFiles.length;

    // Search file by file with GRANULAR progress updates
    for (const file of sortedFiles) {
      const content = this.gitService.getFileContent(repoName, file.path);
      if (!content) continue;

      filesSearched++;

      // Yield for EVERY file searched (Cursor-like detail)
      yield {
        type: 'file',
        message: `Searching ${file.path}`,
        file: file.path,
        matches: allMatches.length,
      };

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineLower = line.toLowerCase();

        // Check if line matches any keyword
        const matchedKeywords = keywords.filter(k => lineLower.includes(k.toLowerCase()));
        if (matchedKeywords.length > 0) {
          const matchPreview = line.trim().slice(0, 100);
          allMatches.push({
            repoName,
            filePath: file.path,
            startLine: i + 1,
            endLine: i + 6,
            content: lines.slice(i, i + 6).join('\n'),
            score: matchedKeywords.length,
          });

          // Yield for EVERY match found with preview (Cursor-like)
          yield {
            type: 'match',
            message: `Match in ${file.path}:${i + 1}`,
            file: file.path,
            matches: allMatches.length,
          };

          if (allMatches.length >= limit) break;
        }
      }

      if (allMatches.length >= limit) {
        yield { type: 'start', message: `Found ${limit} matches, stopping search...` };
        break;
      }
    }

    const elapsed = Date.now() - startTime;
    yield {
      type: 'complete',
      message: `Search completed in ${elapsed}ms. Found ${allMatches.length} matches across ${filesSearched} files.`,
      matches: allMatches.length
    };

    // If no results, provide suggestions
    if (allMatches.length === 0) {
      const suggestions = this.generateSuggestions(keywords);
      yield { type: 'suggestion', message: 'No matches found. Try:', suggestions };
    }

    return allMatches;
  }

  // Fast suggestions generator (no LLM)
  private generateSuggestions(keywords: string[]): string[] {
    const suggestionMap: Record<string, string[]> = {
      'api': ['endpoint', 'route', 'controller', 'handler', 'rest'],
      'auth': ['authentication', 'authorization', 'login', 'token', 'session', 'jwt', 'oauth', 'guard'],
      'database': ['connection', 'query', 'model', 'repository', 'migration', 'schema', 'db'],
      'config': ['environment', 'settings', 'options', 'defaults', 'configuration'],
      'error': ['exception', 'handling', 'try', 'catch', 'throw', 'error'],
      'file': ['upload', 'download', 'storage', 'stream', 'fs'],
      'user': ['account', 'profile', 'registration', 'login', 'member'],
      'search': ['filter', 'query', 'index', 'find', 'lookup'],
      'cache': ['redis', 'memory', 'storage', 'invalidation', 'caching'],
      'test': ['spec', 'unit', 'integration', 'mock', 'fixture', 'testing'],
    };

    const suggestions = new Set<string>();
    for (const keyword of keywords) {
      const related = suggestionMap[keyword.toLowerCase()];
      if (related) {
        related.forEach(s => suggestions.add(s));
      }
    }

    return Array.from(suggestions).slice(0, 5);
  }

  // Load search cache from disk
  private loadSearchCache(): void {
    try {
      const cacheFile = path.join(this.cacheDir, 'search-cache.json');
      if (fs.existsSync(cacheFile)) {
        const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        const now = Date.now();

        for (const [key, entry] of Object.entries(data as Record<string, { results: CodeChunk[]; timestamp: number }>)) {
          if (now - entry.timestamp < this.CACHE_TTL) {
            this.searchCache.set(key, entry);
          }
        }

        this.logger.log(`Loaded ${this.searchCache.size} cached search results`);
      }
    } catch (err) {
      this.logger.debug(`Could not load search cache: ${err.message}`);
    }
  }

  // Save search cache to disk
  private saveSearchCache(): void {
    try {
      const cacheFile = path.join(this.cacheDir, 'search-cache.json');
      const data: Record<string, { results: CodeChunk[]; timestamp: number }> = {};
      const now = Date.now();

      for (const [key, value] of this.searchCache.entries()) {
        if (now - value.timestamp < this.CACHE_TTL) {
          data[key] = value;
        }
      }

      fs.writeFileSync(cacheFile, JSON.stringify(data), 'utf-8');
    } catch (err) {
      this.logger.debug(`Could not save search cache: ${err.message}`);
    }
  }

  // Generate clean, concise structured response
  private generateTextBasedResponse(query: string, results: CodeChunk[]): string {
    if (results.length === 0) {
      return `No results found for "${query}".\n\nTry using specific technical terms like function names, class names, or file types.`;
    }

    // Group results by file
    const byFile = new Map<string, CodeChunk[]>();
    for (const r of results) {
      if (!byFile.has(r.filePath)) {
        byFile.set(r.filePath, []);
      }
      byFile.get(r.filePath)!.push(r);
    }

    // Build concise response
    let response = `Found **${results.length}** matches in **${byFile.size}** files:\n\n`;

    for (const [filePath, chunks] of byFile.entries()) {
      const first = chunks[0];
      const last = chunks[chunks.length - 1];

      response += `**${filePath}**\n`;

      if (chunks.length > 1) {
        response += `  ${chunks.length} matches (lines ${first.startLine}–${last.endLine})\n`;
      } else {
        response += `  Line ${first.startLine}\n`;
      }

      // Show brief code preview
      const previewLines = first.content.split('\n').slice(0, 3);
      response += '```\n' + previewLines.join('\n');
      if (first.content.split('\n').length > 3) {
        response += '\n...';
      }
      response += '\n```\n\n';
    }

    return response;
  }

  async searchRelevantCode(repoName: string, query: string, limit = 5): Promise<CodeChunk[]> {
    const repoChunks = this.codeIndex.get(repoName) || [];
    if (repoChunks.length === 0) return [];

    try {
      const queryEmbedding = await this.generateEmbedding(query);
      const scored = repoChunks.map(chunk => ({
        chunk,
        score: this.cosineSimilarity(queryEmbedding, chunk.embedding || []),
      }));

      return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(s => s.chunk);
    } catch {
      return repoChunks.slice(0, limit);
    }
  }

  async chat(repoName: string, messages: ChatMessage[]): Promise<{ response: string; codeReferences: CodeChunk[]; ollamaAvailable: boolean }> {
    const lastMessage = messages[messages.length - 1];
    const query = lastMessage.content;

    this.logger.log(`Chat request for ${repoName}: "${query}"`);

    // Check if this is a general question (greeting, help request, etc.)
    if (this.isGeneralQuestion(query)) {
      const response = await this.generateGeneralResponse(query);
      return {
        response,
        codeReferences: [],
        ollamaAvailable: this.ollamaAvailable,
      };
    }

    // Analyze query intent
    const analysis = await this.analyzeQueryIntent(query);
    this.logger.log(`Query analysis: keywords=[${analysis.keywords.join(', ')}], intent=${analysis.intent}`);

    // Multi-keyword search with scoring
    const relevantCode = await this.enhancedTextSearch(repoName, query, 15);
    this.logger.log(`Search found ${relevantCode.length} results`);

    // Generate intelligent response
    if (relevantCode.length === 0) {
      let response = `I couldn't find any code matching "${query}" in ${repoName}.\n\n`;

      if (analysis.suggestions.length > 0) {
        response += `**Try searching for:**\n`;
        response += analysis.suggestions.map(s => `- ${s}`).join('\n');
        response += `\n\n`;
      }

      response += `**Tips:**\n`;
      response += `- Use specific technical terms (e.g., "authentication" instead of "login system")\n`;
      response += `- Search for file types (e.g., "config", "routes", "controllers")\n`;
      response += `- Use keywords from error messages or function names\n`;

      return {
        response,
        codeReferences: [],
        ollamaAvailable: this.ollamaAvailable,
      };
    }

    // Build intelligent response with context
    const seen = new Set<string>();
    let response = `Found ${relevantCode.length} relevant code sections:\n\n`;

    // Group by file
    const byFile = new Map<string, CodeChunk[]>();
    for (const chunk of relevantCode) {
      if (!byFile.has(chunk.filePath)) {
        byFile.set(chunk.filePath, []);
      }
      byFile.get(chunk.filePath)!.push(chunk);
    }

    for (const [filePath, chunks] of byFile) {
      const firstChunk = chunks[0];
      const key = `${filePath}:${firstChunk.startLine}`;
      if (!seen.has(key)) {
        seen.add(key);
        response += `**${filePath}** (lines ${firstChunk.startLine}-${firstChunk.endLine})\n`;
        if (chunks.length > 1) {
          response += `  _${chunks.length} matches in this file_\n`;
        }
      }
    }

    return {
      response,
      codeReferences: relevantCode.map(c => ({
        repoName: c.repoName,
        filePath: c.filePath,
        startLine: c.startLine,
        endLine: c.endLine,
        content: c.content,
      })),
      ollamaAvailable: this.ollamaAvailable,
    };
  }

  // Check if query is a general question (not code search)
  private isGeneralQuestion(query: string): boolean {
    const lowerQuery = query.toLowerCase().trim();

    // Greetings
    const greetings = ['hi', 'hello', 'hey', 'greetings', 'good morning', 'good afternoon', 'good evening'];
    if (greetings.some(g => lowerQuery === g || lowerQuery.startsWith(g + ' ') || lowerQuery.startsWith(g + ','))) {
      return true;
    }

    // General questions
    const generalPatterns = [
      /^how are you/,
      /^what('s| is) (your|the) name/,
      /^who (are you|created you)/,
      /^what can you do/,
      /^help me/,
      /^thank/,
      /^thanks/,
      /^bye/,
      /^goodbye/,
    ];

    return generalPatterns.some(pattern => pattern.test(lowerQuery));
  }

  // Generate AI response for general questions
  private async generateGeneralResponse(query: string): Promise<string> {
    const systemPrompt = `You are a friendly and helpful AI code search assistant integrated into a repository analysis tool. Your capabilities include:

1. **Code Search**: Find code snippets, functions, classes, and patterns across repositories
2. **File Navigation**: Browse and explore repository file structures
3. **Code Analysis**: Understand code relationships, callers, callees, and definitions
4. **Semantic Search**: Find code by meaning, not just keywords

When responding to greetings or general questions:
- Be warm and conversational
- Briefly mention your code search capabilities
- Offer to help with repository exploration
- Keep responses concise (2-4 sentences)

Do NOT attempt to search for code when the user is just greeting you or asking general questions.`;

    try {
      const response = await this.client.chat({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query },
        ],
        stream: false,
      });

      return response.message.content;
    } catch (err) {
      this.logger.warn(`General response generation failed: ${err.message}`);
      return this.getFallbackGeneralResponse(query);
    }
  }

  // Fallback responses when LLM is unavailable
  private getFallbackGeneralResponse(query: string): string {
    const lowerQuery = query.toLowerCase().trim();

    if (['hi', 'hello', 'hey', 'greetings'].some(g => lowerQuery.startsWith(g))) {
      return `Hello! 👋 I'm your AI code search assistant. I can help you explore repositories, find code snippets, understand code relationships, and navigate file structures. What would you like to search for today?`;
    }

    if (lowerQuery.includes('how are you')) {
      return `I'm doing great, thank you for asking! I'm ready to help you search through your code repositories. Is there a specific file, function, or code pattern you're looking for?`;
    }

    if (lowerQuery.includes('what can you do') || lowerQuery.includes('help')) {
      return `I specialize in code search and repository exploration! Here's what I can help you with:\n\n**Search & Discovery**\n- Find code by keywords or patterns\n- Search across multiple repositories\n- Locate function definitions and usages\n\n**Navigation**\n- Browse repository file structures\n- Jump to specific files and lines\n- Explore code relationships (callers/callees)\n\n**Analysis**\n- Understand code context\n- Find related code patterns\n- Get semantic search results\n\nJust type your search query or select a repository to get started!`;
    }

    if (lowerQuery.includes('thank')) {
      return `You're welcome! Feel free to ask if you need help finding any code or exploring your repositories. Happy coding!`;
    }

    return `Hello! I'm your AI code search assistant. I can help you find code, explore repositories, and understand code relationships. What would you like to search for today?`;
  }

  // Streaming chat with CURSOR-LIKE progress updates
  async *chatStream(repoName: string, messages: ChatMessage[]): AsyncGenerator<{ type: string; data: any }> {
    const lastMessage = messages[messages.length - 1];
    const query = lastMessage.content;
    const startTime = Date.now();

    this.logger.log(`Streaming chat for ${repoName}: "${query}"`);

    // Check if this is a general question (greeting, help request, etc.)
    if (this.isGeneralQuestion(query)) {
      yield { type: 'analyzing', data: { message: 'Processing your message...', step: 1, total: 2 } };

      const response = await this.generateGeneralResponse(query);

      yield { type: 'complete', data: { response, codeReferences: [], time: Date.now() - startTime, matchCount: 0 } };
      return;
    }

    // Step 1: Extract keywords (INSTANT - no LLM)
    yield { type: 'analyzing', data: { message: 'Extracting keywords from query...', step: 1, total: 4 } };
    const keywords = this.extractKeywordsFast(query);
    yield { type: 'analyzed', data: { keywords, time: Date.now() - startTime } };

    // Step 2: Start search
    yield { type: 'searching', data: { message: `Starting search in ${repoName}...`, step: 2, total: 4 } };

    // Step 3: Stream search progress file-by-file
    const allResults = [];
    let matchCount = 0;
    const fileResults = new Map<string, any[]>();

    for await (const progress of this.searchWithProgress(repoName, query, 20)) {
      if (progress.type === 'start') {
        yield { type: 'searching', data: { message: progress.message, step: 2, total: 4 } };
      } else if (progress.type === 'file') {
        // Show EVERY file being searched (Cursor-like)
        yield {
          type: 'searching_file',
          data: {
            file: progress.file,
            message: `Searching ${progress.file}...`,
            matches: progress.matches,
          }
        };
      } else if (progress.type === 'match') {
        matchCount++;
        // Show EVERY match found with file and line (Cursor-like)
        yield {
          type: 'found_match',
          data: {
            file: progress.file,
            line: progress.matches,
            message: `Found match at ${progress.file}`,
            count: matchCount,
          }
        };
      } else if (progress.type === 'complete') {
        yield { type: 'search_complete', data: { message: progress.message, matches: progress.matches, time: Date.now() - startTime } };
      } else if (progress.type === 'suggestion') {
        yield { type: 'suggestion', data: { message: progress.message, suggestions: progress.suggestions } };
      }
    }

    // Step 4: Generate response
    yield { type: 'responding', data: { message: 'Generating response...', step: 4, total: 4 } };

    // Get final cached results
    const relevantCode = await this.enhancedTextSearch(repoName, query, 15);

    const totalTime = Date.now() - startTime;
    yield {
      type: 'complete',
      data: {
        response: this.generateTextBasedResponse(query, relevantCode),
        codeReferences: relevantCode,
        time: totalTime,
        matchCount: relevantCode.length,
      }
    };
  }

  isRepoIndexed(repoName: string): boolean {
    return this.codeIndex.has(repoName);
  }

  getIndexingStatus(repoName: string): { indexing: boolean; indexed: boolean; chunkCount: number } {
    return {
      indexing: this.isIndexing.get(repoName) || false,
      indexed: this.codeIndex.has(repoName),
      chunkCount: (this.codeIndex.get(repoName) || []).length,
    };
  }

  // Navigation helpers for source-level exploration
  getChunkAtLine(repoName: string, filePath: string, line: number): CodeChunk | null {
    const chunks = this.codeIndex.get(repoName) || [];
    for (const chunk of chunks) {
      if (chunk.filePath === filePath && chunk.startLine <= line && chunk.endLine >= line) {
        return chunk;
      }
    }
    return null;
  }

  findDefinitions(repoName: string, symbol: string): CodeChunk[] {
    const chunks = this.codeIndex.get(repoName) || [];
    // Look for symbol definitions (function, class, variable declarations)
    return chunks.filter(chunk => {
      const content = chunk.content;
      const patterns = [
        new RegExp(`function\\s+${symbol}\\s*\\(`),
        new RegExp(`class\\s+${symbol}`),
        new RegExp(`const\\s+${symbol}\\s*=`),
        new RegExp(`export\\s+.*?${symbol}`),
      ];
      return patterns.some(p => p.test(content));
    }).slice(0, 10);
  }

  findCallers(repoName: string, symbol: string): CodeChunk[] {
    const chunks = this.codeIndex.get(repoName) || [];
    // Look for symbol usages (function calls, property access)
    return chunks.filter(chunk => {
      const content = chunk.content;
      return new RegExp(`\\b${symbol}\\s*\\(`).test(content) ||
             new RegExp(`\\.${symbol}\\b`).test(content);
    }).slice(0, 10);
  }

  searchBySymbol(repoName: string, symbol: string): CodeChunk[] {
    const chunks = this.codeIndex.get(repoName) || [];
    // Search for symbol in content
    return chunks.filter(chunk =>
      new RegExp(`\\b${symbol}\\b`).test(chunk.content)
    ).slice(0, 10);
  }
}
