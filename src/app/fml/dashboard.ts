import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { forkJoin, finalize } from 'rxjs';
import { Api, Auth } from './core';
import { Gameweek, Team, selectionCost } from './models';
import { FplProfileCard } from './fpl-profile-card';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, MatButtonModule, DatePipe, DecimalPipe, FplProfileCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-heading"><div><p class="eyebrow">YOUR CLUBHOUSE</p><h1>Welcome back, {{auth.user()?.pseudo}}</h1><p>Build a squad of exceptional FPL managers.</p></div><a mat-flat-button routerLink="/fml/team/new">Create a team</a></div>
    @if (auth.user(); as user) { <app-fpl-profile-card [profile]="user.fplProfile" /> }
    @if (loading()) { <p role="status">Loading your clubhouse…</p> }
    @if (failed()) { <div class="panel"><p>Could not load your dashboard.</p><button mat-button (click)="load()">Retry</button></div> }
    @for (gw of gameweeks(); track gw.id) {
      @if (gw.current) { <section class="deadline panel"><p class="eyebrow">GAMEWEEK {{gw.id}}</p><h2>{{gw.finished ? 'Gameweek complete' : 'Official FPL deadline'}}</h2><p>{{gw.deadline | date:'medium'}} (your local time)</p><p>Team edits are locked from the official deadline until the gameweek finishes.</p></section> }
    }
    <h2>My teams</h2>
    <div class="card-grid">
      @for (team of teams(); track team.id) {
        <article class="panel team-card">
          <span class="tag">{{team.format}} managers</span><h3>{{team.name}}</h3>
          <div class="stat-row"><div><strong>{{team.points | number}}</strong><span>Total points</span></div><div><strong>{{team.rank ? '#' + team.rank : 'Not ranked'}}</strong><span>Rank</span></div></div>
          <p>Budget remaining: {{(team.budget - team.spent) / 10 | number:'1.1-1'}}M</p>
          <p>Current squad value: {{teamValue(team) / 10 | number:'1.1-1'}}M</p>
          <ul>@for (manager of team.members; track manager.id) { <li>{{manager.name}} @if (manager.id === team.captainId) { <span class="tag">Captain</span> }</li> }</ul>
          <a mat-button [routerLink]="['/fml/team',team.id]">View squad</a><a mat-button [routerLink]="['/fml/team',team.id,'edit']">Edit team</a>
        </article>
      } @empty { @if (!loading() && !failed()) { <div class="panel empty"><h3>Your story starts here</h3><p>No teams yet. Draft your first squad to join the competition.</p><a mat-flat-button routerLink="/fml/team/new">Build a team</a></div> } }
    </div>
  `,
})
export class Dashboard {
  readonly auth = inject(Auth);
  private readonly api = inject(Api);
  readonly teams = signal<Team[]>([]);
  readonly gameweeks = signal<Gameweek[]>([]);
  readonly loading = signal(false);
  readonly failed = signal(false);
  constructor() { this.load(); }
  teamValue(team: Team): number { return selectionCost(team.members); }
  load(): void {
    this.loading.set(true);
    this.failed.set(false);
    forkJoin({ teams: this.api.get<Team[]>('teams/mine'), gameweeks: this.api.get<Gameweek[]>('gameweeks') })
      .pipe(finalize(() => this.loading.set(false))).subscribe({
        next: data => { this.teams.set(data.teams); this.gameweeks.set(data.gameweeks); },
        error: () => this.failed.set(true),
      });
  }
}
