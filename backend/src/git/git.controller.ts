import { Controller, Post, Get, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { GitService, CloneProgress, FileEntry, SearchResult } from './git.service';
import { CloneRepoDto } from './dto/clone-repo.dto';

@Controller('api/git')
export class GitController {
  constructor(private readonly gitService: GitService) {}

  @Post('clone')
  @HttpCode(HttpStatus.ACCEPTED)
  async cloneRepo(@Body() dto: CloneRepoDto): Promise<{ message: string; repoName: string }> {
    const repoName = dto.url.replace(/\.git$/, '').split('/').pop() || 'unknown';

    this.gitService.cloneRepository(dto.url, dto.targetFolder)
      .catch(err => {
        console.error(`Clone failed for ${repoName}:`, err.message);
      });

    return {
      message: 'Clone operation started',
      repoName,
    };
  }

  @Get('progress/:repoName')
  getProgress(@Param('repoName') repoName: string): CloneProgress {
    return this.gitService.getProgress(repoName);
  }

  @Get('progress')
  getAllProgress(): Record<string, CloneProgress> {
    const map = this.gitService.getAllProgress();
    return Object.fromEntries(map);
  }

  @Get('repos')
  getClonedRepos(): { name: string; progress: CloneProgress }[] {
    const repos = this.gitService.getClonedRepos();
    return repos.map(name => ({
      name,
      progress: this.gitService.getProgress(name),
    }));
  }

  @Get('files/:repoName')
  listFiles(@Param('repoName') repoName: string, @Query('path') path?: string): FileEntry[] {
    return this.gitService.listFiles(repoName, path);
  }

  @Get('file/:repoName')
  getFileContent(
    @Param('repoName') repoName: string,
    @Query('path') filePath: string,
  ): { content: string; path: string } | { error: string } {
    const content = this.gitService.getFileContent(repoName, filePath);
    if (content === null) {
      return { error: 'File not found' };
    }
    return { content, path: filePath };
  }

  @Get('search/:repoName')
  searchInRepo(
    @Param('repoName') repoName: string,
    @Query('q') query: string,
  ): SearchResult[] {
    return this.gitService.searchInRepo(repoName, query);
  }
}
