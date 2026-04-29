import { Injectable, Logger } from '@nestjs/common';
import { Ollama } from 'ollama';
import * as path from 'path';
import * as fs from 'fs';

export interface SemanticChunk {
  id: string;
  repoName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  summary: string;
  symbols: string[];
  embedding: number[];
  tags: string[];
  imports: string[];
  references: string[];
}

export interface SearchResult {
  chunk: SemanticChunk;
  score: number;
  reason: string;
}

export interface AgentThought {
  step: string;
  action: string;
  result: string;
  nextSteps: string[];
}

@Injectable()
export class SemanticSearchService {
  private readonly logger = new Logger(SemanticSearchService.name);
  private readonly client: Ollama;
  private readonly embeddingModel = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
  private readonly model = process.env.OLLAMA_MODEL || 'codellama:7b-instruct';

  // Persistent semantic index per repo
  private semanticIndex = new Map<string, Map<string, SemanticChunk>>();
  private symbolIndex = new Map<string, Map<string, SemanticChunk[]>>(); // symbol -> chunks

  // Cache directory
  private readonly cacheDir = path.join(process.cwd(), '.cache', 'semantic');
  private readonly INDEX_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

  constructor() {
    this.client = new Ollama({ host: 'http://localhost:11434' });
    this.ensureCacheDir();
  }

  private ensureCacheDir() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  private getIndexPath(repoName: string): string {
    return path.join(this.cacheDir, `${repoName}-index.json`);
  }

  // ============ INDEXING ============

  async buildSemanticIndex(repoName: string, files: { path: string; content: string }[]): Promise<void> {
    this.logger.log(`Building semantic index for ${repoName} with ${files.length} files...`);

    const repoIndex = new Map<string, SemanticChunk>();
    const repoSymbolIndex = new Map<string, SemanticChunk[]>();
    let chunkId = 0;

    for (const file of files) {
      try {
        const chunks = await this.processFile(repoName, file.path, file.content, chunkId);
        for (const chunk of chunks) {
          repoIndex.set(chunk.id, chunk);

          // Index symbols
          for (const symbol of chunk.symbols) {
            if (!repoSymbolIndex.has(symbol)) {
              repoSymbolIndex.set(symbol, []);
            }
            repoSymbolIndex.get(symbol)!.push(chunk);
          }
        }
        chunkId += chunks.length;
      } catch (err) {
        this.logger.warn(`Failed to process file ${file.path}: ${err.message}`);
      }
    }

    this.semanticIndex.set(repoName, repoIndex);
    this.symbolIndex.set(repoName, repoSymbolIndex);

    // Persist to disk
    await this.saveIndex(repoName);

    this.logger.log(`Indexed ${repoIndex.size} semantic chunks for ${repoName}`);
  }

  private async processFile(
    repoName: string,
    filePath: string,
    content: string,
    startId: number
  ): Promise<SemanticChunk[]> {
    const chunks: SemanticChunk[] = [];
    const lines = content.split('\n');
    const chunkSize = 40; // Smaller chunks for better semantic precision

    // Extract file-level metadata
    const imports = this.extractImports(content, filePath);
    const fileExt = path.extname(filePath);

    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunkLines = lines.slice(i, Math.min(i + chunkSize, lines.length));
      if (chunkLines.length < 3) continue;

      const chunkContent = chunkLines.join('\n');

      // Extract symbols from this chunk
      const symbols = this.extractSymbols(chunkContent, fileExt);

      // Generate summary using LLM
      const summary = await this.generateChunkSummary(chunkContent);

      // Generate embedding
      const embedding = await this.generateEmbedding(chunkContent);

      // Extract references (function calls, class usage, etc.)
      const references = this.extractReferences(chunkContent, fileExt);

      // Generate tags
      const tags = this.generateTags(chunkContent, symbols);

      const chunk: SemanticChunk = {
        id: `${repoName}:${filePath}:${startId + chunks.length}`,
        repoName,
        filePath,
        startLine: i + 1,
        endLine: i + chunkLines.length,
        content: chunkContent,
        summary,
        symbols,
        embedding,
        tags,
        imports,
        references,
      };

      chunks.push(chunk);
    }

