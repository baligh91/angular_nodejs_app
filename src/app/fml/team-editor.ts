import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { finalize, forkJoin } from 'rxjs';
import { Api } from './services/api.service';
import { Notices } from './services/notices.service';
import { FplLeague, Manager, ManagerLeague, Team, TeamInput, selectionCost } from './models';

@Component({
  selector: 'app-team-editor',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './team-editor.html',
  styleUrl: './team-editor.scss',
})
export class TeamEditor {
  private readonly api = inject(Api);
  private readonly notices = inject(Notices);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly formBuilder = inject(FormBuilder);
  readonly budget = 250;
  readonly loading = signal(false);
  readonly managersLoading = signal(false);
  readonly leaguesLoading = signal(false);
  readonly busy = signal(false);
  readonly leagues = signal<FplLeague[]>([]);
  readonly selectedLeagueId = signal<number | null>(null);
  readonly leaguePickerOpen = signal(false);
  readonly selectedLeagueName = signal('');
  readonly managers = signal<Manager[]>([]);
  readonly selectedIds = signal<number[]>([]);
  readonly activeManagerId = signal<number | null>(null);
  readonly activeEmptySlot = signal<number | null>(null);
  readonly captainId = signal<number | null>(null);
  readonly team = signal<Team | null>(null);
  readonly deadlineElapsed = signal(false);
  private deadlineTimer?: ReturnType<typeof setTimeout>;
  readonly selectedLeague = computed(() => this.leagues().find((league) => league.id === this.selectedLeagueId())
    ?? (this.selectedLeagueId() ? { id: this.selectedLeagueId()!, name: this.selectedLeagueName() || `FPL league #${this.selectedLeagueId()}` } : null));
  readonly editingExistingTeam = computed(() => !!this.team()?.leagueFplId);
  readonly editsLocked = computed(() => (this.team()?.editsLocked ?? false) || this.deadlineElapsed());
  readonly form = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
    leagueFplId: [0, [Validators.required, Validators.min(1), Validators.max(Number.MAX_SAFE_INTEGER)]],
  });
  readonly selected = computed(() => this.managers().filter((manager) => this.selectedIds().includes(manager.fplId)));
  readonly pitchManagers = computed(() => {
    const selected = this.selected();
    const captain = selected.find((manager) => manager.fplId === this.captainId());
    return captain ? [captain, ...selected.filter((manager) => manager.fplId !== captain.fplId)] : selected;
  });
  readonly pitchSlots = computed(() => Array.from({ length: 5 }, (_, index) => this.pitchManagers()[index] ?? null));
  readonly activeManager = computed(() => this.selected().find((manager) => manager.fplId === this.activeManagerId()) ?? null);
  readonly suggestions = computed(() => {
    if (this.activeManagerId() === null && this.activeEmptySlot() === null) return [];
    return this.managers()
      .filter((manager) => !this.selectedIds().includes(manager.fplId))
      .sort((left, right) => left.rank - right.rank || right.gwPoints - left.gwPoints);
  });
  readonly spent = computed(() => selectionCost(this.selected()));
  readonly validation = computed(() => {
    if (this.selectedIds().length !== 5) return 'Select exactly five managers.';
    if (this.selected().length !== 5) return 'Load a league and select five available managers.';
    if (this.spent() > this.budget) return 'The squad exceeds the 25M budget.';
    if (!this.selectedIds().includes(this.captainId() ?? 0)) return 'Choose a captain from your squad.';
    return '';
  });

  constructor() {
    this.destroyRef.onDestroy(() => { if (this.deadlineTimer) clearTimeout(this.deadlineTimer); });
    this.loadTeam();
  }

  private scheduleDeadlineLock(deadline: string | null): void {
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    this.deadlineElapsed.set(false);
    if (!deadline) return;
    const delay = Date.parse(deadline) - Date.now();
    if (!Number.isFinite(delay) || delay <= 0) {
      this.deadlineElapsed.set(true);
      return;
    }
    this.deadlineTimer = setTimeout(() => this.deadlineElapsed.set(true), delay);
  }

  loadTeam(): void {
    this.loading.set(true);
    this.leaguesLoading.set(true);
    forkJoin({ team: this.api.get<Team>('team'), leagues: this.api.get<FplLeague[]>('team/leagues') })
      .pipe(finalize(() => { this.loading.set(false); this.leaguesLoading.set(false); }))
      .subscribe({
      next: ({ team, leagues }) => {
        this.team.set(team);
        this.scheduleDeadlineLock(team.currentDeadline);
        this.leagues.set(leagues);
        this.selectedLeagueName.set(team.leagueName);
        this.leaguePickerOpen.set(!team.leagueFplId);
        const leagueFplId = team.leagueFplId ?? 0;
        this.form.patchValue({ name: team.name, leagueFplId }, { emitEvent: false });
        if (team.leagueFplId) {
          this.selectedLeagueId.set(team.leagueFplId);
          this.selectedIds.set(team.managerIds);
          this.captainId.set(team.captainId);
        }
        if (leagueFplId) this.loadManagers(leagueFplId);
      },
      error: () => {},
    });
  }

  loadManagers(leagueFplId = this.form.controls.leagueFplId.value): void {
    if (!Number.isSafeInteger(leagueFplId) || leagueFplId < 1 || this.managersLoading()) return;
    this.selectedLeagueId.set(leagueFplId);
    this.leaguePickerOpen.set(false);
    this.managersLoading.set(true);
    this.api.get<ManagerLeague>(`team/managers?leagueFplId=${encodeURIComponent(leagueFplId)}`)
      .pipe(finalize(() => this.managersLoading.set(false)))
      .subscribe({
        next: (result) => {
          this.managers.set(result.managers);
          this.selectedLeagueName.set(result.leagueName);
          this.team.update((team) => team ? { ...team, leagueName: result.leagueName } : team);
          const available = new Set(result.managers.map((manager) => manager.fplId));
          this.selectedIds.update((ids) => ids.filter((id) => available.has(id)));
        },
        error: () => this.managers.set([]),
      });
  }

  changeLeague(leagueFplId: number): void {
    if (this.editingExistingTeam() || this.editsLocked()) return;
    if (leagueFplId === this.selectedLeagueId()) {
      this.leaguePickerOpen.set(false);
      return;
    }
    this.selectedLeagueName.set(this.leagues().find((league) => league.id === leagueFplId)?.name ?? '');
    this.form.controls.leagueFplId.setValue(leagueFplId);
    this.selectedIds.set([]);
    this.captainId.set(null);
    this.activeManagerId.set(null);
    this.activeEmptySlot.set(null);
    this.managers.set([]);
    this.loadManagers(leagueFplId);
  }

  selectManager(id: number): void {
    if (this.editsLocked()) return;
    this.activeEmptySlot.set(null);
    this.activeManagerId.set(this.activeManagerId() === id ? null : id);
  }

  selectEmptySlot(position: number): void {
    if (this.editsLocked()) return;
    this.activeManagerId.set(null);
    this.activeEmptySlot.set(this.activeEmptySlot() === position ? null : position);
  }

  addManager(id: number): void {
    if (!this.canAdd(id)) return;
    const manager = this.managers().find((candidate) => candidate.fplId === id);
    if (!manager) return;
    this.selectedIds.update((ids) => [...ids, id]);
    if (this.captainId() === null) this.captainId.set(id);
    this.activeEmptySlot.set(null);
  }

  removeManager(): void {
    if (this.editsLocked()) return;
    const id = this.activeManagerId();
    if (id === null) return;
    const selectedIds = this.selectedIds().filter((managerId) => managerId !== id);
    this.selectedIds.set(selectedIds);
    if (this.captainId() === id) this.captainId.set(selectedIds[0] ?? null);
    this.activeManagerId.set(null);
  }

  replaceManager(replacementId: number): void {
    if (this.editsLocked()) return;
    const id = this.activeManagerId();
    if (id === null || !this.canReplace(replacementId)) return;
    this.selectedIds.update((ids) => ids.map((managerId) => managerId === id ? replacementId : managerId));
    if (this.captainId() === id) this.captainId.set(replacementId);
    this.activeManagerId.set(null);
  }

  canReplace(replacementId: number): boolean {
    const active = this.activeManager();
    const replacement = this.managers().find((manager) => manager.fplId === replacementId);
    return !this.editsLocked() && !!active && !!replacement && this.spent() - active.price + replacement.price <= this.budget;
  }

  canAdd(managerId: number): boolean {
    const manager = this.managers().find((candidate) => candidate.fplId === managerId);
    return !this.editsLocked() && this.activeEmptySlot() !== null && this.selectedIds().length < 5
      && !!manager && this.spent() + manager.price <= this.budget;
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.validation() || this.busy() || this.managersLoading() || this.editsLocked()) return;
    this.busy.set(true);
    const body: TeamInput = {
      name: this.form.controls.name.value,
      leagueFplId: this.form.controls.leagueFplId.value,
      managerIds: this.selectedIds(),
      captainId: this.captainId()!,
    };
    this.api.put<Team>('team', body).pipe(finalize(() => this.busy.set(false))).subscribe({
      next: (team) => {
        this.notices.message.set('Your team was saved.');
        this.team.set(team);
        this.scheduleDeadlineLock(team.currentDeadline);
        void this.router.navigate(['/fml']);
      },
      error: () => {},
    });
  }
}
