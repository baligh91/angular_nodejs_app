import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { finalize } from 'rxjs';
import { Api } from './services/api.service';
import { Team, TeamStanding } from './models';

@Component({
  selector: 'app-dashboard',
  imports: [MatButtonModule, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly api = inject(Api);
  readonly team = signal<Team | null>(null);
  readonly standings = signal<TeamStanding[]>([]);
  readonly standingsFailed = signal(false);
  readonly loading = signal(false);
  readonly failed = signal(false);
  constructor() { this.load(); }
  load(): void {
    this.loading.set(true);
    this.failed.set(false);
    this.api.get<Team>('team').pipe(finalize(() => this.loading.set(false))).subscribe({
        next: team => {
          this.team.set(team);
          if (team.leagueFplId) this.loadStandings(team.leagueFplId);
        },
        error: () => this.failed.set(true),
      });
  }
  sync(): void {
    if (this.loading()) return;
    this.loading.set(true);
    this.api.post<Team>('team/sync', {}).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: team => {
        this.team.set(team);
        if (team.leagueFplId) this.loadStandings(team.leagueFplId);
      },
      error: () => this.failed.set(true),
    });
  }
  private loadStandings(leagueFplId: number): void {
    this.standingsFailed.set(false);
    this.api.get<TeamStanding[]>(`team/standings?leagueFplId=${encodeURIComponent(leagueFplId)}`).subscribe({
      next: standings => this.standings.set(standings),
      error: () => this.standingsFailed.set(true),
    });
  }
}
