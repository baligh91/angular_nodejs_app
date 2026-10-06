import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { finalize } from 'rxjs';
import { Auth, Notices } from './core';
import { FplProfileCard } from './fpl-profile-card';

@Component({
  selector: 'app-profile',
  imports: [MatButtonModule, FplProfileCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-heading"><div><p class="eyebrow">YOUR FPL IDENTITY</p><h1>My FPL profile</h1>
      <p>Your identity and favorite club come from Fantasy Premier League, not a separate FML account form.</p></div>
      <button mat-flat-button (click)="sync()" [disabled]="busy()">{{busy() ? 'Updating from FPL...' : 'Refresh from FPL'}}</button>
    </div>
    @if (auth.user(); as user) {
      <app-fpl-profile-card [profile]="user.fplProfile" />
      <section class="panel"><h2>FPL classic leagues</h2>
        <ul>@for (league of user.fplProfile.leagues; track league.id) {
          <li>{{league.name}} · FPL #{{league.id}} @if (league.rank !== null) { · rank {{league.rank}} }</li>
        } @empty { <li>No classic leagues are listed in your public FPL profile.</li> }</ul>
        <p>Change your manager name or favorite club on FPL, then refresh this profile.</p>
      </section>
    }
  `,
})
export class ProfilePage {
  readonly auth = inject(Auth);
  private readonly notices = inject(Notices);
  readonly busy = signal(false);
  sync(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.auth.syncProfile().pipe(finalize(() => this.busy.set(false))).subscribe({
      next: () => this.notices.message.set('Your public FPL profile has been updated.'),
      error: () => {},
    });
  }
}
