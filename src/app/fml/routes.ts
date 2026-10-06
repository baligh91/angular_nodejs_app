import { Routes } from '@angular/router';
import { adminGuard, authGuard } from './core';

export const fmlRoutes: Routes = [{
  path: '',
  loadComponent: () => import('./shell').then(m => m.FmlShell),
  children: [
    { path: 'connect', loadComponent: () => import('./fpl-connect').then(m => m.FplConnect) },
    { path: '', pathMatch: 'full', canActivate: [authGuard], loadComponent: () => import('./dashboard').then(m => m.Dashboard) },
    { path: 'team/new', canActivate: [authGuard], loadComponent: () => import('./team-editor').then(m => m.TeamEditor) },
    { path: 'team/:id/edit', canActivate: [authGuard], loadComponent: () => import('./team-editor').then(m => m.TeamEditor) },
    { path: 'team/:id', canActivate: [authGuard], loadComponent: () => import('./team-view').then(m => m.TeamView) },
    { path: 'managers', canActivate: [authGuard], loadComponent: () => import('./managers').then(m => m.ManagersPage) },
    { path: 'rankings', canActivate: [authGuard], loadComponent: () => import('./rankings').then(m => m.RankingsPage) },
    { path: 'profile', canActivate: [authGuard], loadComponent: () => import('./profile').then(m => m.ProfilePage) },
    { path: 'admin', canActivate: [adminGuard], loadComponent: () => import('./admin').then(m => m.AdminPage) },
    { path: '**', redirectTo: '' },
  ],
}];
