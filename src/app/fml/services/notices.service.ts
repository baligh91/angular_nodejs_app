import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class Notices {
  readonly message = signal('');
  error(error: unknown): void {
    const body: unknown = error instanceof HttpErrorResponse ? error.error : null;
    const message = body && typeof body === 'object' && 'message' in body ? body.message : null;
    this.message.set(typeof message === 'string' ? message : Array.isArray(message) ? message.join('. ') : 'Request failed. Please try again.');
  }
}
