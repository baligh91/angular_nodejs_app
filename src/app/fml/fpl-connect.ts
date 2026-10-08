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
  readonly form = new FormGroup({
    fplId: new FormControl<number | null>(null, [
      Validators.required, Validators.min(1), Validators.max(Number.MAX_SAFE_INTEGER), Validators.pattern(/^\d+$/),
    ]),
  });

  login(): void {
    this.form.markAllAsTouched();
    const fplId = this.form.controls.fplId.value;
    if (this.form.invalid || fplId === null || this.busy()) return;
    this.busy.set(true);
    this.auth.login(fplId).pipe(finalize(() => this.busy.set(false))).subscribe({
      next: () => {
        this.notices.message.set('Connected using your FPL ID.');
        const target = this.route.snapshot.queryParamMap.get('returnUrl');
        void this.router.navigateByUrl(target?.startsWith('/fml/') && !target.startsWith('/fml/connect') ? target : '/fml');
      },
      error: () => {},
    });
  }
}
