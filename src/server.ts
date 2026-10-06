import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import httpProxy from 'http-proxy';
import { ServerResponse } from 'node:http';
import { join } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

const apiTarget = new URL(process.env['FML_API_URL'] || 'http://127.0.0.1:3000');
if (!['http:', 'https:'].includes(apiTarget.protocol)) {
  throw new Error('FML_API_URL must be an HTTP(S) backend origin');
}

const apiProxy = httpProxy.createProxyServer({
  target: apiTarget.origin,
  changeOrigin: true,
  proxyTimeout: 180000,
});
apiProxy.on('error', (error, _request, response) => {
  console.error('FML API proxy failed:', error.message);
  if (response instanceof ServerResponse && !response.headersSent) {
    response.writeHead(502, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ message: 'FML API is unavailable. Please try again.' }));
  }
});

// Keep /api intact and proxy the body stream before any JSON middleware.
app.use((request, response, next) => {
  if (request.path === '/api' || request.path.startsWith('/api/')) {
    apiProxy.web(request, response);
    return;
  }
  next();
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
