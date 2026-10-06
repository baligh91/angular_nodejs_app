import { ExclusiveRecruitment, initialPrice, nextPrice, NonexclusiveRecruitment, priceDeltas, teamPoints } from './rules';

describe('fantasy domain rules', () => {
  it('prices initial ranking linearly from 10M to 1M, including singleton', () => {
    expect(initialPrice(1, 10)).toBe(100);
    expect(initialPrice(10, 10)).toBe(10);
    expect(initialPrice(5, 9)).toBe(55);
    expect(initialPrice(1, 1)).toBe(100);
  });
  it('applies percentile bands and clamps prices', () => {
    const data = Array.from({ length: 10 }, (_, i) => ({ id: String(i), gwPoints: 100 - i, form: 100 - i }));
    const deltas = priceDeltas(data);
    expect([...deltas.values()]).toEqual([2, 1, 1, 0, 0, 0, 0, -1, -1, -2]);
    expect(nextPrice(149, 2)).toBe(150);
    expect(nextPrice(10, -2)).toBe(10);
  });
  it('uses mean of score and form, preserving ties symmetrically', () => {
    expect([...priceDeltas([
      { id: 'a', gwPoints: 100, form: 0 }, { id: 'b', gwPoints: 0, form: 100 },
    ]).values()]).toEqual([0, 0]);
    expect(priceDeltas([]).size).toBe(0);
    expect(priceDeltas([{ id: 'a', gwPoints: 1, form: 1 }]).get('a')).toBe(0);
  });
  it('doubles only the captain and sums negative points', () => {
    expect(teamPoints(['a', 'b'], 'a', new Map([['a', 10], ['b', -2]]))).toBe(18);
  });
  it('supports selectable nonexclusive and future exclusive recruitment', () => {
    expect(new NonexclusiveRecruitment().canRecruit()).toBe(true);
    expect(new ExclusiveRecruitment().canRecruit('a', new Set(['a']))).toBe(false);
    expect(new ExclusiveRecruitment().canRecruit('b', new Set(['a']))).toBe(true);
  });
});
