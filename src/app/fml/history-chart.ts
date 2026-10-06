import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export interface ChartPoint { gw: number; value: number }

export function chartCoordinates(points: readonly ChartPoint[], reversed = false): string {
  if (!points.length) return '';
  const values = points.map(point => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return points.map((point, index) => {
    const x = points.length === 1 ? 300 : 20 + index * 560 / (points.length - 1);
    const normalized = max === min ? 0.5 : (point.value - min) / (max - min);
    const y = 20 + (reversed ? normalized : 1 - normalized) * 140;
    return `${x},${y}`;
  }).join(' ');
}

@Component({
  selector: 'app-history-chart',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel">
      <h2>{{title()}}</h2>
      @if (points().length) {
        <svg viewBox="0 0 600 180" role="img" [attr.aria-label]="title() + '. Detailed values follow below.'" class="trend-chart">
          <line x1="20" y1="160" x2="580" y2="160" stroke="currentColor" opacity=".3" />
          <polyline [attr.points]="coordinates()" fill="none" stroke="#00d084" stroke-width="3" />
          @if (points().length === 1) { <circle cx="300" cy="90" r="5" fill="#00d084" /> }
        </svg>
        <p class="muted">GW {{points()[0].gw}} to GW {{points()[points().length - 1].gw}}. {{reversed() ? 'Lower ranks are better.' : ''}}</p>
        <div class="table-scroll">
          <table><caption>{{title()}}: exact values</caption>
            <thead><tr><th scope="col">Gameweek</th><th scope="col">{{unit() || 'Value'}}</th></tr></thead>
            <tbody>@for (point of points(); track point.gw) {
              <tr><th scope="row">GW {{point.gw}}</th><td>{{point.value | number:'1.0-1'}} {{unit()}}</td></tr>
            }</tbody>
          </table>
        </div>
      } @else { <p>No completed gameweek history yet.</p> }
    </section>
  `,
})
export class HistoryChart {
  readonly title = input.required<string>();
  readonly points = input.required<readonly ChartPoint[]>();
  readonly unit = input('');
  readonly reversed = input(false);
  readonly coordinates = computed(() => chartCoordinates(this.points(), this.reversed()));
}
