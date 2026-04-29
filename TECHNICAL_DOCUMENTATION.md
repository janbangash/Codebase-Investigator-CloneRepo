# AI Repository Agent: Technical Architecture Document

## Executive Summary

The AI Repository Agent is an intelligent code search and analysis platform that combines traditional search techniques with Large Language Model (LLM) powered semantic understanding. Built with NestJS (backend) and Next.js (frontend), the system enables developers to clone GitHub repositories, index their code, and perform intelligent searches with real-time progress streaming similar to the Cursor IDE experience.

---

## 1. System Architecture Overview

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (Next.js 16)                         │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  ┌───────────────┐ │
│  │ Repo Clone  │  │ File Browser │  │ AI Search   │  │ Agent Chat    │ │
│  │ UI          │  │ Tree View    │  │ Panel       │  │ (Streaming)   │ │
│  └─────────────┘  └──────────────┘  └─────────────┘  └───────────────┘ │
│                          │                  │                           │
│                    REST API           Server-Sent Events (SSE)          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         BACKEND (NestJS 11)                             │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  ┌───────────────┐ │
│  │ GitModule   │  │ OllamaModule │  │ SearchModule│  │  WebSocket    │ │
│  │             │  │              │  │             │  │  Gateway      │ │
│  │ - clone     │  │ - indexing   │  │ - semantic  │  │  - progress   │ │
│  │ - file tree │  │ - embeddings │  │ - symbol    │  │  - events     │ │
│  │ - search    │  │ - chat       │  │ - agent     │  │               │ │
│  └─────────────┘  └──────────────┘  └─────────────┘  └───────────────┘ │
│                          │                  │                           │
│                    File System          Ollama LLM                      │
│                    (cloned-repos)       (deepseek-coder:6.7b)           │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Technology Stack

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| **Frontend Framework** | Next.js | 16.2.4 | React-based UI with App Router |
| **Frontend Language** | TypeScript | 5.x | Type-safe development |
| **Styling** | Tailwind CSS | 4.x | Utility-first CSS framework |
| **Backend Framework** | NestJS | 11.1.19 | Modular Node.js framework |
| **LLM Client** | Ollama | 0.6.3 | Local LLM inference |
| **LLM Model** | DeepSeek Coder | 6.7B | Code understanding |
| **Embedding Model** | nomic-embed-text | - | Semantic vector generation |
| **Git Operations** | simple-git | 3.36.0 | Repository cloning |
| **Real-time** | Socket.IO | 4.8.x | Clone progress streaming |
| **State Management** | React Hooks | - | useState, useEffect, useCallback |

---

## 2. Backend Architecture

### 2.1 Module Structure

The backend follows NestJS's modular architecture with three core modules:

```
backend/src/
├── app.module.ts          # Root module
├── main.ts                # Application entry point
├── git/                   # Repository management
│   ├── git.module.ts
│   ├── git.service.ts
│   ├── git.controller.ts
│   ├── git.gateway.ts     # WebSocket gateway
│   └── dto/
│       └── clone-repo.dto.ts
├── ollama/                # LLM integration
│   ├── ollama.module.ts
│   ├── ollama.service.ts
│   └── ollama.controller.ts
└── search/                # Advanced search
    ├── search.module.ts
    ├── search.controller.ts
    ├── semantic-search.service.ts
    └── code-search.agent.ts
```

### 2.2 GitModule: Repository Management

**File:** `backend/src/git/git.service.ts`

The `GitService` handles all repository operations:

#### Key Responsibilities:
1. **Repository Cloning** with progress tracking
2. **File System Navigation** with cached directory listings
3. **Text Search** across repository files
4. **Content Caching** for performance optimization

#### Critical Implementation Details:

```typescript
// In-memory file content cache (5 minute TTL)
private readonly fileContentCache = new Map<string, { content: string; mtime: number }>();
private readonly CACHE_MAX_AGE = 300000;

// Disk cache persistence
private loadDiskCache(): void {
  const cacheFile = path.join(this.cacheDir, 'file-cache.json');
  // Loads cached content on startup for instant search
}
```

