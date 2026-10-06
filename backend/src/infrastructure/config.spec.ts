import { Config } from './config';

describe('FPL admin configuration', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'test', JWT_SECRET: 'configuration-test-secret-at-least-32-characters' };
    delete process.env.ADMIN_FPL_IDS;
  });
  afterEach(() => { process.env = originalEnv; });
  it('defaults to no operational administrators', () => {
    expect(new Config().adminFplIds).toEqual([]);
  });
  it('accepts explicitly configured FPL identities only', () => {
    process.env.ADMIN_FPL_IDS = '123, 456';
    expect(new Config().adminFplIds).toEqual([123, 456]);
    process.env.ADMIN_FPL_IDS = '123,not-an-id';
    expect(() => new Config()).toThrow('Invalid ADMIN_FPL_IDS');
  });
});
