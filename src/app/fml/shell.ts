import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { Auth } from './services/auth.service';
import { Notices } from './services/notices.service';

@Component({
  selector: 'app-fml-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class FmlShell {
  readonly auth = inject(Auth);
  readonly notices = inject(Notices);
  private readonly router = inject(Router);
  logout(): void {
    this.auth.logout().subscribe({ next: () => void this.router.navigate(['/fml/connect']), error: () => {} });
  }
}