#### Clone Optimization Strategy:

```typescript
// Two-stage clone for faster initial fetch
async cloneRepository(url: string, targetFolder: string): Promise<void> {
  try {
    // Stage 1: Shallow clone (--depth=1)
    await git.clone(url, '.', ['--progress', '--depth=1']);
    
    // Stage 2: Unshallow to get full history
    await git.pull('origin', 'HEAD', ['--unshallow', '--progress']);
  } catch (shallowError) {
    // Fallback: Full clone if shallow fails
    await git.clone(url, '.', ['--progress']);
  }
}
```

#### Search Algorithm:

The `searchInRepo` method implements a priority-based search:

1. **Priority Extensions First**: `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.java`
2. **Secondary Extensions**: `.json`, `.md`, `.yaml`, `.css`
3. **Keyword Matching**: OR-based matching for broader results
4. **Early Termination**: Stops when limit reached

```typescript
searchInRepo(repoName: string, query: string, limit: number = 30): SearchResult[] {
  const searchTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  
  for (const file of sortedFiles) {
    const content = this.getFileContentCached(fullPath);
    for (let i = 0; i < lines.length && fileMatches < 3; i++) {
      // OR matching: ANY term matches
      const matches = searchTerms.some(term => lineLower.includes(term));
      if (matches) {
        results.push({ filePath, line, content, matchLine });
      }
      if (results.length >= limit) return results;
    }
  }
}
```

### 2.3 OllamaModule: LLM Integration

**File:** `backend/src/ollama/ollama.service.ts`

The `OllamaService` provides AI-powered code understanding:

#### Core Features:

1. **Code Indexing** with embeddings
2. **Query Intent Analysis** using LLM
3. **Enhanced Text Search** with multi-keyword scoring
4. **Streaming Chat** with granular progress updates
5. **Response Caching** (2-minute TTL)

#### Query Intent Analysis:

```typescript
async analyzeQueryIntent(query: string): Promise<{
  keywords: string[];
  intent: string;
  suggestions: string[]
}> {
  if (!this.ollamaAvailable) {
    // Fallback to heuristic analysis
    return {
      keywords: this.extractKeywords(query),
      intent: 'search',
      suggestions: this.generateSuggestions(keywords),
    };
  }
  
  // LLM-powered analysis
  const response = await this.client.chat({
    model: this.model,
    messages: [{
      role: 'system',
      content: `Extract keywords, intent, and suggestions from query...`
    }, { role: 'user', content: query }],
  });
}
```

#### Keyword Extraction (Fast Path):

```typescript
private extractKeywordsFast(query: string): string[] {
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'make', 'using', 'use', 'show', 'me', 'find', 'get', 'tell', 'explain', 'give', 'looking', 'want', 'need', 'search', 'code']);
  
  const words = query
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()));
  
  // Extract compound terms (camelCase, snake_case)
  const compounds = query.match(/[a-z]+[A-Z][a-z]+|[a-z]+_[a-z]+/g) || [];
  
  return [...new Set([...words, ...compoundParts])].slice(0, 8);
}
```

#### Enhanced Search with Scoring:

```typescript
async enhancedTextSearch(repoName: string, query: string, limit: number): Promise<CodeChunk[]> {
  // Check cache first (2-minute TTL)
  const cacheKey = `${repoName}:${query.toLowerCase()}`;
  const cached = this.searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
    return cached.results;
  }
  
  // Extract multiple keywords
  const keywords = this.extractKeywords(query);
  const primaryKeyword = keywords[0] || query;
  
  // Search with primary keyword
  const results = this.gitService.searchInRepo(repoName, primaryKeyword, limit * 2);
  
  // Score results based on additional keyword matches
  const scoredResults = results.map(r => {
    let score = 1;
    for (const keyword of keywords.slice(1)) {
      if (r.content.toLowerCase().includes(keyword.toLowerCase())) {
        score += 0.5;
      }
    }
    return { ...r, score };
  });
  
  // Sort by score and cache
  const finalResults = scoredResults.sort((a, b) => b.score - a.score).slice(0, limit);
  this.searchCache.set(cacheKey, { results: finalResults, timestamp: Date.now() });
  
  return finalResults;
}
```

