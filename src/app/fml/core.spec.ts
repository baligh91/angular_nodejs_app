import { PLATFORM_ID } from '@angular/core';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';
import { Auth, Notices, apiInterceptor, authGuard } from './core';

import { fplSession as session } from './test-fixtures';
describe('FML authentication', () => {
  let http: HttpTestingController;
  let auth: Auth;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(Auth);
  });
  afterEach(() => http.verify());

  it('restores the cookie session once and keeps tokens only in service memory', async () => {
    const first = firstValueFrom(auth.restore());
    const concurrent = firstValueFrom(auth.restore());
    const request = http.expectOne('/api/auth/refresh');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush(session);
    expect(await first).toBe(true);
    expect(await concurrent).toBe(true);
    expect(await firstValueFrom(auth.restore())).toBe(true);
    expect(auth.token()).toBe(session.accessToken);
    http.expectNone('/api/auth/refresh');
  });
  it('never refreshes or accesses browser storage during SSR', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), { provide: PLATFORM_ID, useValue: 'server' }] });
    http = TestBed.inject(HttpTestingController);
    expect(await firstValueFrom(TestBed.inject(Auth).restore())).toBe(false);
    http.expectNone('/api/auth/refresh');
  });
  it('attaches bearer tokens only to relative API requests', async () => {
    auth.token.set(session.accessToken);
    const client = TestBed.inject(HttpClient);
    const local = firstValueFrom(client.get('/api/managers'));
    const localRequest = http.expectOne('/api/managers');
    expect(localRequest.request.headers.get('Authorization')).toBe(`Bearer ${session.accessToken}`);
    localRequest.flush([]);
    await local;
    const external = firstValueFrom(client.get('https://example.com/api/managers'));
    const externalRequest = http.expectOne('https://example.com/api/managers');
    expect(externalRequest.request.headers.has('Authorization')).toBe(false);
    expect(externalRequest.request.withCredentials).toBe(false);
    externalRequest.flush([]);
    await external;
  });
  it('rotates the session and retries a rejected protected request', async () => {
    auth.token.set('expired');
    const result = firstValueFrom(TestBed.inject(HttpClient).get('/api/teams/mine'));
    const first = http.expectOne('/api/teams/mine');
    expect(first.request.headers.get('Authorization')).toBe('Bearer expired');
    first.flush({ message: 'Expired' }, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/api/auth/refresh').flush(session);
    const retry = http.expectOne('/api/teams/mine');
    expect(retry.request.headers.get('Authorization')).toBe(`Bearer ${session.accessToken}`);
    retry.flush([]);
    expect(await result).toEqual([]);
  });
  it('does not invent an authenticated session when refresh is rejected', async () => {
    const result = firstValueFrom(auth.restore());
    http.expectOne('/api/auth/refresh').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(await result).toBe(false);
    expect(auth.user()).toBeNull();
    expect(auth.token()).toBeNull();
  });
  it('shows real server error messages', async () => {
    const result = firstValueFrom(TestBed.inject(HttpClient).post('/api/teams', {})).catch(() => null);
    http.expectOne('/api/teams').flush({ message: 'Gameweek edits are locked' }, { status: 409, statusText: 'Conflict' });
    await result;
    expect(TestBed.inject(Notices).message()).toBe('Gameweek edits are locked');
  });
  it('clears the memory session only after logout succeeds', async () => {
    auth.token.set(session.accessToken);
    auth.user.set(session.user);
    const logout = firstValueFrom(auth.logout());
    http.expectOne('/api/auth/logout').flush({});
    await logout;
    expect(auth.authenticated()).toBe(false);
    expect(auth.token()).toBeNull();
  });
  it('creates a session by signing in with an FPL ID and password', async () => {
    const login = firstValueFrom(auth.login(123456, 'correct horse battery staple'));
    const request = http.expectOne('/api/auth/login');
    expect(request.request.body).toEqual({ fplId: 123456, password: 'correct horse battery staple' });
    expect(request.request.headers.has('Authorization')).toBe(false);
    expect(request.request.withCredentials).toBe(true);
    request.flush(session);
    expect(await login).toEqual(session);
    expect(auth.authenticated()).toBe(true);
    expect(auth.token()).toBe(session.accessToken);
  });
  it('registers with the FPL ID and chosen password', async () => {
    const registration = firstValueFrom(auth.register(123456, 'correct horse battery staple'));
    const request = http.expectOne('/api/auth/register');
    expect(request.request.body).toEqual({ fplId: 123456, password: 'correct horse battery staple' });
    expect(request.request.headers.has('Authorization')).toBe(false);
    expect(request.request.withCredentials).toBe(true);
    request.flush(session);
    expect(await registration).toEqual(session);
    expect(auth.authenticated()).toBe(true);
  });
  it('sends unauthenticated navigation to FPL connection with the return URL', async () => {
    const guard = TestBed.runInInjectionContext(() => authGuard({} as ActivatedRouteSnapshot, { url: '/fml/team' } as RouterStateSnapshot)) as Observable<boolean | UrlTree>;
    const result = firstValueFrom(guard);
    http.expectOne('/api/auth/refresh').flush({}, { status: 401, statusText: 'Unauthorized' });
    const target = await result;
    expect(TestBed.inject(Router).serializeUrl(target as UrlTree)).toBe('/fml/connect?returnUrl=%2Ffml%2Fteam');
  });
});
