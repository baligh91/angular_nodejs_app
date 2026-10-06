import { BUDGETS, Manager, editsLocked, selectionCost } from './models';

describe('FML squad rules', () => {
  it('uses integer tenths of a million for each format budget', () => {
    expect(BUDGETS).toEqual({ 5: 250, 7: 300, 11: 500 });
  });
  it('adds manager prices without floating-point conversion or captain surcharge', () => {
    const managers: Manager[] = [
      { id: '1', fplId: 1, name: 'One', rank: 1, gwPoints: 20, form: 5, price: 51 },
      { id: '2', fplId: 2, name: 'Two', rank: 2, gwPoints: 10, form: 4, price: 49 },
    ];
    expect(selectionCost(managers)).toBe(100);
    expect(selectionCost([])).toBe(0);
  });
  it('locks at the official deadline until the current gameweek finishes', () => {
    const gw = { id: 1, current: true, finished: false, deadline: '2026-10-06T12:00:00Z' };
    const deadline = Date.parse(gw.deadline);
    expect(editsLocked([gw], deadline - 1)).toBe(false);
    expect(editsLocked([gw], deadline)).toBe(true);
    expect(editsLocked([{ ...gw, finished: true }], deadline + 1)).toBe(false);
    expect(editsLocked([{ ...gw, current: false }], deadline + 1)).toBe(true);
  });
});