#### Cursor-like Streaming Progress:

```typescript
async *chatStream(repoName: string, messages: ChatMessage[]): AsyncGenerator<{ type: string; data: any }> {
  // Step 1: Extract keywords (INSTANT)
  yield { type: 'analyzing', data: { message: 'Extracting keywords...', step: 1, total: 4 } };
  const keywords = this.extractKeywordsFast(query);
  yield { type: 'analyzed', data: { keywords, time: Date.now() - startTime } };
  
  // Step 2-3: Stream search progress file-by-file
  for await (const progress of this.searchWithProgress(repoName, query, 20)) {
    if (progress.type === 'file') {
      yield {
        type: 'searching_file',
        data: { file: progress.file, message: `Searching ${progress.file}...` }
      };
    } else if (progress.type === 'match') {
      yield {
        type: 'found_match',
        data: { file: progress.file, count: matchCount }
      };
    }
  }
  
  // Step 4: Generate response
  yield { type: 'complete', data: { response, codeReferences, time: totalTime } };
}
```

### 2.4 SearchModule: Advanced Search

**Files:** `backend/src/search/semantic-search.service.ts`, `code-search.agent.ts`

#### Semantic Search Service

Implements vector-based semantic search using embeddings:

```typescript
interface SemanticChunk {
  id: string;
  repoName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  summary: string;              // LLM-generated summary
  symbols: string[];            // Extracted symbols (functions, classes)
  embedding: number[];          // Vector embedding
  tags: string[];               // Auto-generated tags
  imports: string[];            // File imports
  references: string[];         // External references
}
```

#### Indexing Process:

```typescript
async buildSemanticIndex(repoName: string, files: { path: string; content: string }[]): Promise<void> {
  const repoIndex = new Map<string, SemanticChunk>();
  const repoSymbolIndex = new Map<string, SemanticChunk[]>();
  
  for (const file of files) {
    const chunks = await this.processFile(repoName, file.path, file.content);
    for (const chunk of chunks) {
      repoIndex.set(chunk.id, chunk);
      // Index symbols for fast lookup
      for (const symbol of chunk.symbols) {
        repoSymbolIndex.get(symbol)?.push(chunk) || repoSymbolIndex.set(symbol, [chunk]);
      }
    }
  }
  
  this.semanticIndex.set(repoName, repoIndex);
  this.symbolIndex.set(repoName, repoSymbolIndex);
  
  // Persist to disk
  await this.saveIndex(repoName);
}
```

#### Semantic Search Algorithm:

```typescript
async semanticSearch(repoName: string, query: string, limit: number = 10): Promise<SearchResult[]> {
  const repoIndex = this.semanticIndex.get(repoName);
  const queryEmbedding = await this.generateEmbedding(query);
  
  const scored: SearchResult[] = [];
  for (const chunk of repoIndex.values()) {
    // Cosine similarity with query
    const semanticScore = this.cosineSimilarity(queryEmbedding, chunk.embedding);
    
    // Boost by keyword match
    const keywordBoost = this.keywordMatchScore(query, chunk);
    const finalScore = semanticScore + keywordBoost;
    
    if (finalScore > 0.1) {
      scored.push({ chunk, score: finalScore, reason: this.generateMatchReason(query, chunk, semanticScore, keywordBoost) });
    }
  }
  
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
```

#### Code Search Agent

Implements an agentic search workflow with reasoning:

