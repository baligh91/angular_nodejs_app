import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, map, of, shareReplay, tap } from 'rxjs';
import { Session, User } from '../models';
import { API } from './api.service';
import { Notices } from './notices.service';

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

  login(fplId: number): Observable<Session> {
    return this.http.post<Session>(`${API}/auth/fpl/login`, { fplId }, { withCredentials: true })
      .pipe(tap(session => this.accept(session)));
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