    return chunks;
  }

  private extractImports(content: string, filePath: string): string[] {
    const imports: string[] = [];
    const ext = path.extname(filePath);

    if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
      const importMatches = content.matchAll(/import\s+.*?\s+from\s+['"](.+?)['"]/g);
      for (const match of importMatches) {
        imports.push(match[1]);
      }
    } else if (ext === '.py') {
      const importMatches = content.matchAll(/^(?:import|from)\s+(\S+)/gm);
      for (const match of importMatches) {
        imports.push(match[1]);
      }
    }

    return imports.slice(0, 20); // Limit imports
  }

  private extractSymbols(content: string, ext: string): string[] {
    const symbols: string[] = [];

    if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
      // Extract function names
      const funcMatches = content.matchAll(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/g);
      for (const match of funcMatches) {
        symbols.push(match[1]);
      }

      // Extract class names
      const classMatches = content.matchAll(/(?:export\s+)?class\s+(\w+)/g);
      for (const match of classMatches) {
        symbols.push(match[1]);
      }

      // Extract interface/type names
      const interfaceMatches = content.matchAll(/(?:export\s+)?(?:interface|type)\s+(\w+)/g);
      for (const match of interfaceMatches) {
        symbols.push(match[1]);
      }

      // Extract const/function exports
      const exportMatches = content.matchAll(/(?:export\s+)?(?:const|let|var)\s+(\w+)/g);
      for (const match of exportMatches) {
        symbols.push(match[1]);
      }
    } else if (ext === '.py') {
      const funcMatches = content.matchAll(/def\s+(\w+)/g);
      for (const match of funcMatches) {
        symbols.push(match[1]);
      }

      const classMatches = content.matchAll(/class\s+(\w+)/g);
      for (const match of classMatches) {
        symbols.push(match[1]);
      }
    }

    return [...new Set(symbols)].slice(0, 30); // Limit symbols
  }

  private extractReferences(content: string, ext: string): string[] {
    const refs: string[] = [];

    // Extract function calls
    const callMatches = content.matchAll(/\b([a-z][a-zA-Z0-9]*)\s*\(/gi);
    for (const match of callMatches) {
      if (!['if', 'for', 'while', 'switch', 'catch', 'function', 'return'].includes(match[1].toLowerCase())) {
        refs.push(match[1]);
      }
    }

    // Extract property access
    const propMatches = content.matchAll(/\.([a-zA-Z][a-zA-Z0-9]*)/g);
    for (const match of propMatches) {
      refs.push(match[1]);
    }

    return [...new Set(refs)].slice(0, 50);
  }

  private generateTags(content: string, symbols: string[]): string[] {
    const tags: string[] = [];

    // Detect patterns
    if (content.includes('async') || content.includes('await')) tags.push('async');
    if (content.includes('class')) tags.push('class');
    if (content.includes('interface') || content.includes('type')) tags.push('typescript');
    if (content.includes('export')) tags.push('export');
    if (content.includes('import')) tags.push('import');
    if (content.includes('try') && content.includes('catch')) tags.push('error-handling');
    if (content.includes('=>')) tags.push('arrow-function');
    if (content.includes('return')) tags.push('function');

    // Add symbol-based tags
    for (const symbol of symbols.slice(0, 5)) {
      if (symbol.length > 2) {
        tags.push(`symbol:${symbol}`);
      }
    }

    return tags;
  }

  private async generateChunkSummary(content: string): Promise<string> {
    try {
      const response = await this.client.chat({
        model: this.model,
        messages: [{
          role: 'user',
          content: `Summarize this code in 10 words or less, focusing on its purpose:

${content.slice(0, 500)}`,
        }],
        stream: false,
      });

      return response.message.content.trim().slice(0, 100);
    } catch {
      return content.split('\n')[0]?.slice(0, 50) || 'Code chunk';
    }
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.client.embed({
        model: this.embeddingModel,
        input: text.slice(0, 2048), // Limit for embedding model
      });
      return response.embeddings[0] || [];
    } catch (err) {
      this.logger.warn(`Embedding failed: ${err.message}`);
      return new Array(768).fill(0); // Fallback empty embedding
    }
  }

  // ============ PERSISTENCE ============

  private async saveIndex(repoName: string): Promise<void> {
    try {
      const indexPath = this.getIndexPath(repoName);
      const repoIndex = this.semanticIndex.get(repoName);

      if (repoIndex) {
        const data = {
          timestamp: Date.now(),
          chunks: Array.from(repoIndex.values()),
        };
        fs.writeFileSync(indexPath, JSON.stringify(data, null, 2), 'utf-8');
        this.logger.debug(`Saved index to ${indexPath}`);
      }
    } catch (err) {
      this.logger.warn(`Failed to save index: ${err.message}`);
    }
  }

  async loadIndex(repoName: string): Promise<boolean> {
    try {
      const indexPath = this.getIndexPath(repoName);

      if (fs.existsSync(indexPath)) {
        const data = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));

        // Check if index is fresh (within TTL)
        if (Date.now() - data.timestamp > this.INDEX_CACHE_TTL) {
          this.logger.log(`Index for ${repoName} is stale, rebuilding...`);
          return false;
        }

        const repoIndex = new Map<string, SemanticChunk>();
        const repoSymbolIndex = new Map<string, SemanticChunk[]>();

        for (const chunk of data.chunks) {
          repoIndex.set(chunk.id, chunk);

          for (const symbol of chunk.symbols) {
            if (!repoSymbolIndex.has(symbol)) {
              repoSymbolIndex.set(symbol, []);
            }
            repoSymbolIndex.get(symbol)!.push(chunk);
          }
        }

        this.semanticIndex.set(repoName, repoIndex);
        this.symbolIndex.set(repoName, repoSymbolIndex);

        this.logger.log(`Loaded ${repoIndex.size} cached chunks for ${repoName}`);
        return true;
      }
    } catch (err) {
      this.logger.warn(`Failed to load index: ${err.message}`);
    }

    return false;
  }

  // ============ SEMANTIC SEARCH ============

  async semanticSearch(
    repoName: string,
    query: string,
    limit: number = 10
  ): Promise<SearchResult[]> {
    const repoIndex = this.semanticIndex.get(repoName);
    if (!repoIndex || repoIndex.size === 0) {
      return [];
    }

    // Generate query embedding
    const queryEmbedding = await this.generateEmbedding(query);

    // Calculate cosine similarity with all chunks
    const scored: SearchResult[] = [];

    for (const chunk of repoIndex.values()) {
      const score = this.cosineSimilarity(queryEmbedding, chunk.embedding);

      // Also boost by keyword match
      const keywordBoost = this.keywordMatchScore(query, chunk);
      const finalScore = score + keywordBoost;

      if (finalScore > 0.1) { // Threshold
        scored.push({
          chunk,
          score: finalScore,
          reason: this.generateMatchReason(query, chunk, score, keywordBoost),
        });
      }
    }

    // Sort by score and return top results
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0) return 0;

    const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));

    return magA === 0 || magB === 0 ? 0 : dot / (magA * magB);
  }

  private keywordMatchScore(query: string, chunk: SemanticChunk): number {
    const queryLower = query.toLowerCase();
    let score = 0;

    // Check summary match
    if (chunk.summary.toLowerCase().includes(queryLower)) {
      score += 0.3;
    }

    // Check symbol match
    for (const symbol of chunk.symbols) {
      if (symbol.toLowerCase().includes(queryLower)) {
        score += 0.2;
      }
    }

    // Check tags match
    for (const tag of chunk.tags) {
      if (tag.toLowerCase().includes(queryLower)) {
        score += 0.1;
      }
    }

    // Check content match
    if (chunk.content.toLowerCase().includes(queryLower)) {
      score += 0.1;
    }

    return score;
  }

  private generateMatchReason(
    query: string,
    chunk: SemanticChunk,
    semanticScore: number,
    keywordScore: number
  ): string {
    const reasons: string[] = [];

    if (semanticScore > 0.7) {
      reasons.push('High semantic similarity');
    } else if (semanticScore > 0.4) {
      reasons.push('Moderate semantic match');
    }

    if (keywordScore > 0.2) {
      reasons.push('Keyword match in symbols/summary');
    }

    if (chunk.symbols.some(s => s.toLowerCase().includes(query.toLowerCase()))) {
      reasons.push(`Contains symbol: ${chunk.symbols.find(s => s.toLowerCase().includes(query.toLowerCase()))}`);
    }

    return reasons.join('; ') || 'Text match';
  }

  // ============ SYMBOL SEARCH ============

  searchBySymbol(repoName: string, symbol: string): SemanticChunk[] {
    const repoSymbolIndex = this.symbolIndex.get(repoName);
    if (!repoSymbolIndex) return [];

    // Exact match
    const exact = repoSymbolIndex.get(symbol);
    if (exact) return exact;

    // Fuzzy match
    const fuzzy: SemanticChunk[] = [];
    for (const [sym, chunks] of repoSymbolIndex.entries()) {
      if (sym.toLowerCase().includes(symbol.toLowerCase())) {
        fuzzy.push(...chunks);
      }
    }
    return fuzzy.slice(0, 20);
  }

  // ============ NAVIGATION HELPERS ============

  getChunkAtLine(repoName: string, filePath: string, line: number): SemanticChunk | null {
    const repoIndex = this.semanticIndex.get(repoName);
    if (!repoIndex) return null;

    for (const chunk of repoIndex.values()) {
      if (chunk.filePath === filePath &&
          chunk.startLine <= line &&
          chunk.endLine >= line) {
        return chunk;
      }
    }
    return null;
  }

  findCallers(repoName: string, symbol: string): SemanticChunk[] {
    const repoIndex = this.semanticIndex.get(repoName);
    if (!repoIndex) return [];

    const callers: SemanticChunk[] = [];
    for (const chunk of repoIndex.values()) {
      if (chunk.references.includes(symbol)) {
        callers.push(chunk);
      }
    }
    return callers.slice(0, 20);
  }

  findDefinitions(repoName: string, symbol: string): SemanticChunk[] {
    return this.searchBySymbol(repoName, symbol);
  }

  // ============ INDEX INFO ============

  getIndexInfo(repoName: string): { chunkCount: number; symbolCount: number; indexed: boolean } {
    const repoIndex = this.semanticIndex.get(repoName);
    const repoSymbolIndex = this.symbolIndex.get(repoName);

    return {
      chunkCount: repoIndex?.size || 0,
      symbolCount: repoSymbolIndex?.size || 0,
      indexed: (repoIndex?.size || 0) > 0,
    };
  }

  clearIndex(repoName: string): void {
    this.semanticIndex.delete(repoName);
    this.symbolIndex.delete(repoName);

    const indexPath = this.getIndexPath(repoName);
    if (fs.existsSync(indexPath)) {
      fs.unlinkSync(indexPath);
    }
  }
}
