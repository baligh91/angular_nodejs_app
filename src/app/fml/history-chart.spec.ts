import { chartCoordinates } from './history-chart';

describe('FML historical charts', () => {
  it('handles empty and single-value histories without invalid coordinates', () => {
    expect(chartCoordinates([])).toBe('');
    expect(chartCoordinates([{ gw: 1, value: 100 }])).toBe('300,90');
  });
  it('normalizes values while keeping better ranks at the top', () => {
    const points = [{ gw: 1, value: 3 }, { gw: 2, value: 1 }];
    expect(chartCoordinates(points)).toBe('20,20 580,160');
    expect(chartCoordinates(points, true)).toBe('20,160 580,20');
  });
  it('renders equal values on a level line', () => {
    expect(chartCoordinates([{ gw: 1, value: 0 }, { gw: 2, value: 0 }])).toBe('20,90 580,90');
  });
});
