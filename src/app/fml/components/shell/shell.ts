import { NgTemplateOutlet } from '@angular/common';
import { BreakpointObserver } from '@angular/cdk/layout';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatSidenavModule } from '@angular/material/sidenav';
import { Auth } from '../../services/auth.service';
import { Notices } from '../../services/notices.service';

@Component({
  selector: 'app-fml-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, MatButtonModule, MatSidenavModule, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class FmlShell {
  readonly auth = inject(Auth);
  readonly notices = inject(Notices);
  readonly mobileMenuOpen = signal(false);
  private readonly router = inject(Router);
  constructor() {
    inject(BreakpointObserver).observe('(max-width: 850px)').pipe(takeUntilDestroyed()).subscribe(({ matches }) => {
      if (!matches) this.mobileMenuOpen.set(false);
    });
  }
  logout(): void {
    this.auth.logout().subscribe({ next: () => void this.router.navigate(['/fml/connect']), error: () => {} });
  }
}
