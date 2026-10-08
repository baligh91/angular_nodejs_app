import { FORMATS, initialPrice, teamPoints } from './rules';

describe('fantasy domain rules', () => {
  it('prices initial ranking linearly from 10M to 1M, including singleton', () => {
    expect(initialPrice(1, 10)).toBe(100);
    expect(initialPrice(10, 10)).toBe(10);
    expect(initialPrice(5, 9)).toBe(55);
    expect(initialPrice(1, 1)).toBe(100);
  });
  it('keeps only the five-manager format with a 25M budget', () => {
    expect(FORMATS).toEqual({ 5: 250 });
  });
  it('doubles only the captain and sums negative points', () => {
    expect(teamPoints(['a', 'b'], 'a', new Map([['a', 10], ['b', -2]]))).toBe(18);
  });
});
