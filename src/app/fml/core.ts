import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, switchMap, throwError } from 'rxjs';
import { API } from './services/api.service';
import { Auth } from './services/auth.service';
import { Notices } from './services/notices.service';

export { API, Api } from './services/api.service';
export { Auth, Notices };

export const apiInterceptor: HttpInterceptorFn = (request, next) => {
  if (!(request.url === API || request.url.startsWith(`${API}/`))) return next(request);
  const auth = inject(Auth);
  const notices = inject(Notices);
  const isAuth = request.url === `${API}/auth/fpl/login`
    || request.url === `${API}/auth/refresh`
    || request.url === `${API}/auth/logout`;
  const authorized = () => auth.token() && !isAuth
    ? request.clone({ withCredentials: true, setHeaders: { Authorization: `Bearer ${auth.token()}` } })
    : request.clone({ withCredentials: true });
  return next(authorized()).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && !isAuth) {
        return auth.refresh().pipe(switchMap(ok => ok ? next(authorized()) : throwError(() => error)));
      }
      return throwError(() => error);
    }),
    catchError((error: unknown) => {
      if (!request.url.endsWith('/auth/refresh')) notices.error(error);
      return throwError(() => error);
    }),
  );
};
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(Auth);
  const router = inject(Router);
  return auth.restore().pipe(map(ok => ok || router.createUrlTree(['/fml/connect'], { queryParams: { returnUrl: state.url } })));
};
