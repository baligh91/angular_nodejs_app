import { Transform } from 'class-transformer';
import { ArrayUnique, IsArray, IsInt, IsString, Length, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class FplIdDto {
  @ApiProperty() @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) fplId!: number;
}

export class FplRegisterDto extends FplIdDto {
  @ApiProperty({ minLength: 6, maxLength: 128 })
  @IsString() @Length(6, 128) password!: string;
}

export class FplLoginDto extends FplIdDto {
  @ApiProperty({ minLength: 6, maxLength: 128 })
  @IsString() @Length(6, 128) password!: string;
}

export class ManagerLeagueQueryDto {
  @ApiProperty() @Transform(({ value }) => Number(value))
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) leagueFplId!: number;
}

export class TeamDto {
  @ApiProperty() @IsString() @Length(2, 60)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  name!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) leagueFplId!: number;
  @ApiProperty({ type: [Number], minItems: 5, maxItems: 5 })
  @IsArray() @ArrayUnique() @IsInt({ each: true }) @Min(1, { each: true }) managerIds!: number[];
  @ApiProperty() @IsInt() @Min(1) captainId!: number;
}
