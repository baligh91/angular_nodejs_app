import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { Auth, Notices } from './core';
import { FplChallenge } from './models';
import { FplProfileCard } from './fpl-profile-card';

@Component({
  selector: 'app-fpl-connect',
  imports: [DatePipe, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, FplProfileCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="connect-layout">
      <div class="hero"><p class="eyebrow">FANTASY MANAGER LEAGUE</p>
        <h1>Your FPL identity.<br>Your next league.</h1>
        <p>No email, password, or registration form. Use your existing Fantasy Premier League manager ID.</p>
        <p>Your ID is the number in your FPL points-page URL: <code>/entry/123456/event/1</code>.</p>
        <p>FPL IDs are public. We verify ownership before allowing you to change any FML team.</p>
      </div>
      <div class="panel">
        <h2>Connect your FPL manager</h2>
        <form [formGroup]="form" (ngSubmit)="start()" class="form-stack">
          <mat-form-field><mat-label>FPL manager ID</mat-label>
            <input matInput type="number" min="1" step="1" formControlName="fplId" [readonly]="busy()" autocomplete="off">
            <mat-error>Enter a positive integer FPL manager ID.</mat-error>
          </mat-form-field>
          <button mat-flat-button type="submit" [disabled]="busy()">{{busy() ? 'Retrieving FPL data...' : 'Retrieve my FPL profile'}}</button>
        </form>
        @if (challenge(); as proof) {
          <h3>Verify that this is your account</h3>
          <p>Open your team settings on the official FPL website. Temporarily set your team name to this exact code, then save:</p>
          <p class="verification-code"><code>{{proof.code}}</code></p>
          <p><a href="https://fantasy.premierleague.com/" target="_blank" rel="noopener noreferrer">Open Fantasy Premier League</a></p>
          <p>The code expires {{proof.expiresAt | date:'medium'}}. FPL may take a moment to publish your new team name.</p>
          <p>After verification, restore your previous FPL team name: <strong>{{proof.profile.teamName}}</strong>.</p>
          <p>Never share this code or enter a code sent by another person. Verification grants control of this FPL identity in FML.</p>
          <button mat-flat-button type="button" (click)="verify()" [disabled]="busy()">{{busy() ? 'Checking FPL ownership...' : 'I saved the code - verify'}}</button>
          <button mat-button type="button" (click)="start()" [disabled]="busy()">Generate a new code</button>
        }
      </div>
    </section>
    @if (challenge(); as proof) { <app-fpl-profile-card [profile]="proof.profile" /> }
  `,
})
export class FplConnect {
  private readonly auth = inject(Auth);
  private readonly notices = inject(Notices);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly busy = signal(false);
  readonly challenge = signal<FplChallenge | null>(null);
  readonly form = new FormGroup({
    fplId: new FormControl<number | null>(null, [
      Validators.required, Validators.min(1), Validators.max(Number.MAX_SAFE_INTEGER), Validators.pattern(/^\d+$/),
    ]),
  });

  constructor() {
    this.form.controls.fplId.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.challenge.set(null));
  }
  start(): void {
    this.form.markAllAsTouched();
    const fplId = this.form.controls.fplId.value;
    if (this.form.invalid || fplId === null || this.busy()) return;
    this.challenge.set(null);
    this.busy.set(true);
    this.auth.challenge(fplId).pipe(finalize(() => this.busy.set(false))).subscribe({
      next: proof => this.challenge.set(proof),
      error: () => {},
    });
  }
  verify(): void {
    const proof = this.challenge();
    if (!proof || this.busy()) return;
    if (Date.parse(proof.expiresAt) <= Date.now()) {
      this.notices.message.set('Your verification code has expired. Generate a new code.');
      this.challenge.set(null);
      return;
    }
    this.busy.set(true);
    this.auth.verify(proof.challengeId).pipe(finalize(() => this.busy.set(false))).subscribe({
      next: () => {
        this.notices.message.set('FPL account verified. You can restore your original FPL team name.');
        const target = this.route.snapshot.queryParamMap.get('returnUrl');
        void this.router.navigateByUrl(target?.startsWith('/fml/') && !target.startsWith('/fml/connect') ? target : '/fml');
      },
      error: () => {},
    });
  }
}
