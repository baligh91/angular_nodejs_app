import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { finalize, Subscription } from 'rxjs';
import { Api } from './core';
import { Team, TeamHistory, selectionCost } from './models';
import { HistoryChart } from './history-chart';

@Component({
  selector: 'app-team-view',
  imports: [DecimalPipe, RouterLink, MatButtonModule, HistoryChart],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) { <p role="status">Loading squad…</p> }
    @if (failed()) { <p>Squad unavailable. <button mat-button (click)="load()">Retry</button></p> }
    @if (team(); as squad) {
      <div class="page-heading"><div><p class="eyebrow">{{squad.format}}-MANAGER SQUAD</p><h1>{{squad.name}}</h1><p>Captain earns double points.</p></div><a mat-button routerLink="/fml">Back to dashboard</a></div>
      <div class="stats-grid"><div class="panel"><span>Season points</span><strong>{{squad.points | number}}</strong></div><div class="panel"><span>Overall league rank</span><strong>{{squad.rank ? '#' + squad.rank : 'Not ranked'}}</strong></div><div class="panel"><span>Budget remaining</span><strong>{{(squad.budget - squad.spent) / 10 | number:'1.1-1'}}M</strong><span>Current squad value: {{value() / 10 | number:'1.1-1'}}M</span></div></div>
      @if (latest(); as gw) { <p>Last completed GW {{gw.gw}}: <strong>{{gw.points | number}} points</strong>. Scores below are live manager points, not a settled team score.</p> }
      <section class="pitch" aria-label="Team squad"><div class="pitch-line" aria-hidden="true"></div><div class="squad-grid">@for (manager of squad.members; track manager.id) { <article class="squad-player"><div class="player-shirt" aria-hidden="true">{{manager.id === squad.captainId ? 'C' : 'FML'}}</div><h2>{{manager.name}}</h2>@if (manager.id === squad.captainId) { <span class="tag">Captain · 2×</span> }<p>{{manager.gwPoints}} GW points · {{manager.price / 10 | number:'1.1-1'}}M</p></article> } @empty { <p>Member details not supplied by the server.</p> }</div></section>
      @if (historyLoading()) { <p role="status">Loading completed gameweek history...</p> }
      @if (historyFailed()) { <p>History unavailable. <button mat-button (click)="loadHistory()">Retry history</button></p> }
      @if (!historyLoading() && !historyFailed()) {
        <app-history-chart title="Overall league rank progression" [points]="rankHistory()" [reversed]="true" unit="rank" />
        <app-history-chart title="Squad value at each completed gameweek" [points]="valueHistory()" unit="M" />
        <app-history-chart title="Gameweek points" [points]="pointsHistory()" unit="points" />
      }
    }
  `,
})
export class TeamView {
  private readonly api = inject(Api);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private id = '';
  private request?: Subscription;
  private historyRequest?: Subscription;
  readonly team = signal<Team | null>(null);
  readonly loading = signal(false);
  readonly failed = signal(false);
  readonly history = signal<TeamHistory[]>([]);
  readonly historyLoading = signal(false);
  readonly historyFailed = signal(false);
  readonly value = computed(() => selectionCost(this.team()?.members ?? []));
  readonly latest = computed(() => this.history().at(-1));
  readonly rankHistory = computed(() => this.history().map(point => ({ gw: point.gw, value: point.rank })));
  readonly valueHistory = computed(() => this.history().map(point => ({ gw: point.gw, value: point.teamValue / 10 })));
  readonly pointsHistory = computed(() => this.history().map(point => ({ gw: point.gw, value: point.points })));
  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(params => {
      this.id = params.get('id') ?? '';
      this.team.set(null);
      this.load();
      this.loadHistory();
    });
  }
  load(): void {
    this.request?.unsubscribe();
    this.loading.set(true);
    this.failed.set(false);
    this.request = this.api.get<Team>(`teams/${encodeURIComponent(this.id)}`)
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.loading.set(false)))
      .subscribe({ next: team => this.team.set(team), error: () => this.failed.set(true) });
  }
  loadHistory(): void {
    this.historyRequest?.unsubscribe();
    this.history.set([]);
    this.historyLoading.set(true);
    this.historyFailed.set(false);
    this.historyRequest = this.api.get<TeamHistory[]>(`teams/${encodeURIComponent(this.id)}/history`)
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.historyLoading.set(false)))
      .subscribe({ next: history => this.history.set(history), error: () => this.historyFailed.set(true) });
  }
}
