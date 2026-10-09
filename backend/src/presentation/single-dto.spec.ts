import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FplLoginDto, FplRegisterDto } from './single-dto';

describe('FPL password DTOs', () => {
  it('accepts six-character passwords for registration and login', async () => {
    for (const dto of [FplRegisterDto, FplLoginDto]) {
      const instance = plainToInstance(dto, { fplId: 123456, password: 'abc123' });
      await expect(validate(instance)).resolves.toHaveLength(0);
    }
  });

  it('rejects passwords shorter than six characters for registration and login', async () => {
    for (const dto of [FplRegisterDto, FplLoginDto]) {
      const instance = plainToInstance(dto, { fplId: 123456, password: '12345' });
      const errors = await validate(instance);
      expect(errors.find((error) => error.property === 'password')?.constraints).toHaveProperty('isLength');
    }
  });
});
