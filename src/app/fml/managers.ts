import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { finalize, Subscription } from 'rxjs';
import { Api, Auth, Notices } from './core';
import { FplLeague, League, Manager } from './models';

@Component({
  selector: 'app-managers',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-heading"><div><p class="eyebrow">SCOUTING NETWORK</p><h1>Manager directory</h1><p>Find the minds behind the points. Recruit your next captain.</p></div></div>
    <section class="panel">
      <h2>My FPL leagues</h2>
      <p>Choose a classic league retrieved from your FPL profile. Importing retrieves its managers and initializes their market values.</p>
      <div class="filter-bar">@for (league of auth.user()?.fplProfile?.leagues ?? []; track league.id) {
        <button mat-stroked-button type="button" (click)="importMyLeague(league)" [disabled]="importing()">{{league.name}} · #{{league.id}}</button>
      } @empty { <p>No classic leagues in your public FPL profile. You can import another public league below.</p> }</div>
      <form [formGroup]="importForm" (ngSubmit)="importLeague()" class="filter-bar">
        <mat-form-field><mat-label>Import FPL league ID</mat-label><input matInput type="number" min="1" formControlName="fplId"><mat-error>A positive integer league ID is required.</mat-error></mat-form-field><button mat-flat-button [disabled]="importing()">Import league</button>
      </form>
      <div class="filter-bar">
        <mat-form-field><mat-label>League</mat-label><mat-select [value]="leagueId()" (selectionChange)="selectLeague($event.value)">@for (league of leagues(); track league.id) { <mat-option [value]="league.id">{{league.name}}</mat-option> }</mat-select></mat-form-field>
        <mat-form-field><mat-label>Search managers</mat-label><input #searchInput matInput [value]="search()" (input)="search.set(searchInput.value)" type="search"></mat-form-field>
        <mat-form-field><mat-label>Sort by</mat-label><mat-select [value]="sort()" (selectionChange)="sort.set($event.value)"><mat-option value="rank">Rank</mat-option><mat-option value="price">Lowest price</mat-option><mat-option value="points">Gameweek points</mat-option><mat-option value="form">Form</mat-option></mat-select></mat-form-field>
      </div>
      @if (loading()) { <p role="status">Loading managers…</p> }
      @if (failed()) { <p>Could not load managers. <button mat-button (click)="selectLeague(leagueId())">Retry</button></p> }
      <div class="table-scroll"><table><caption>Managers in the selected league</caption><thead><tr><th scope="col">Manager</th><th scope="col">Rank</th><th scope="col">GW points</th><th scope="col">Form</th><th scope="col">Price</th><th scope="col">History</th></tr></thead><tbody>
        @for (manager of filtered(); track manager.id) { <tr><th scope="row">{{manager.name}}</th><td>{{manager.rank | number}}</td><td>{{manager.gwPoints}}</td><td>{{manager.form}}</td><td>{{manager.price / 10 | number:'1.1-1'}}M</td><td><button mat-button (click)="history.set(manager)">Price history</button></td></tr> }
      </tbody></table></div>
      @if (!loading() && !failed() && filtered().length === 0) { <p class="empty">No managers found. Choose a league or import one from FPL.</p> }
    </section>
    @if (history(); as manager) {
      <section class="panel history" aria-labelledby="history-title"><h2 id="history-title">{{manager.name}} · price history</h2>
        @if (manager.priceHistory?.length) {
          <div class="history-chart" role="img" [attr.aria-label]="'Server supplied price history for ' + manager.name">
            @for (point of manager.priceHistory; track $index) { <div class="history-column"><span>{{point.price / 10 | number:'1.1-1'}}M</span><div class="history-bar" [style.height.px]="point.price * 3"></div>            <span>GW {{point.gw}}</span></div> }
          </div>
          <details><summary>History data</summary><ul>@for (point of manager.priceHistory; track point.gw) { <li>Gameweek {{point.gw}}: {{point.price / 10 | number:'1.1-1'}}M</li> }</ul></details>
        } @else { <p>No price history supplied by the server for this manager yet.</p> }
        <button mat-button (click)="history.set(null)">Close history</button>
      </section>
    }
  `,
})
export class ManagersPage {
  readonly auth = inject(Auth);
  private readonly api = inject(Api);
  private readonly notices = inject(Notices);
  private readonly destroyRef = inject(DestroyRef);
  private managerRequest?: Subscription;
  readonly leagues = signal<League[]>([]);
  readonly managers = signal<Manager[]>([]);
  readonly leagueId = signal('');
  readonly loading = signal(false);
  readonly failed = signal(false);
  readonly importing = signal(false);
  readonly search = signal('');
  readonly sort = signal<'rank' | 'price' | 'points' | 'form'>('rank');
  readonly history = signal<Manager | null>(null);
  readonly importForm = inject(FormBuilder).nonNullable.group({
    fplId: [1, [Validators.required, Validators.min(1), Validators.pattern(/^\d+$/)]],
  });
  readonly filtered = computed(() => {
    const rows = this.managers().filter(m => m.name.toLowerCase().includes(this.search().toLowerCase()));
    const sort = this.sort();
    return [...rows].sort((a, b) => sort === 'price' ? a.price - b.price : sort === 'points' ? b.gwPoints - a.gwPoints : sort === 'form' ? b.form - a.form : a.rank - b.rank);
  });
  constructor() {
    this.api.get<League[]>('leagues').subscribe({ next: rows => { this.leagues.set(rows); if (rows[0]) this.selectLeague(rows[0].id); }, error: () => this.failed.set(true) });
  }
  selectLeague(id: string): void {
    if (!id) return;
    this.managerRequest?.unsubscribe();
    this.leagueId.set(id);
    this.managers.set([]);
    this.history.set(null);
    this.failed.set(false);
    this.loading.set(true);
    this.managerRequest = this.api.get<Manager[]>(`managers?leagueId=${encodeURIComponent(id)}`)
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.loading.set(false)))
      .subscribe({ next: rows => this.managers.set(rows), error: () => this.failed.set(true) });
  }
  importLeague(): void {
    this.importForm.markAllAsTouched();
    if (this.importForm.invalid || this.importing()) return;
    this.importing.set(true);
    this.api.post<League>('leagues', this.importForm.getRawValue()).pipe(finalize(() => this.importing.set(false))).subscribe({
      next: league => {
        this.leagues.update(rows => [...rows.filter(row => row.id !== league.id), league]);
        this.selectLeague(league.id);
        this.notices.message.set('League imported.');
      },
      error: () => {},
    });
  }
  importMyLeague(league: FplLeague): void {
    if (this.importing()) return;
    const imported = this.leagues().find(row => row.fplId === league.id);
    if (imported) { this.selectLeague(imported.id); return; }
    this.importForm.controls.fplId.setValue(league.id);
    this.importLeague();
  }
}
