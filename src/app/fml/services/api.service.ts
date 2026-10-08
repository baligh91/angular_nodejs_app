import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export const API = '/api';

@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);
  get<T>(path: string): Observable<T> { return this.http.get<T>(`${API}/${path}`); }
  post<T>(path: string, body: unknown): Observable<T> { return this.http.post<T>(`${API}/${path}`, body); }
  put<T>(path: string, body: unknown): Observable<T> { return this.http.put<T>(`${API}/${path}`, body); }
  patch<T>(path: string, body: unknown): Observable<T> { return this.http.patch<T>(`${API}/${path}`, body); }
}
