/// <reference types="jest" />
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { Config } from './config';

describe('backend configuration', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'test', JWT_SECRET: 'configuration-test-secret-at-least-32-characters' };
  });
  afterEach(() => { process.env = originalEnv; });
  it('defaults to the local API and Mongo database', () => {
    const config = new Config();
    expect(config.port).toBe(3000);
    expect(config.mongoUri).toBe('mongodb://127.0.0.1:27017/fml');
    expect(config.origin).toBe('http://localhost:4200');
  });
});
