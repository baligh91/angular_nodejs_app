import { Routes } from '@angular/router';
import { authGuard } from './core';

export const fmlRoutes: Routes = [{
  path: '',
  loadComponent: () => import('./components/shell').then(m => m.FmlShell),
  children: [
    { path: 'connect', loadComponent: () => import('./components/fpl-connect').then(m => m.FplConnect) },
    { path: '', pathMatch: 'full', canActivate: [authGuard], loadComponent: () => import('./components/dashboard').then(m => m.Dashboard) },
    { path: 'team', canActivate: [authGuard], loadComponent: () => import('./components/team-editor').then(m => m.TeamEditor) },
    { path: '**', redirectTo: '' },
  ],
}];
