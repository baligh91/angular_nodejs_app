import { Routes } from '@angular/router';
import { authGuard } from './core';

export const fmlRoutes: Routes = [{
  path: '',
  loadComponent: () => import('./shell').then(m => m.FmlShell),
  children: [
    { path: 'connect', loadComponent: () => import('./fpl-connect').then(m => m.FplConnect) },
    { path: '', pathMatch: 'full', canActivate: [authGuard], loadComponent: () => import('./dashboard').then(m => m.Dashboard) },
    { path: 'team', canActivate: [authGuard], loadComponent: () => import('./team-editor').then(m => m.TeamEditor) },
    { path: '**', redirectTo: '' },
  ],
}];
