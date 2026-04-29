import { Injectable, Logger } from '@nestjs/common';
import simpleGit, { SimpleGit } from 'simple-git';
import * as path from 'path';
import * as fs from 'fs';

export interface CloneProgress {
  status: 'pending' | 'cloning' | 'completed' | 'error';
  progress?: number;
  message?: string;
  error?: string;
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileEntry[];
}

export interface SearchResult {
  filePath: string;
  line: number;
  content: string;
  matchLine: string;
}

@Injectable()
export class GitService {
  private readonly logger = new Logger(GitService.name);
  private readonly progressMap = new Map<string, CloneProgress>();
  private readonly repoPaths = new Map<string, string>();
  private readonly repoUrls = new Map<string, string>();
  private readonly baseDir = process.env.CLONE_TARGET_DIR || path.join(process.cwd(), 'cloned-repos');
  private readonly cacheDir = path.join(process.cwd(), '.cache');
  // In-memory file content cache for faster searches (file path -> content)
  private readonly fileContentCache = new Map<string, { content: string; mtime: number }>();
  private readonly CACHE_MAX_AGE = 300000; // 5 minutes (longer for better performance)

  constructor() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
    this.loadExistingRepos();
    this.loadDiskCache();
  }

  private loadExistingRepos(): void {
    try {
      if (!fs.existsSync(this.baseDir)) return;

      const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const entryPath = path.join(this.baseDir, entry.name);
        const gitDir = path.join(entryPath, '.git');

        // Check if this is a repo directly (flat structure)
        if (fs.existsSync(gitDir)) {
          this.repoPaths.set(entry.name, entryPath);
          this.progressMap.set(entry.name, {
            status: 'completed',
            progress: 100,
            message: '100%',
          });
          this.logger.log(`Loaded existing repository: ${entry.name}`);
          continue;
        }

        // Otherwise check for nested repos (folder/repo structure)
        const repos = fs.readdirSync(entryPath, { withFileTypes: true });
        for (const repo of repos) {
          if (!repo.isDirectory()) continue;

          const repoPath = path.join(entryPath, repo.name);
          const repoGitDir = path.join(repoPath, '.git');

          if (fs.existsSync(repoGitDir)) {
            this.repoPaths.set(repo.name, repoPath);
            this.progressMap.set(repo.name, {
              status: 'completed',
              progress: 100,
              message: '100%',
            });
            this.logger.log(`Loaded existing repository: ${repo.name}`);
          }
        }
      }
    } catch (error) {
      this.logger.error(`Failed to load existing repos: ${error.message}`);
    }
  }

  async cloneRepository(url: string, targetFolder: string): Promise<void> {
    const repoName = this.extractRepoName(url);
    // Use flat structure: cloned-repos/repo-name
    const targetPath = path.join(this.baseDir, repoName);

    this.progressMap.set(repoName, { status: 'pending', progress: 0, message: 'Preparing to clone...' });
    this.repoPaths.set(repoName, targetPath);

    try {
      if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(targetPath, { recursive: true });
      }

      const git = simpleGit({
        baseDir: targetPath,
        binary: 'git',
        maxConcurrentProcesses: 6,
        config: [
          'http.postBuffer=1048576000',      // 1GB buffer for HTTP
          'http.lowSpeedLimit=0',            // Disable speed limit
          'http.lowSpeedTime=999999',        // Disable time limit
          'pack.windowMemory=256m',          // More memory for packing
          'pack.packSizeLimit=256m',         // Pack size limit
          'pack.threads=4',                  // More threads for packing
          'core.compression=0',              // Disable compression for speed
        ],
      });

      this.progressMap.set(repoName, { status: 'cloning', progress: 25, message: 'Cloning repository...' });

      // First try shallow clone for faster initial fetch
      try {
        await git.clone(url, '.', [
          '--progress',
          '--depth=1',           // Shallow clone first
          '--config=http.postBuffer=1048576000',
          '--config=http.lowSpeedLimit=0',
          '--config=http.lowSpeedTime=999999',
        ]);

        // Then fetch the rest
        await git.pull('origin', 'HEAD', ['--unshallow', '--progress']);
      } catch (shallowError) {
        // If shallow clone fails, try full clone
        this.logger.log('Shallow clone failed, trying full clone...');
        await git.clone(url, '.', [
          '--progress',
          '--config=http.postBuffer=1048576000',
          '--config=http.lowSpeedLimit=0',
          '--config=http.lowSpeedTime=999999',
        ]);
      }

      this.progressMap.set(repoName, {
        status: 'completed',
        progress: 100,
        message: '100%',
      });

      this.logger.log(`Successfully cloned ${url} to ${targetPath}`);
    } catch (error) {
      this.logger.error(`Failed to clone ${url}: ${error.message}`);
      this.progressMap.set(repoName, {
        status: 'error',
        error: error.message,
      });
      throw error;
    }
  }

  getRepoPath(repoName: string): string | null {
    return this.repoPaths.get(repoName) || null;
  }

  listFiles(repoName: string, subPath = ''): FileEntry[] {
    const repoPath = this.repoPaths.get(repoName);
    if (!repoPath) {
      return [];
    }

    const fullPath = path.join(repoPath, subPath);
    if (!fs.existsSync(fullPath)) {
      return [];
    }

    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const result: FileEntry[] = [];

    for (const entry of entries) {
      if (entry.name === '.git') continue;

      const entryPath = path.join(subPath, entry.name);
      if (entry.isDirectory()) {
        result.push({
          name: entry.name,
          path: entryPath,
          type: 'folder',
        });
      } else {
        result.push({
          name: entry.name,
          path: entryPath,
          type: 'file',
        });
      }
    }

    return result.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === 'folder' ? -1 : 1;
    });
  }

  getFileContent(repoName: string, filePath: string): string | null {
    const repoPath = this.repoPaths.get(repoName);
    if (!repoPath) return null;

    // Normalize path separators (handle both / and \)
    const normalizedPath = filePath.replace(/\//g, path.sep);
    const fullPath = path.join(repoPath, normalizedPath);

    if (!fs.existsSync(fullPath)) {
      return null;
    }

    try {
      return fs.readFileSync(fullPath, 'utf-8');
    } catch {
      return null;
    }
  }

  getClonedRepos(): string[] {
    return Array.from(this.repoPaths.keys());
  }

  getAllFilesRecursive(repoName: string, subPath = ''): { path: string; type: 'file' }[] {
    const repoPath = this.repoPaths.get(repoName);
    if (!repoPath) return [];

    const fullPath = subPath ? path.join(repoPath, subPath) : repoPath;
    if (!fs.existsSync(fullPath)) return [];

    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const result: { path: string; type: 'file' }[] = [];

    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;

      const entryPath = subPath ? `${subPath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        const children = this.getAllFilesRecursive(repoName, entryPath);
        result.push(...children);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const validExts = ['.js', '.ts', '.jsx', '.tsx', '.json', '.md', '.html', '.css', '.scss', '.py', '.java', '.c', '.cpp', '.h', '.rs', '.go', '.rb', '.php', '.yaml', '.yml', '.toml', '.ini', '.conf', '.sh', '.bash'];
        if (validExts.includes(ext)) {
          result.push({ path: entryPath, type: 'file' });
        }
      }
    }

    return result;
  }

  getProgress(repoName: string): CloneProgress {
    return this.progressMap.get(repoName) || { status: 'pending' };
  }

  getAllProgress(): Map<string, CloneProgress> {
    return this.progressMap;
  }

  searchInRepo(repoName: string, query: string, limit: number = 30): SearchResult[] {
    const repoPath = this.repoPaths.get(repoName);
    if (!repoPath) return [];

    const results: SearchResult[] = [];
    const queryLower = query.toLowerCase();
    const searchTerms = queryLower.split(/\s+/).filter(t => t.length > 2);

    // Priority extensions for code files (search these first)
    const priorityExts = new Set(['.ts', '.js', '.tsx', '.jsx', '.py', '.java', '.go', '.rs', '.php', '.rb']);
    const secondaryExts = new Set(['.json', '.md', '.html', '.css', '.scss', '.yaml', '.yml', '.toml', '.ini', '.conf', '.sh', '.bash', '.c', '.cpp', '.h']);

    const searchFile = (fullPath: string, relativePath: string): boolean => {
      const ext = path.extname(fullPath).toLowerCase();
      if (!priorityExts.has(ext) && !secondaryExts.has(ext)) return true; // Skip non-code files

      try {
        const content = this.getFileContentCached(fullPath);
        if (!content) return true;

        const lines = content.split('\n');
        let fileMatches = 0;

        for (let i = 0; i < lines.length && fileMatches < 3; i++) {
          const line = lines[i];
          const lineLower = line.toLowerCase();

          // OR matching: ANY term matches (faster, more results)
          const matches = searchTerms.length > 0
            ? searchTerms.some(term => lineLower.includes(term))
            : lineLower.includes(queryLower);

          if (matches) {
            results.push({
              filePath: relativePath,
              line: i + 1,
              content: line.trim(),
              matchLine: line,
            });
            fileMatches++;

            // Early termination when we have enough results
            if (results.length >= limit) return false;
          }
        }
      } catch {
        // Skip binary or unreadable files
      }
      return true;
    };

    const searchDir = (dir: string): boolean => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        // Sort: code files first, then directories
        entries.sort((a, b) => {
          const aExt = path.extname(a.name);
          const bExt = path.extname(b.name);
          if (a.isDirectory() && b.isFile()) return 1;
          if (a.isFile() && b.isDirectory()) return -1;
          if (priorityExts.has(aExt) && !priorityExts.has(bExt)) return -1;
          return 0;
        });

        for (const entry of entries) {
          if (entry.name === '.git' || entry.name === 'node_modules') continue;

          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(repoPath, fullPath);

          if (entry.isDirectory()) {
            if (!searchDir(fullPath)) return false;
          } else if (entry.isFile()) {
            if (!searchFile(fullPath, relativePath)) return false;
          }
        }
      } catch {
        // Skip unreadable directories
      }
      return true;
    };

    searchDir(repoPath);
    return results;
  }

  // Get file content with caching (in-memory + disk)
  private getFileContentCached(filePath: string): string | null {
    // Check in-memory cache first (fastest)
    const cached = this.fileContentCache.get(filePath);
    if (cached && Date.now() - cached.mtime < this.CACHE_MAX_AGE) {
      return cached.content;
    }

    try {
      // Read from disk
      const content = fs.readFileSync(filePath, 'utf-8');

      // Cache in memory
      this.fileContentCache.set(filePath, { content, mtime: Date.now() });

      return content;
    } catch {
      return null;
    }
  }

  // Load disk cache on startup
  private loadDiskCache(): void {
    try {
      const cacheFile = path.join(this.cacheDir, 'file-cache.json');
      if (fs.existsSync(cacheFile)) {
        const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        const now = Date.now();

        // Load entries that are still valid (< 1 hour old)
        for (const [filePath, entry] of Object.entries(data as Record<string, { content: string; mtime: number }>)) {
          if (now - entry.mtime < 3600000) { // 1 hour
            this.fileContentCache.set(filePath, entry);
          }
        }

        this.logger.log(`Loaded ${this.fileContentCache.size} cached file entries`);
      }
    } catch (err) {
      this.logger.debug(`Could not load disk cache: ${err.message}`);
    }
  }

  // Save cache to disk periodically (called every 5 minutes or on shutdown)
  private saveDiskCache(): void {
    try {
      const cacheFile = path.join(this.cacheDir, 'file-cache.json');
      const data: Record<string, { content: string; mtime: number }> = {};

      for (const [key, value] of this.fileContentCache.entries()) {
        if (Date.now() - value.mtime < this.CACHE_MAX_AGE) {
          data[key] = value;
        }
      }

      fs.writeFileSync(cacheFile, JSON.stringify(data), 'utf-8');
      this.logger.debug(`Saved ${Object.keys(data).length} entries to disk cache`);
    } catch (err) {
      this.logger.debug(`Could not save disk cache: ${err.message}`);
    }
  }

  // Clean old cache entries and save to disk
  private cleanFileCache(): void {
    const now = Date.now();
    let deleted = 0;

    for (const [key, value] of this.fileContentCache.entries()) {
      if (now - value.mtime > this.CACHE_MAX_AGE) {
        this.fileContentCache.delete(key);
        deleted++;
      }
    }

    // Save to disk if we deleted entries
    if (deleted > 0) {
      this.saveDiskCache();
    }
  }

  private extractRepoName(url: string): string {
    const parts = url.replace(/\.git$/, '').split('/');
    return parts[parts.length - 1];
  }
}
