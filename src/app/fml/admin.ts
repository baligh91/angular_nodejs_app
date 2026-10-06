import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { finalize, forkJoin } from 'rxjs';
import { Api, Auth, Notices } from './core';
import { Gameweek, League, User } from './models';

@Component({
  selector: 'app-admin',
  imports: [MatButtonModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-heading"><div><p class="eyebrow">CONTROL ROOM</p><h1>League administration</h1><p>Synchronize official FPL data and manage access.</p></div><button mat-flat-button (click)="sync()" [disabled]="syncing()">{{syncing() ? 'Synchronizing…' : 'Sync FPL data'}}</button></div>
    @if (loading()) { <p role="status">Loading administration data…</p> }
    @if (failed()) { <p>Administration data unavailable. <button mat-button (click)="load()">Retry</button></p> }
    <section class="panel"><h2>Users</h2><div class="table-scroll"><table><caption>User access management</caption><thead><tr><th scope="col">Name</th>    <th scope="col">FPL ID</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead><tbody>
      @for (user of users(); track user.id) { <tr><th scope="row">{{user.pseudo}}</th>      <td>{{user.fplId}}</td><td>{{user.role}}</td><td>{{user.disabled ? 'Disabled' : 'Active'}}</td><td><button mat-button (click)="toggle(user)" [disabled]="changing() === user.id || user.id === auth.user()?.id">{{user.disabled ? 'Enable' : 'Disable'}}</button></td></tr> }
    </tbody></table></div>@if (!loading() && users().length === 0) { <p>No users returned.</p> }</section>
    <div class="card-grid"><section class="panel"><h2>Imported leagues</h2>@for (league of leagues(); track league.id) {     <p>{{league.name}} <span class="muted">FPL #{{league.fplId}} · {{league.active === false ? 'Disabled' : 'Active'}}</span><button mat-button (click)="toggleLeague(league)" [disabled]="!!changingLeague()">{{league.active === false ? 'Enable league' : 'Disable league'}}</button></p> } @empty { <p>No leagues returned.</p> }</section>
    <section class="panel"><h2>Gameweeks</h2>@for (gw of gameweeks(); track gw.id) { <p><strong>GW {{gw.id}}</strong> · {{gw.deadline | date:'medium'}} · {{gw.finished ? 'Finished' : gw.current ? 'Current' : 'Upcoming'}}</p> } @empty { <p>No gameweeks returned.</p> }</section></div>
  `,
})
export class AdminPage {
  readonly auth = inject(Auth);
  private readonly api = inject(Api);
  private readonly notices = inject(Notices);
  readonly users = signal<User[]>([]);
  readonly leagues = signal<League[]>([]);
  readonly gameweeks = signal<Gameweek[]>([]);
  readonly loading = signal(false);
  readonly failed = signal(false);
  readonly syncing = signal(false);
  readonly changing = signal('');
  readonly changingLeague = signal('');
  constructor() { this.load(); }
  load(): void {
    this.loading.set(true);
    this.failed.set(false);
    forkJoin({ users: this.api.get<User[]>('admin/users'), leagues: this.api.get<League[]>('admin/leagues'), gameweeks: this.api.get<Gameweek[]>('admin/gameweeks') })
      .pipe(finalize(() => this.loading.set(false))).subscribe({
        next: data => { this.users.set(data.users); this.leagues.set(data.leagues); this.gameweeks.set(data.gameweeks); },
        error: () => this.failed.set(true),
      });
  }
  sync(): void {
    if (this.syncing()) return;
    this.syncing.set(true);
    this.api.post('admin/sync', {}).pipe(finalize(() => this.syncing.set(false))).subscribe({
      next: () => { this.notices.message.set('FPL synchronization completed.'); this.load(); },
      error: () => {},
    });
  }
  toggle(user: User): void {
    if (this.changing()) return;
    this.changing.set(user.id);
    this.api.patch<User>(`admin/users/${encodeURIComponent(user.id)}`, { disabled: !user.disabled })
      .pipe(finalize(() => this.changing.set(''))).subscribe({
        next: () => { this.notices.message.set('User access updated.'); this.load(); },
        error: () => {},
      });
  }
  toggleLeague(league: League): void {
    if (this.changingLeague()) return;
    this.changingLeague.set(league.id);
    this.api.patch<League>(`admin/leagues/${encodeURIComponent(league.id)}`, { active: league.active === false })
      .pipe(finalize(() => this.changingLeague.set(''))).subscribe({
        next: () => { this.notices.message.set('League status updated.'); this.load(); },
        error: () => {},
      });
  }
}
