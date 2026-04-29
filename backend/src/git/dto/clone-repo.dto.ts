import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class CloneRepoDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\/)?$/, {
    message: 'Invalid GitHub repository URL. Expected format: https://github.com/owner/repo',
  })
  url: string;

  @IsString()
  @IsNotEmpty()
  targetFolder: string;
}
