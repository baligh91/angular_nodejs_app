import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { finalize } from 'rxjs';
import { Auth } from './services/auth.service';
import { Notices } from './services/notices.service';

@Component({
  selector: 'app-fpl-connect',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './fpl-connect.html',
  styleUrl: './fpl-connect.scss',
})
export class FplConnect {
  private readonly auth = inject(Auth);
  private readonly notices = inject(Notices);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly busy = signal(false);
  readonly mode = signal<'login' | 'register'>('login');
  readonly form = new FormGroup({
    fplId: new FormControl<number | null>(null, [
      Validators.required, Validators.min(1), Validators.max(Number.MAX_SAFE_INTEGER), Validators.pattern(/^\d+$/),
    ]),
    password: new FormControl('', { nonNullable: true, validators: [
      Validators.required, Validators.minLength(6), Validators.maxLength(128),
    ] }),
    confirmPassword: new FormControl('', { nonNullable: true }),
  });

  setMode(mode: 'login' | 'register'): void {
    this.mode.set(mode);
    const confirmation = this.form.controls.confirmPassword;
    if (mode === 'register') confirmation.setValidators(Validators.required);
    else confirmation.clearValidators();
    confirmation.updateValueAndValidity();
    confirmation.reset();
    this.form.updateValueAndValidity();
  }

  submit(): void {
    this.form.markAllAsTouched();
    const { fplId, password, confirmPassword } = this.form.getRawValue();
    if (this.form.invalid || fplId === null || this.busy()
      || (this.mode() === 'register' && password !== confirmPassword)) return;
    this.busy.set(true);
    const authenticate = this.mode() === 'register'
      ? this.auth.register(fplId, password)
      : this.auth.login(fplId, password);
    authenticate.pipe(finalize(() => this.busy.set(false))).subscribe({
      next: () => {
        this.notices.message.set(this.mode() === 'register' ? 'Account created.' : 'Signed in.');
        const target = this.route.snapshot.queryParamMap.get('returnUrl');
        void this.router.navigateByUrl(target?.startsWith('/fml/') && !target.startsWith('/fml/connect') ? target : '/fml');
      },
      error: () => {},
    });
  }
}
