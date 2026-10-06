import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { Auth, Notices } from './core';

@Component({
  selector: 'app-fml-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fml-app">
      <header class="fml-header">
        <a class="brand" routerLink="/fml"><span class="brand-mark">FML</span> Fantasy Manager League</a>
        <nav class="flex flex-wrap gap-2" aria-label="Fantasy league">
          @if (auth.authenticated()) {
            <a mat-button routerLink="/fml" routerLinkActive="active" [routerLinkActiveOptions]="{exact:true}">Dashboard</a>
            <a mat-button routerLink="/fml/team/new" routerLinkActive="active">Build team</a>
            <a mat-button routerLink="/fml/managers" routerLinkActive="active">Managers</a>
            <a mat-button routerLink="/fml/rankings" routerLinkActive="active">Rankings</a>
            <a mat-button routerLink="/fml/profile" routerLinkActive="active">Profile</a>
            @if (auth.user()?.role === 'admin') { <a mat-button routerLink="/fml/admin">Admin</a> }
            <button mat-button (click)="logout()">Disconnect FPL</button>
          } @else { <a mat-button routerLink="/fml/connect">Connect FPL ID</a> }
        </nav>
      </header>
      @if (notices.message()) {
        <div role="alert" class="notice"><span>{{notices.message()}}</span><button mat-button (click)="notices.message.set('')" aria-label="Dismiss notification">Dismiss</button></div>
      }
      <div class="fml-content"><router-outlet /></div>
      <footer>Pick managers. Build your legacy. Captain scores count double.</footer>
    </div>
  `,
})
export class FmlShell {
  readonly auth = inject(Auth);
  readonly notices = inject(Notices);
  private readonly router = inject(Router);
  logout(): void {
    this.auth.logout().subscribe({ next: () => void this.router.navigate(['/fml/connect']), error: () => {} });
  }
}
