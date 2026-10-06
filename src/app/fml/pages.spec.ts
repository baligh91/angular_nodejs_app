import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TeamEditor } from './team-editor';
import { ManagersPage } from './managers';
import { ProfilePage } from './profile';
import { Auth } from './core';
import { Manager } from './models';
import { fplProfile, fplSession, fplChallenge } from './test-fixtures';
import { FplConnect } from './fpl-connect';

const managers: Manager[] = Array.from({ length: 5 }, (_, index) => ({
  id: `m${index}`, fplId: index + 1, name: `Manager ${index}`, rank: index + 1,
  gwPoints: 50, form: 45, price: 40,
}));
const leagues = [{ id: 'league', fplId: 123, name: 'Test league' }];

describe('FML page API contracts', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  function editor(deadline = '2099-01-01T12:00:00Z') {
    const fixture = TestBed.createComponent(TeamEditor);
    http.expectOne('/api/leagues').flush(leagues);
    http.expectOne('/api/gameweeks').flush([{ id: 1, current: true, finished: false, deadline }]);
    const page = fixture.componentInstance;
    page.form.controls.leagueId.setValue('league');
    page.changeLeague();
    http.expectOne('/api/managers?leagueId=league').flush(managers);
    page.form.controls.name.setValue('My team');
    for (const manager of managers) page.toggle(manager.id);
    page.form.controls.captainId.setValue(managers[0].id);
    return page;
  }

  it('sends a budget-valid squad and member captain to the REST API', () => {
    const page = editor();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    expect(page.spent()).toBe(200);
    expect(page.budget()).toBe(250);
    expect(page.validation()).toBe('');
    page.save();
    const request = http.expectOne('/api/teams');
    expect(request.request.body).toEqual({
      name: 'My team', leagueId: 'league', format: 5,
      captainId: 'm0', managerIds: managers.map(manager => manager.id),
    });
    request.flush({ id: 'team' });
    expect(navigate).toHaveBeenCalledWith(['/fml']);
    expect(page.busy()).toBe(false);
  });
  it('rejects over-budget selections without sending a save request', () => {
    const page = editor();
    page.managers.set(managers.map(manager => ({ ...manager, price: 60 })));
    expect(page.validation()).toBe('Your squad exceeds the budget.');
    page.save();
    http.expectNone('/api/teams');
  });
  it('blocks edits after the deadline even when called programmatically', () => {
    const page = editor('2020-01-01T12:00:00Z');
    expect(page.locked()).toBe(true);
    expect(page.selectedIds()).toEqual([]);
    page.save();
    http.expectNone('/api/teams');
  });
  it('renders the backend gw field in manager price history', async () => {
    const fixture = TestBed.createComponent(ManagersPage);
    http.expectOne('/api/leagues').flush(leagues);
    http.expectOne('/api/managers?leagueId=league').flush(managers);
    fixture.componentInstance.history.set({
      ...managers[0], priceHistory: [{ gw: 2, price: 42, delta: 2 }],
    });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('GW 2');
    expect(fixture.nativeElement.textContent).toContain('4.2M');
  });
  it('retrieves read-only identity from FPL rather than saving independent credentials', () => {
    TestBed.inject(Auth).user.set(fplSession.user);
    const fixture = TestBed.createComponent(ProfilePage);
    fixture.componentInstance.sync();
    const request = http.expectOne('/api/auth/fpl/sync');
    expect(request.request.method).toBe('POST');
    request.flush({ ...fplSession.user, fplProfile: { ...fplProfile, overallPoints: 500 } });
    expect(TestBed.inject(Auth).user()?.fplProfile.overallPoints).toBe(500);
    http.expectNone('/api/auth/me');
  });
  it('offers the classic leagues supplied by the verified FPL profile', () => {
    TestBed.inject(Auth).user.set(fplSession.user);
    const fixture = TestBed.createComponent(ManagersPage);
    http.expectOne('/api/leagues').flush([]);
    fixture.componentInstance.importMyLeague(fplProfile.leagues[0]);
    const imported = http.expectOne('/api/leagues');
    expect(imported.request.body).toEqual({ fplId: 123 });
    imported.flush(leagues[0]);
    http.expectOne('/api/managers?leagueId=league').flush(managers);
  });
  it('shows public FPL metadata but requires a second ownership step', async () => {
    const fixture = TestBed.createComponent(FplConnect);
    const page = fixture.componentInstance;
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    page.form.controls.fplId.setValue(123456);
    page.start();
    http.expectOne('/api/auth/fpl/challenge').flush(fplChallenge);
    expect(TestBed.inject(Auth).authenticated()).toBe(false);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('FPL Team');
    expect(fixture.nativeElement.textContent).toContain(fplChallenge.code);
    page.verify();
    http.expectOne('/api/auth/fpl/verify').flush(fplSession);
    expect(TestBed.inject(Auth).authenticated()).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/fml');
  });
  it('does not verify an expired challenge and clears proof when changing the FPL ID', () => {
    const fixture = TestBed.createComponent(FplConnect);
    const page = fixture.componentInstance;
    page.challenge.set({ ...fplChallenge, expiresAt: '2020-01-01T00:00:00Z' });
    page.verify();
    http.expectNone('/api/auth/fpl/verify');
    expect(page.challenge()).toBeNull();
    page.challenge.set(fplChallenge);
    page.form.controls.fplId.setValue(456789);
    expect(page.challenge()).toBeNull();
  });
  it('requires an explicit valid FPL ID without defaulting to another manager', () => {
    const page = TestBed.createComponent(FplConnect).componentInstance;
    expect(page.form.controls.fplId.value).toBeNull();
    page.start();
    http.expectNone('/api/auth/fpl/challenge');
    for (const invalid of [0, -1, 1.5]) {
      page.form.controls.fplId.setValue(invalid);
      page.start();
      http.expectNone('/api/auth/fpl/challenge');
    }
  });
  it('keeps the ownership step visible when verification is rejected', () => {
    const page = TestBed.createComponent(FplConnect).componentInstance;
    page.challenge.set(fplChallenge);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    page.verify();
    http.expectOne('/api/auth/fpl/verify').flush({ message: 'Code not found in FPL' }, { status: 409, statusText: 'Conflict' });
    expect(page.challenge()).toEqual(fplChallenge);
    expect(page.busy()).toBe(false);
    expect(TestBed.inject(Auth).authenticated()).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
