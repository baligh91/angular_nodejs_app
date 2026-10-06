import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Observable, catchError, finalize, map, of, shareReplay, switchMap, tap, throwError } from 'rxjs';
import { FplChallenge, Session, User } from './models';

export const API = '/api';
@Injectable({ providedIn: 'root' })
export class Notices {
  readonly message = signal('');
  error(error: unknown): void {
    const body: unknown = error instanceof HttpErrorResponse ? error.error : null;
    const message = body && typeof body === 'object' && 'message' in body ? body.message : null;
    this.message.set(typeof message === 'string' ? message : Array.isArray(message) ? message.join('. ') : 'Request failed. Please try again.');
  }
}
@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly http = inject(HttpClient);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly notices = inject(Notices);
  readonly user = signal<User | null>(null);
  readonly token = signal<string | null>(null);
  readonly authenticated = computed(() => this.user() !== null);
  private restored = false;
  private refreshing?: Observable<boolean>;

  challenge(fplId: number): Observable<FplChallenge> {
    return this.http.post<FplChallenge>(`${API}/auth/fpl/challenge`, { fplId }, { withCredentials: true });
  }
  verify(challengeId: string): Observable<Session> {
    return this.http.post<Session>(`${API}/auth/fpl/verify`, { challengeId }, { withCredentials: true })
      .pipe(tap(session => this.accept(session)));
  }
  syncProfile(): Observable<User> {
    return this.http.post<User>(`${API}/auth/fpl/sync`, {}).pipe(tap(user => this.user.set(user)));
  }
  restore(): Observable<boolean> {
    if (!this.browser) return of(false);
    if (this.restored) return of(this.authenticated());
    return this.refresh();
  }
  refresh(): Observable<boolean> {
    if (!this.browser) return of(false);
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.http.post<Session>(`${API}/auth/refresh`, {}, { withCredentials: true }).pipe(
      tap(session => this.accept(session)),
      map(() => true),
      catchError((error: unknown) => {
        this.clear();
        if (!(error instanceof HttpErrorResponse && error.status === 401)) this.notices.error(error);
        return of(false);
      }),
      finalize(() => { this.restored = true; this.refreshing = undefined; }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.refreshing;
  }
  logout(): Observable<unknown> {
    return this.http.post(`${API}/auth/logout`, {}, { withCredentials: true }).pipe(tap(() => this.clear()));
  }
  private accept(session: Session): void {
    this.token.set(session.accessToken);
    this.user.set(session.user);
    this.restored = true;
  }
  clear(): void { this.token.set(null); this.user.set(null); }
}
export const apiInterceptor: HttpInterceptorFn = (request, next) => {
  if (!(request.url === API || request.url.startsWith(`${API}/`))) return next(request);
  const auth = inject(Auth);
  const notices = inject(Notices);
  const isAuth = request.url === `${API}/auth/fpl/challenge`
    || request.url === `${API}/auth/fpl/verify`
    || request.url === `${API}/auth/refresh`
    || request.url === `${API}/auth/logout`;
  const authorized = () => auth.token() && !isAuth
    ? request.clone({ withCredentials: true, setHeaders: { Authorization: `Bearer ${auth.token()}` } })
    : request.clone({ withCredentials: true });
  return next(authorized()).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && !isAuth) {
        return auth.refresh().pipe(switchMap(ok => ok ? next(authorized()) : throwError(() => error)));
      }
      return throwError(() => error);
    }),
    catchError((error: unknown) => {
      if (!request.url.endsWith('/auth/refresh')) notices.error(error);
      return throwError(() => error);
    }),
  );
};
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(Auth);
  const router = inject(Router);
  return auth.restore().pipe(map(ok => ok || router.createUrlTree(['/fml/connect'], { queryParams: { returnUrl: state.url } })));
};
export const adminGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);
  return auth.restore().pipe(map(ok => ok && auth.user()?.role === 'admin' || router.createUrlTree(['/fml'])));
};
@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);
  get<T>(path: string): Observable<T> { return this.http.get<T>(`${API}/${path}`); }
  post<T>(path: string, body: unknown): Observable<T> { return this.http.post<T>(`${API}/${path}`, body); }
  put<T>(path: string, body: unknown): Observable<T> { return this.http.put<T>(`${API}/${path}`, body); }
  patch<T>(path: string, body: unknown): Observable<T> { return this.http.patch<T>(`${API}/${path}`, body); }
}
