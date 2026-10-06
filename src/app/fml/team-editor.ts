import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, forkJoin, of, Subscription } from 'rxjs';
import { Api, Notices } from './core';
import { BUDGETS, Format, Gameweek, League, Manager, Team, editsLocked, selectionCost } from './models';

@Component({
  selector: 'app-team-editor',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, DecimalPipe, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-heading"><div><p class="eyebrow">BUILD YOUR LEGACY</p><h1>{{id ? 'Edit your team' : 'Draft your team'}}</h1><p>Choose your format, recruit managers, and name your captain.</p></div></div>
    @if (loading()) { <p role="status">Loading draft data…</p> }
    @if (failed()) { <p role="alert">Draft data unavailable. <button mat-button (click)="load()">Retry</button></p> }
    @if (locked()) { <p role="alert" class="notice">The official FPL deadline has passed. Team changes are locked until the current gameweek finishes.</p> }
    @for (gw of gameweeks(); track gw.id) { @if (gw.current) { <p>Gameweek {{gw.id}} deadline: {{gw.deadline | date:'medium'}}. Edits close at the deadline and reopen when finished.</p> } }
    <form [formGroup]="form" (ngSubmit)="save()" class="editor-layout">
      <section class="panel">
        <div class="form-stack">
          <mat-form-field><mat-label>Team name</mat-label><input matInput formControlName="name" maxlength="60"><mat-error>A team name (2–60 characters) is required.</mat-error></mat-form-field>
          <mat-form-field><mat-label>League</mat-label><mat-select formControlName="leagueId" (selectionChange)="changeLeague()">@for (league of leagues(); track league.id) { <mat-option [value]="league.id">{{league.name}}</mat-option> }</mat-select><mat-error>Select a league.</mat-error></mat-form-field>
          <mat-form-field><mat-label>Squad format</mat-label><mat-select formControlName="format">@for (format of formats; track format) { <mat-option [value]="format">{{format}} managers · {{budgets[format] / 10}}M</mat-option> }</mat-select></mat-form-field>
        </div>
        <h2>Available managers</h2><p>Prices are in millions. Select exactly {{format()}} managers.</p>
        @if (managersLoading()) { <p role="status">Loading managers…</p> }
        <div class="manager-list">
          @for (manager of managers(); track manager.id) {
            <label class="manager-row" [class.selected]="selectedIds().includes(manager.id)">
              <input type="checkbox" [checked]="selectedIds().includes(manager.id)" [disabled]="locked() || managersLoading()" (change)="toggle(manager.id)">
              <span><strong>{{manager.name}}</strong><small>Rank #{{manager.rank}} · GW {{manager.gwPoints}} · Form {{manager.form}}</small></span><strong>{{manager.price / 10 | number:'1.1-1'}}M</strong>
            </label>
          } @empty { @if (!managersLoading()) { <p class="empty">No managers available. Select or import a league in the managers directory.</p> } }
        </div>
      </section>
      <aside class="panel draft-summary">
        <h2>Squad summary</h2><p>{{selectedIds().length}} / {{format()}} selected</p><strong class="budget" [class.over-budget]="spent() > budget()">{{(budget() - spent()) / 10 | number:'1.1-1'}}M</strong><p>Remaining of {{budget() / 10}}M</p><progress aria-label="Budget used" [value]="spent()" [max]="budget()"></progress>
        @for (manager of selected(); track manager.id) { <p>{{manager.name}} <span class="float-right">{{manager.price / 10 | number:'1.1-1'}}M</span></p> }
        <mat-form-field><mat-label>Captain (double points)</mat-label><mat-select formControlName="captainId">@for (manager of selected(); track manager.id) { <mat-option [value]="manager.id">{{manager.name}}</mat-option> }</mat-select><mat-error>Select a captain from your squad.</mat-error></mat-form-field>
        @if (validation()) { <p role="status">{{validation()}}</p> }
        <button mat-flat-button type="submit" [disabled]="busy() || loading() || failed() || managersLoading() || locked() || !!validation()">{{busy() ? 'Saving…' : 'Save team'}}</button>
      </aside>
    </form>
  `,
})
export class TeamEditor {
  private readonly api = inject(Api);
  private readonly notices = inject(Notices);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private managerRequest?: Subscription;
  readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id');
  readonly formats: Format[] = [5, 7, 11];
  readonly budgets = BUDGETS;
  readonly leagues = signal<League[]>([]);
  readonly gameweeks = signal<Gameweek[]>([]);
  readonly managers = signal<Manager[]>([]);
  readonly selectedIds = signal<string[]>([]);
  readonly loading = signal(true);
  readonly managersLoading = signal(false);
  readonly failed = signal(false);
  readonly busy = signal(false);
  readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
    leagueId: ['', Validators.required],
    format: [5 as Format, Validators.required],
    captainId: ['', Validators.required],
  });
  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  readonly format = computed(() => this.formValue().format ?? 5);
  readonly budget = computed(() => BUDGETS[this.format()]);
  readonly selected = computed(() => this.managers().filter(m => this.selectedIds().includes(m.id)));
  readonly spent = computed(() => selectionCost(this.selected()));
  readonly locked = signal(false);
  readonly validation = computed(() => {
    if (!this.gameweeks().length) return 'Official gameweeks must be synchronized before creating a team.';
    if (this.selectedIds().length !== this.format()) return `Select exactly ${this.format()} managers.`;
    if (this.selected().length !== this.selectedIds().length) return 'Some selected managers are no longer available.';
    if (this.spent() > this.budget()) return 'Your squad exceeds the budget.';
    if (!this.selectedIds().includes(this.formValue().captainId ?? '')) return 'Choose a captain from your squad.';
    return '';
  });
  constructor() {
    // Recheck the deadline when interacting, not only when opening the editor.
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.updateLock());
    this.load();
  }
  load(): void {
    this.loading.set(true);
    this.failed.set(false);
    forkJoin({
      leagues: this.api.get<League[]>('leagues'),
      gameweeks: this.api.get<Gameweek[]>('gameweeks'),
      team: this.id ? this.api.get<Team>(`teams/${encodeURIComponent(this.id)}`) : of(null),
    }).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: data => {
        this.leagues.set(data.leagues);
        this.gameweeks.set(data.gameweeks);
        this.updateLock();
        if (data.team) {
          const { name, leagueId, format, captainId } = data.team;
          this.form.patchValue({ name, leagueId, format, captainId });
          this.form.controls.leagueId.disable();
          this.selectedIds.set(data.team.managerIds);
          this.loadManagers(leagueId);
        }
      },
      error: () => this.failed.set(true),
    });
  }
  private updateLock(): void { this.locked.set(editsLocked(this.gameweeks())); }
  changeLeague(): void {
    this.selectedIds.set([]);
    this.form.controls.captainId.setValue('');
    this.loadManagers(this.form.controls.leagueId.value);
  }
  private loadManagers(leagueId: string): void {
    this.managerRequest?.unsubscribe();
    this.managers.set([]);
    this.managersLoading.set(true);
    this.managerRequest = this.api.get<Manager[]>(`managers?leagueId=${encodeURIComponent(leagueId)}`)
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.managersLoading.set(false)))
      .subscribe({ next: rows => this.managers.set(rows), error: () => {} });
  }
  toggle(id: string): void {
    this.updateLock();
    if (this.locked()) return;
    this.selectedIds.update(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]);
    if (!this.selectedIds().includes(this.form.controls.captainId.value)) this.form.controls.captainId.setValue('');
  }
  save(): void {
    this.updateLock();
    this.form.markAllAsTouched();
    if (this.form.invalid || this.validation() || this.locked() || this.busy() || this.loading() || this.failed() || this.managersLoading()) return;
    this.busy.set(true);
    const body = { ...this.form.getRawValue(), managerIds: this.selectedIds() };
    const request = this.id ? this.api.put<Team>(`teams/${encodeURIComponent(this.id)}`, body) : this.api.post<Team>('teams', body);
    request.pipe(finalize(() => this.busy.set(false))).subscribe({
      next: () => { this.notices.message.set('Team saved.'); void this.router.navigate(['/fml']); },
      error: () => {},
    });
  }
}
