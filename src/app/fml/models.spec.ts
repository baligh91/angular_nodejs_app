import { BUDGETS, Manager, selectionCost, squadBudget } from './models';

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
  it('uses net gains of all owned managers, independently of the transfer selection', () => {
    const owned: Manager[] = [
      { id: 1, fplId: 1, name: 'One', rank: 1, totalPoints: 20, lastGwPoints: 20, gwPoints: 20, form: 5, price: 29 },
      { id: 2, fplId: 2, name: 'Two', rank: 2, totalPoints: 10, lastGwPoints: 10, gwPoints: 10, form: 4, price: 15 },
    ];
    const current = [
      { ...owned[0], price: 100 }, { ...owned[1], price: 10 },
      { id: 3, fplId: 3, name: 'Three', rank: 3, totalPoints: 0, lastGwPoints: 0, gwPoints: 0, form: 0, price: 24 },
    ];
    expect(squadBudget(current, owned)).toBe(316);
    expect(squadBudget([], [])).toBe(250);
    expect(squadBudget([{ ...owned[0], price: 59 }], [owned[0]])).toBe(280);
    expect(squadBudget([{ ...owned[0], price: 49 }], [owned[0]])).toBe(270);
    expect(squadBudget([{ ...owned[0], price: 9 }], [owned[0]])).toBe(250);
    expect(squadBudget([], [], 280)).toBe(280);
  });
});
