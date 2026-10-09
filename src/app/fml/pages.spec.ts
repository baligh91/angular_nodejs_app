import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Dashboard } from './dashboard';
import { TeamEditor } from './team-editor';
import { FplConnect } from './fpl-connect';
import { Auth } from './services/auth.service';
import { Manager, Team } from './models';
import { fplSession } from './test-fixtures';

const managers: Manager[] = Array.from({ length: 20 }, (_, index) => ({
  id: 90000001 + index, fplId: 90000001 + index, name: `Manager ${index + 1}`,
  rank: index + 1, totalPoints: 1000 - index * 10, lastGwPoints: 10, gwPoints: 10,
  form: 10, price: [100, 95, 90, 85, 80, 75, 70, 65, 60, 57, 52, 48, 43, 38, 34, 29, 24, 19, 15, 10][index],
}));
const emptyTeam: Team = {
  id: 123456, name: '', leagueName: '', leagueFplId: null, format: 5,
  managerIds: [], captainId: null, budget: 250, spent: 0, members: [], scores: [], totalScore: 0,
  editsLocked: false, firstScoringGw: null, currentDeadline: null,
};

describe('single-document FML workflow', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('requires six password characters and shows the requirement below the field', () => {
    const fixture = TestBed.createComponent(FplConnect);
    const password = fixture.componentInstance.form.controls.password;
    password.setValue('12345');
    expect(password.hasError('minlength')).toBe(true);
    password.setValue('123456');
    expect(password.valid).toBe(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Use at least 6 characters.');
  });

  it('creates an account with an FPL ID and matching password', async () => {
    const fixture = TestBed.createComponent(FplConnect);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fixture.componentInstance.form.controls.fplId.setValue(123456);
    fixture.componentInstance.setMode('register');
    fixture.componentInstance.form.controls.password.setValue('abc123');
    fixture.componentInstance.form.controls.confirmPassword.setValue('abc123');
    fixture.componentInstance.submit();
    const request = http.expectOne('/api/auth/register');
    expect(request.request.body).toEqual({
      fplId: 123456, password: 'abc123',
    });
    request.flush(fplSession);
    expect(TestBed.inject(Auth).authenticated()).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/fml');
  });

  it('does not register when the passwords do not match', () => {
    const fixture = TestBed.createComponent(FplConnect);
    const page = fixture.componentInstance;
    page.form.controls.fplId.setValue(123456);
    page.setMode('register');
    page.form.controls.password.setValue('correct horse battery staple');
    page.form.controls.confirmPassword.setValue('different password');
    page.submit();
    http.expectNone('/api/auth/register');
  });

  it('opens player actions, removes or replaces a manager, and saves the five-player team', () => {
    const fixture = TestBed.createComponent(TeamEditor);
    http.expectOne('/api/team').flush(emptyTeam);
    http.expectOne('/api/team/leagues').flush([{ id: 999001, name: 'Public league' }]);
    const page = fixture.componentInstance;
    page.form.controls.name.setValue('My five');
    expect(page.selectedLeagueId()).toBeNull();
    page.changeLeague(999001);
    const pool = http.expectOne('/api/team/managers?leagueFplId=999001');
    pool.flush({ leagueFplId: 999001, leagueName: 'Public league', managers });
    const selected = managers.slice(-5);
    for (const manager of selected) {
      page.selectEmptySlot(page.selectedIds().length);
      page.addManager(manager.fplId);
    }
    page.captainId.set(selected[0].fplId);
    page.selectManager(selected[0].fplId);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Remove from team');
    expect(fixture.nativeElement.textContent).toContain('Replacement suggestions');
    expect(page.suggestions()).toHaveLength(managers.length - 5);
    expect(fixture.nativeElement.textContent).toContain('Total points');
    expect(fixture.nativeElement.textContent).toContain('Last GW');
    expect(fixture.nativeElement.querySelectorAll('.replacement-table tbody tr').length).toBe(managers.length - 5);
    page.removeManager();
    expect(page.selectedIds()).toHaveLength(4);
    expect(page.captainId()).toBe(selected[1].fplId);
    page.selectEmptySlot(4);
    expect(page.suggestions()).toHaveLength(managers.length - 4);
    page.addManager(selected[0].fplId);
    page.captainId.set(selected[0].fplId);
    page.selectManager(selected[0].fplId);
    const replacement = page.suggestions()[0];
    expect(replacement).toBeDefined();
    page.replaceManager(replacement.fplId);
    expect(page.captainId()).toBe(replacement.fplId);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    expect(page.spent()).toBeLessThanOrEqual(page.budget);
    expect(page.validation()).toBe('');
    page.save();
    const save = http.expectOne('/api/team');
    expect(save.request.method).toBe('PUT');
    expect(save.request.body).toEqual({
      name: 'My five', leagueFplId: 999001,
      managerIds: page.selectedIds(), captainId: replacement.fplId,
    });
    save.flush({ ...emptyTeam, name: 'My five', leagueFplId: 999001, managerIds: page.selectedIds() });
  });

  it('does not save unless exactly five managers and a captain are selected', () => {
    const fixture = TestBed.createComponent(TeamEditor);
    http.expectOne('/api/team').flush(emptyTeam);
    http.expectOne('/api/team/leagues').flush([{ id: 999001, name: 'Public league' }]);
    const page = fixture.componentInstance;
    page.form.controls.name.setValue('My five');
    page.changeLeague(999001);
    http.expectOne('/api/team/managers?leagueFplId=999001').flush({ leagueFplId: 999001, leagueName: 'Public league', managers });
    for (const manager of managers.slice(-4)) page.addManager(manager.fplId);
    page.save();
    expect(page.validation()).toBe('Select exactly five managers.');
    http.expectNone('/api/team');
  });

  it('clears the selected roster and captain when changing leagues', () => {
    const fixture = TestBed.createComponent(TeamEditor);
    http.expectOne('/api/team').flush(emptyTeam);
    http.expectOne('/api/team/leagues').flush([
      { id: 999001, name: 'First league' }, { id: 999002, name: 'Second league' },
    ]);
    const page = fixture.componentInstance;
    page.changeLeague(999001);
    http.expectOne('/api/team/managers?leagueFplId=999001').flush({
      leagueFplId: 999001, leagueName: 'First league', managers,
    });
    for (const manager of managers.slice(-5)) {
      page.selectEmptySlot(page.selectedIds().length);
      page.addManager(manager.fplId);
    }
    expect(page.selectedIds()).toHaveLength(5);
    page.changeLeague(999002);
    expect(page.selectedIds()).toEqual([]);
    expect(page.captainId()).toBeNull();
    http.expectOne('/api/team/managers?leagueFplId=999002').flush({
      leagueFplId: 999002, leagueName: 'Second league', managers,
    });
    expect(page.team()?.leagueFplId).toBeNull();
    expect(page.selectedLeagueId()).toBe(999002);
  });

  it('hides league changes when editing an existing team', () => {
    const existing = {
      ...emptyTeam, name: 'My five', leagueName: 'First league', leagueFplId: 999001,
      managerIds: managers.slice(0, 5).map((manager) => manager.fplId),
      captainId: managers[0].fplId, members: managers.slice(0, 5),
    };
    const fixture = TestBed.createComponent(TeamEditor);
    http.expectOne('/api/team').flush(existing);
    http.expectOne('/api/team/leagues').flush([
      { id: 999001, name: 'First league' }, { id: 999002, name: 'Second league' },
    ]);
    http.expectOne('/api/team/managers?leagueFplId=999001').flush({
      leagueFplId: 999001, leagueName: 'First league', managers,
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('First league');
    expect(fixture.nativeElement.textContent).not.toContain('Change league');
    fixture.componentInstance.changeLeague(999002);
    expect(fixture.componentInstance.selectedLeagueId()).toBe(999001);
    expect(fixture.componentInstance.selectedIds()).toEqual(existing.managerIds);
    http.expectNone('/api/team/managers?leagueFplId=999002');
  });

  it('locks the team editor when the current GW deadline has passed', () => {
    const existing = {
      ...emptyTeam, name: 'My five', leagueName: 'First league', leagueFplId: 999001,
      managerIds: managers.slice(0, 5).map((manager) => manager.fplId),
      captainId: managers[0].fplId, members: managers.slice(0, 5),
      editsLocked: true, firstScoringGw: 2, currentDeadline: '2026-10-08T12:00:00Z',
    };
    const fixture = TestBed.createComponent(TeamEditor);
    http.expectOne('/api/team').flush(existing);
    http.expectOne('/api/team/leagues').flush([{ id: 999001, name: 'First league' }]);
    const managersRequest = http.expectOne('/api/team/managers?leagueFplId=999001');
    managersRequest.flush({ leagueFplId: 999001, leagueName: 'First league', managers });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Team edits are locked');
    expect(fixture.nativeElement.querySelectorAll('button.pitch-player:disabled').length).toBe(5);
    const save = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fixture.componentInstance.save();
    http.expectNone((request) => request.method === 'PUT' && request.url === '/api/team');
  });

  it('renders GW scores and season total from the user document', () => {
    const fixture = TestBed.createComponent(Dashboard);
    http.expectOne('/api/team').flush({
      ...emptyTeam, name: 'My five', leagueName: 'Public league', leagueFplId: 999001,
      totalScore: 106, scores: [{ gw: 2, points: 106, total: 106, managerIds: [], captainId: 1, teamName: 'My five', capturedAt: '2026-01-08' }],
    });
    http.expectOne('/api/team/standings?leagueFplId=999001').flush([
      { rank: 1, ownerFplId: 123456, ownerName: 'FPL Manager 123456', teamName: 'Five managers', points: 106 },
      { rank: 2, ownerFplId: 123458, ownerName: 'FPL Manager 123458', teamName: 'FML Third', points: 80 },
      { rank: 3, ownerFplId: 123457, ownerName: 'FPL Manager 123457', teamName: 'FML Runner Up', points: 76 },
    ]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Total season points');
    expect(fixture.nativeElement.textContent).toContain('GW 2');
    expect(fixture.nativeElement.textContent).not.toContain('Edit team');
    expect(fixture.nativeElement.querySelector('a[href="/fml/team"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Fantasy team standings');
    expect(fixture.nativeElement.textContent).toContain('FPL Manager 123456');
    const rankingRows = fixture.nativeElement.querySelectorAll('table')[0].querySelectorAll('tbody tr');
    expect(Array.from(rankingRows, (row: HTMLTableRowElement) =>
      Array.from(row.cells, (cell) => cell.textContent?.trim()))).toEqual([
      ['1', 'Five managers', 'FPL Manager 123456', '106'],
      ['2', 'FML Third', 'FPL Manager 123458', '80'],
      ['3', 'FML Runner Up', 'FPL Manager 123457', '76'],
    ]);
  });
});
