import { BUDGETS, Manager, selectionCost } from './models';

describe('FML squad rules', () => {
  it('uses a 25M budget for the only supported squad format', () => {
    expect(BUDGETS).toEqual({ 5: 250 });
  });
  it('adds manager prices without floating-point conversion or captain surcharge', () => {
    const managers: Manager[] = [
      { id: 1, fplId: 1, name: 'One', rank: 1, totalPoints: 20, lastGwPoints: 20, gwPoints: 20, form: 5, price: 51 },
      { id: 2, fplId: 2, name: 'Two', rank: 2, totalPoints: 10, lastGwPoints: 10, gwPoints: 10, form: 4, price: 49 },
    ];
    expect(selectionCost(managers)).toBe(100);
    expect(selectionCost([])).toBe(0);
  });
});
