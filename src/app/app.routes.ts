import { Routes } from '@angular/router';


export const routes: Routes = [
    {
      path: 'fml',
      loadChildren: () => import('./fml/routes').then(m => m.fmlRoutes),
    },
    { path: '', pathMatch: 'full', redirectTo: 'fml' },
    { path: '**', redirectTo: 'fml' },
];
