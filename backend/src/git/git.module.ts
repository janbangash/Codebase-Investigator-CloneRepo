import { Module } from '@nestjs/common';
import { GitController } from './git.controller';
import { GitService } from './git.service';
import { GitGateway } from './git.gateway';

@Module({
  providers: [GitService, GitGateway],
  controllers: [GitController],
  exports: [GitService],
})
export class GitModule {}
