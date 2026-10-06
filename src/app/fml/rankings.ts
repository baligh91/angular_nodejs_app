import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { finalize, forkJoin, Subscription } from 'rxjs';
import { Api } from './core';
import { Gameweek, League, Ranking } from './models';

@Component({
  selector: 'app-rankings',
  imports: [DecimalPipe, RouterLink, MatButtonModule, MatFormFieldModule, MatSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-heading"><div><p class="eyebrow">THE LEADERBOARD</p><h1>Race to the top</h1><p>Real standings. Every manager, every point, every gameweek.</p></div></div>
    <section class="panel">
      <div class="filter-bar">
        <mat-form-field><mat-label>League</mat-label>        <mat-select [value]="leagueId()" (selectionChange)="leagueId.set($event.value); load()"><mat-option value="">Worldwide</mat-option>@for (league of leagues(); track league.id) { <mat-option [value]="league.id">{{league.name}}</mat-option> }</mat-select></mat-form-field>
        <mat-form-field><mat-label>Standings</mat-label><mat-select [value]="period()" (selectionChange)="period.set($event.value); load()"><mat-option value="overall">Overall</mat-option>@for (gw of gameweeks(); track gw.id) { <mat-option [value]="''+gw.id">Gameweek {{gw.id}}</mat-option> }</mat-select></mat-form-field>
      </div>
      @if (loading()) { <p role="status">Loading standings…</p> }
      @if (failed()) { <p>Standings unavailable. <button mat-button (click)="load()">Retry</button></p> }
      <div class="table-scroll"><table><caption>{{period() === 'overall' ? 'Overall rankings' : 'Gameweek ' + period() + ' rankings'}}</caption><thead><tr><th scope="col">Rank</th><th scope="col">Team</th><th scope="col">Owner</th><th scope="col">Points</th></tr></thead><tbody>
        @for (row of rows(); track row.teamId) { <tr><td><span [class.podium]="row.rank <= 3">#{{row.rank}}</span></td><th scope="row"><a [routerLink]="['/fml/team',row.teamId]">{{row.teamName}}</a></th><td>{{row.pseudo}}</td><td class="points">{{row.points | number}}</td></tr> }
      </tbody></table></div>
      @if (!loading() && !failed() && rows().length === 0) { <p class="empty">No rankings available for this league and period yet.</p> }
    </section>
  `,
})
export class RankingsPage {
  private readonly api = inject(Api);
  private readonly destroyRef = inject(DestroyRef);
  private request?: Subscription;
  readonly leagues = signal<League[]>([]);
  readonly gameweeks = signal<Gameweek[]>([]);
  readonly leagueId = signal('');
  readonly period = signal('overall');
  readonly rows = signal<Ranking[]>([]);
  readonly loading = signal(false);
  readonly failed = signal(false);
  constructor() {
    forkJoin({ leagues: this.api.get<League[]>('leagues'), gameweeks: this.api.get<Gameweek[]>('gameweeks') }).subscribe({
      next: data => { this.leagues.set(data.leagues); this.gameweeks.set(data.gameweeks); this.load(); },
      error: () => this.failed.set(true),
    });
  }
  load(): void {
    this.request?.unsubscribe();
    this.rows.set([]);
    this.loading.set(true);
    this.failed.set(false);
    const path = this.period() === 'overall' ? 'rankings/overall' : `rankings/gw/${encodeURIComponent(this.period())}`;
    const query = this.leagueId() ? `?leagueId=${encodeURIComponent(this.leagueId())}` : '';
    this.request = this.api.get<Ranking[]>(`${path}${query}`)
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.loading.set(false)))
      .subscribe({ next: rows => this.rows.set(rows), error: () => this.failed.set(true) });
  }
}