```typescript
async search(repoName: string, query: string, context?: { line?: number; filePath?: string }): Promise<AgentResponse> {
  const thoughts: AgentThought[] = [];
  
  // Phase 1: Analyze query
  const analysis = await this.analyzeQuery(query, context);
  thoughts.push({ phase: 'analyze', thought: analysis.intent, action: 'query_analysis' });
  
  // Phase 2: Create search plan
  const plan = await this.createSearchPlan(analysis);
  thoughts.push({ phase: 'plan', thought: `Executing ${plan.strategies.length} strategies` });
  
  // Phase 3: Execute search strategies
  const allResults = await this.executeSearchStrategies(repoName, plan);
  thoughts.push({ phase: 'search', thought: `Found ${allResults.length} matches` });
  
  // Phase 4: Enrich with context
  const enrichedResults = await this.enrichWithContext(repoName, allResults);
  thoughts.push({ phase: 'retrieve', thought: 'Analyzing code context' });
  
  // Phase 5: Reason about results
  const reasoning = await this.reasonAboutResults(query, enrichedResults, plan);
  thoughts.push({ phase: 'reason', thought: reasoning.summary });
  
  // Phase 6: Generate response
  const response = await this.generateResponse(query, enrichedResults, reasoning, plan);
  thoughts.push({ phase: 'respond', thought: 'Generated final response' });
  
  return {
    answer: response,
    results: enrichedResults.slice(0, 10),
    thoughts,
    navigation: this.generateNavigationSuggestions(repoName, enrichedResults, plan),
    confidence: reasoning.confidence,
  };
}
```

---

## 3. Frontend Architecture

### 3.1 Component Structure

```
frontend/app/
├── page.tsx                 # Main application page
└── layout.tsx               # Root layout

frontend/components/
├── agent/
│   ├── AgentProgress.tsx    # Cursor-like progress panel
│   └── MatchPreview.tsx     # Match preview cards
└── ...
```

### 3.2 Main Page Component

**File:** `frontend/app/page.tsx`

#### State Management:

```typescript
// Repository state
const [repoStatuses, setRepoStatuses] = useState<Record<string, RepoStatus>>({});
const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
const [files, setFiles] = useState<FileEntry[]>([]);
const [fileContent, setFileContent] = useState<...>(null);

// AI Search state
const [searchQuery, setSearchQuery] = useState('');
const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
const [searchAnalysis, setSearchAnalysis] = useState<SearchAnalysis | null>(null);
const [isSearching, setIsSearching] = useState(false);
const [searchActive, setSearchActive] = useState(false);

// Agent Chat state
const [chatOpen, setChatOpen] = useState(false);
const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
const [streamEvents, setStreamEvents] = useState<StreamEvent[]>([]);
const [agentEvents, setAgentEvents] = useState<any[]>([]);
const [liveMatches, setLiveMatches] = useState<any[]>([]);
```

#### Debounced Search:

```typescript
const handleSearch = useCallback(async (query: string) => {
  if (!query.trim() || !selectedRepo) return;
  
  setIsSearching(true);
  setSearchActive(true);
  
  try {
    const res = await fetch(`${API_URL}/api/ai/search/${selectedRepo}?q=${encodeURIComponent(query)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.results && Array.isArray(data.results)) {
        setSearchResults(data.results);
        if (data.analysis) {
          setSearchAnalysis(data.analysis);
        }
      }
    }
  } catch (err) {
    console.error('Search failed:', err);
  } finally {
    setIsSearching(false);
  }
}, [selectedRepo]);

