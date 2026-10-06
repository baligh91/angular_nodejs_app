import { Transform } from 'class-transformer';
import {
  ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsMongoId, IsOptional,
  IsString, IsUrl, Length, Matches, Max, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Format } from '../domain/rules';

export class FplChallengeDto {
  @ApiProperty() @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) fplId!: number;
}
export class FplVerifyDto {
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) challengeId!: string;
}
export class ProfileDto {
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() || null : value)
  @IsUrl({ protocols: ['https'], require_protocol: true }) @Length(1, 500)
  avatar?: string | null;
}
export class EmptyDto {}
export class LeagueDto {
  @ApiProperty() @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) fplId!: number;
}
export class TeamDto {
  @ApiProperty() @IsString() @Length(2, 80)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  name!: string;
  @ApiProperty() @IsMongoId() leagueId!: string;
  @ApiProperty({ enum: [5, 7, 11] }) @IsInt() @IsIn([5, 7, 11]) format!: Format;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayUnique() @IsMongoId({ each: true })
  managerIds!: string[];
  @ApiProperty() @IsMongoId() captainId!: string;
}
export class DisableDto {
  @ApiProperty() @IsBoolean() disabled!: boolean;
}
export class LeagueStatusDto {
  @ApiProperty() @IsBoolean() active!: boolean;
}
export class LeagueQueryDto {
  @ApiProperty() @IsMongoId() leagueId!: string;
}
export class RankingQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsMongoId() leagueId?: string;
}