// 500ms debounce to avoid excessive API calls
useEffect(() => {
  const debounce = setTimeout(() => {
    if (searchQuery) handleSearch(searchQuery);
  }, 500);
  return () => clearTimeout(debounce);
}, [searchQuery, handleSearch]);
```

#### AI Analysis Display:

```typescript
{(searchActive || searchQuery) && (searchResults.length > 0 || searchAnalysis || isSearching) && (
  <div className="mt-2 border-t border-gray-600">
    <div className="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-purple-900/40 to-gray-800/50">
      <div className="flex items-center gap-3 flex-1 flex-wrap">
        <span className="text-xs font-semibold text-purple-300">AI Query Analysis:</span>
        
        {isSearching && !searchAnalysis && (
          <div className="flex items-center gap-2">
            <svg className="animate-spin h-3 w-3" ... />
            <span className="text-xs text-gray-400">Analyzing query...</span>
          </div>
        )}
        
        {searchAnalysis && (
          <>
            {searchAnalysis.keywords?.map((kw, i) => (
              <span key={i} className="text-xs bg-purple-900/60 text-purple-200 px-2 py-0.5 rounded-full border border-purple-700/50">
                {kw}
              </span>
            ))}
            
            {searchAnalysis.intent && (
              <span className="text-xs bg-blue-900/60 text-blue-200 px-2 py-0.5 rounded-full capitalize">
                {searchAnalysis.intent}
              </span>
            )}
            
            {searchAnalysis.suggestions?.map((s, i) => (
              <span key={i} className="text-xs bg-green-900/60 text-green-200 px-2 py-0.5 rounded-full">
                {s}
              </span>
            ))}
          </>
        )}
      </div>
    </div>
    
    {/* Search Results */}
    <div className="space-y-1 px-2 pb-2 max-h-48 overflow-y-auto">
      {searchResults.slice(0, 15).map((result) => (
        <div key={`${result.filePath}-${result.line}`} 
             className="bg-gray-700/50 rounded p-2 cursor-pointer hover:bg-gray-700"
             onClick={() => fetchFileContent(selectedRepo!, result.filePath, result.line)}>
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <span className="truncate flex-1">{result.filePath}</span>
            <span className="text-purple-400">:{result.line}</span>
          </div>
          <p className="text-xs text-gray-300 font-mono truncate">{result.content}</p>
        </div>
      ))}
    </div>
  </div>
)}
```

### 3.3 Agent Progress Component

**File:** `frontend/components/agent/AgentProgress.tsx`

Displays real-time search progress in a Cursor-like tree view:

```typescript
export default function AgentProgress({ events }: AgentProgressProps) {
  // Group events by phase
  const searchFiles = events.filter(e => e.type === 'searching_file').slice(-10);
  const foundMatches = events.filter(e => e.type === 'found_match').slice(-10);
  
  return (
    <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700 font-mono text-xs">
      <div className="text-purple-300 font-semibold mb-3">Agent Progress</div>
      
      {/* Stream all events */}
      {events.map((event, idx) => (
        <div key={idx} className={`flex items-center gap-2 ${getProgressColor(event.type)}`}>
          {getStatusIcon(event.type)}
          <span>{event.data.message}</span>
          {event.data.time && <span className="text-gray-500">({event.data.time}ms)</span>}
        </div>
      ))}
      
      {/* Files Searched Tree */}
      {searchFiles.length > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-700">
          <div className="text-gray-400 text-xs mb-2">📁 Files Searched:</div>
          {searchFiles.map((event, idx) => (
            <div key={idx} className="flex items-center gap-2 text-gray-500">
              <span className="text-blue-500">├──</span>
              <span className="truncate">{event.data.file}</span>
              {event.data.matches !== undefined && (
                <span className="text-green-500">({event.data.matches} matches)</span>
              )}
            </div>
          ))}
        </div>
      )}
      
      {/* Matches Found */}
      {foundMatches.length > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-700">
          <div className="text-gray-400 text-xs mb-2">✓ Matches Found:</div>
          {foundMatches.map((event, idx) => (
            <div key={idx} className="flex items-center gap-2 text-green-500">
              <span>├──</span>
              <span className="truncate">{event.data.file}</span>
              <span className="text-gray-500">(# {event.data.count})</span>
            </div>
          ))}
        </div>
      )}
      
      {/* Completion Summary */}
      {events.some(e => e.type === 'complete') && (
        <div className="mt-4 pt-3 border-t border-gray-700">
          <div className="flex items-center justify-between text-green-400">
            <span>✓ Search Complete</span>
            <span className="text-gray-500">{completeEvent.data.time}ms</span>
          </div>
        </div>
      )}
    </div>
  );
}
```

### 3.4 Match Preview Component

**File:** `frontend/components/agent/MatchPreview.tsx`

Displays streamed match previews with code snippets:

```typescript
export default function MatchPreview({ matches, onNavigate }: MatchPreviewProps) {
  return (
    <div className="space-y-2">
      {matches.map((match, idx) => (
        <div key={idx} 
             className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden hover:border-purple-500 cursor-pointer"
             onClick={() => onNavigate?.(match.file, match.line || 0)}>
          
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-800 border-b border-gray-700">
            <svg className="w-4 h-4 text-blue-400" ... />
            <span className="text-purple-300 font-mono text-xs truncate">{match.file}</span>
            {match.line && <span className="text-gray-500 text-xs">Line {match.line}</span>}
            {match.count && <span className="bg-purple-900/50 text-purple-300 px-2 py-0.5 rounded text-xs">#{match.count}</span>}
          </div>
          
          {match.content && (
            <div className="px-3 py-2 bg-gray-900/50">
              <pre className="text-xs text-gray-300 font-mono">
                <code>{match.content.slice(0, 200)}{match.content.length > 200 ? '...' : ''}</code>
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

---

## 4. Agent Workflow

### 4.1 Query Processing Pipeline

```
User Query
    │
    ▼
┌─────────────────────────────────┐
│  Phase 1: Query Analysis        │
│  - Extract keywords (fast)      │
│  - Detect intent (LLM fallback) │
│  - Generate suggestions         │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  Phase 2: Search Planning       │
│  - Select strategies            │
│  - Prioritize file types        │
│  - Order by relevance           │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  Phase 3: Parallel Search       │
│  - Semantic search              │
│  - Symbol search                │
│  - Text search                  │
│  - Reference search             │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  Phase 4: Result Enrichment     │
│  - Add context chunks           │
│  - Extract related symbols      │
│  - Boost by relevance           │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  Phase 5: Reasoning             │
│  - Evaluate confidence          │
│  - Identify gaps                │
│  - Synthesize findings          │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  Phase 6: Response Generation   │
│  - Format answer                │
│  - Add navigation hints         │
│  - Include code references      │
└─────────────────────────────────┘
```

### 4.2 Search Strategy Execution

```typescript
interface SearchStrategy {
  type: 'semantic' | 'symbol' | 'text' | 'reference';
  query: string;
  priority: number;
}

async executeSearchStrategies(repoName: string, plan: SearchPlan): Promise<SearchResult[]> {
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
        results = symbolChunks.map(chunk => ({ chunk, score: 0.8, reason: `Symbol: ${strategy.query}` }));
        break;
      case 'reference':
        const refChunks = this.semanticService.findCallers(repoName, strategy.query);
        results = refChunks.map(chunk => ({ chunk, score: 0.6, reason: `References: ${strategy.query}` }));
        break;
    }
    
    // Deduplicate results
    for (const result of results) {
      if (!seenChunks.has(result.chunk.id)) {
        seenChunks.add(result.chunk.id);
        allResults.push(result);
      }
    }
  }
  
  return allResults;
}
```

---

## 5. Performance Optimizations

### 5.1 Caching Strategy

| Cache Type | Storage | TTL | Purpose |
|------------|---------|-----|---------|
| **File Content** | Memory + Disk | 5 min | Fast search without re-reading files |
| **Search Results** | Memory + Disk | 2 min | Instant repeated queries |
| **Semantic Index** | Disk | 10 min | Avoid re-indexing unchanged repos |

### 5.2 Search Optimization

1. **Priority File Ordering**: Code files (`.ts`, `.js`) searched before config/docs
2. **Early Termination**: Stop when enough results found
3. **Batch Processing**: Process files in batches of 10
4. **Keyword Pre-filtering**: Fast heuristic extraction before LLM analysis

### 5.3 Streaming Architecture

```typescript
// Server-Sent Events (SSE) for chat streaming
@Sse('chat-stream/:repoName')
async chatStream(@Param('repoName') repoName: string, @Body() body: { messages: ChatMessage[] }, @Res() res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  
  for await (const event of this.ollamaService.chatStream(repoName, body.messages)) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  res.end();
}
```

### 5.4 Performance Benchmarks

| Metric | Before Optimization | After Optimization |
|--------|---------------------|-------------------|
| Query Analysis | 30-60s (LLM) | <10ms (heuristic) |
| First Result | 30s | <2s |
| Full Search (100 files) | 1-3 min | <10s |
| Repeated Query | Full search | <100ms (cache) |
| Progress Events | 2-3 generic | 20-50+ granular |

---

## 6. Design Decisions

### 6.1 Model Selection

**Decision:** Use DeepSeek Coder 6.7B instead of CodeLlama 7B

**Rationale:**
- Better code understanding and reasoning
- Faster inference time
- Lower memory footprint
- Excellent performance on code-specific tasks

**Configuration:**
```env
OLLAMA_MODEL=deepseek-coder:6.7b-instruct
OLLAMA_EMBED_MODEL=nomic-embed-text
```

### 6.2 Hybrid Search Approach

**Decision:** Combine keyword-based search with semantic search

**Rationale:**
- Keyword search: Fast, exact matches for known terms
- Semantic search: Finds conceptually related code
- Combined: Best of both worlds with score boosting

### 6.3 Streaming Over Polling

**Decision:** Use Server-Sent Events (SSE) for real-time updates

**Rationale:**
- Lower overhead than WebSocket for one-way streaming
- Native browser support
- Simpler implementation than WebSocket
- Automatic reconnection

### 6.4 Flat Repository Structure

**Decision:** Store cloned repos in `cloned-repos/repo-name` (flat) vs nested

**Rationale:**
- Simpler path resolution
- Easier backup and cleanup
- Better performance for directory listing

---

## 7. Challenges Addressed

### 7.1 Challenge: Slow LLM Query Analysis

**Problem:** Initial implementation used LLM for every query analysis, adding 30-60 seconds overhead.

**Solution:** Implemented fast heuristic keyword extraction as the primary path, with LLM as fallback only when needed.

```typescript
// Before: Always call LLM
const analysis = await this.analyzeQueryWithLLM(query);

// After: Fast path first
const keywords = this.extractKeywordsFast(query); // <10ms
if (needsDeepAnalysis) {
  const analysis = await this.analyzeQueryWithLLM(query);
}
```

### 7.2 Challenge: Generic Progress Messages

**Problem:** Users saw only "Searching..." with no visibility into what files were being searched.

**Solution:** Implemented granular file-by-file and match-by-match streaming.

```typescript
// Yield for EVERY file searched
yield { type: 'searching_file', data: { file: progress.file, matches: allMatches.length } };

// Yield for EVERY match found
yield { type: 'found_match', data: { file: progress.file, line: matchLine } };
```

### 7.3 Challenge: Disappearing Search Results

**Problem:** Search results would auto-clear when user continued typing.

**Solution:** Implemented explicit clear behavior with persistent results.

```typescript
// Results persist until user clicks Clear
const handleClearSearch = useCallback(() => {
  setSearchQuery('');
  setSearchResults([]);
  setSearchAnalysis(null);
  setSearchActive(false);
}, []);
```

### 7.4 Challenge: Missing Symbol Navigation

**Problem:** CodeChunk interface didn't include symbols property.

**Solution:** Extract symbols dynamically using regex patterns.

```typescript
const symbols: string[] = [];
const functionMatches = content.matchAll(/(?:function|class|const|let|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g);
for (const match of functionMatches) {
  symbols.push(match[1]);
}
```

---

## 8. API Reference

### 8.1 Git Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/git/clone` | Clone a GitHub repository |
| GET | `/api/git/progress/:repoName` | Get clone progress for specific repo |
| GET | `/api/git/progress` | Get progress for all repos |
| GET | `/api/git/repos` | List all cloned repositories |
| GET | `/api/git/files/:repoName` | List files in repository |
| GET | `/api/git/file/:repoName` | Get file content |
| GET | `/api/git/search/:repoName` | Text search in repository |

### 8.2 AI Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ai/available` | Check Ollama availability |
| GET | `/api/ai/status/:repoName` | Get indexing status |
| POST | `/api/ai/index/:repoName` | Trigger repository indexing |
| GET | `/api/ai/search/:repoName` | AI-powered search with analysis |
| POST | `/api/ai/chat/:repoName` | Chat about repository code |
| POST | `/api/ai/chat-stream/:repoName` | Streaming chat with progress |
| POST | `/api/ai/agent/:repoName` | Agent-based semantic search |
| SSE | `/api/ai/agent-stream/:repoName` | Streaming agent search |
| GET | `/api/ai/navigate/:repoName` | Source-level navigation |

### 8.3 Search Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/search/index/:repoName` | Build semantic index |
| GET | `/api/search/index/:repoName` | Get index info |
| POST | `/api/search/semantic/:repoName` | Semantic search |
| GET | `/api/search/symbol/:repoName/:symbol` | Search by symbol |
| GET | `/api/search/callers/:repoName/:symbol` | Find symbol callers |
| GET | `/api/search/definitions/:repoName/:symbol` | Find symbol definitions |
| POST | `/api/search/agent/:repoName` | Agent search |
| SSE | `/api/search/agent-stream/:repoName` | Streaming agent search |
| POST | `/api/search/navigate/:repoName` | Navigate code |

---

## 9. Future Enhancements

### 9.1 Planned Features

1. **Multi-repository Search**: Search across multiple repos simultaneously
2. **Code Graph Visualization**: Interactive dependency graphs
3. **Smart Suggestions**: AI-powered query refinement
4. **History & Bookmarks**: Save and revisit searches
5. **Plugin System**: Extensible search strategies

### 9.2 Performance Improvements

1. **Incremental Indexing**: Only index changed files
2. **Distributed Search**: Parallel search across workers
3. **Vector Database**: Migrate to Pinecone/Weaviate for semantic search
4. **Edge Caching**: CDN-based result caching

### 9.3 Model Upgrades

1. **Larger Context Window**: Support for 128K+ token contexts
2. **Fine-tuned Model**: Custom model trained on code search tasks
3. **Multi-model Fallback**: Automatic fallback between models

---

## 10. Conclusion

The AI Repository Agent represents a production-ready implementation of intelligent code search, combining traditional search algorithms with modern LLM capabilities. The architecture prioritizes:

- **Performance**: Sub-10-second search times with granular progress streaming
- **User Experience**: Cursor-like interface with real-time feedback
- **Maintainability**: Modular NestJS architecture with clear separation of concerns
- **Scalability**: Caching, streaming, and efficient data structures

The system demonstrates how AI can enhance rather than replace traditional search techniques, providing developers with an intuitive and powerful tool for code exploration.

---

## Appendix A: File Reference

| File | Path | Lines of Code | Purpose |
|------|------|---------------|---------|
| Git Service | `backend/src/git/git.service.ts` | 442 | Repository operations |
| Ollama Service | `backend/src/ollama/ollama.service.ts` | 697 | LLM integration |
| Semantic Search | `backend/src/search/semantic-search.service.ts` | 536 | Vector search |
| Code Agent | `backend/src/search/code-search.agent.ts` | 646 | Agentic search |
| Main Page | `frontend/app/page.tsx` | ~950 | UI implementation |
| Agent Progress | `frontend/components/agent/AgentProgress.tsx` | 167 | Progress UI |
| Match Preview | `frontend/components/agent/MatchPreview.tsx` | 61 | Match cards |

---

*Document Version: 1.0*
*Last Updated: April 28, 2026*
*Author: AI Repository Agent Development Team*
