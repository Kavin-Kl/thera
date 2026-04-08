/**
 * Tiny loopback HTTP server used to receive OAuth redirects.
 *
 * Used by every OAuth provider (Google, Spotify, Slack). Listens on a
 * random ephemeral port, waits for the first request matching `path`,
 * resolves with the parsed query string, then shuts itself down.
 */
const http = require('http');
const url = require('url');

function startLoopback({ path = '/oauth/callback', timeoutMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsed = url.parse(req.url, true);
      if (parsed.pathname !== path) {
        res.writeHead(404);
        res.end();
        return;
      }
      const { query } = parsed;
      // Friendly success page
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!doctype html><html><head><meta charset="utf-8"><title>thera</title>
        <style>
          body { font-family: -apple-system, system-ui, sans-serif; background:#18120a; color:#f0e6d2;
                 display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
          .box { text-align:center; }
          h1 { color:#e8603a; font-weight:600; letter-spacing:-0.5px; }
          p { color:#8a7256; }
        </style></head>
        <body><div class="box">
          <h1>${query.error ? 'something went wrong' : 'all good. you can close this tab.'}</h1>
          <p>${query.error ? String(query.error) : 'thera has the keys.'}</p>
        </div></body></html>
      `);

      server.close();
      clearTimeout(timer);
      if (query.error) reject(new Error(String(query.error)));
      else resolve(query);
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error('OAuth timed out'));
    }, timeoutMs);

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      // Resolve port early via the `onPort` hook attached to the returned promise
      if (typeof startLoopback._onPort === 'function') {
        startLoopback._onPort(port);
        startLoopback._onPort = null;
      }
    });

    // Expose the listening port via the promise itself
    Object.defineProperty(this || {}, 'port', { value: null, writable: true });
  });
}

/**
 * Higher-level helper: starts the loopback, calls `buildAuthUrl(port)` to get
 * the URL to open in the browser, opens it, and returns the OAuth callback query.
 */
async function runOAuthFlow({ buildAuthUrl, callbackPath = '/oauth/callback' }) {
  const { shell } = require('electron');
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsed = url.parse(req.url, true);
      if (parsed.pathname !== callbackPath) { res.writeHead(404); res.end(); return; }
      const { query } = parsed;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!doctype html><html><head><meta charset="utf-8"><title>thera</title>
        <style>
          body { font-family: -apple-system, system-ui, sans-serif; background:#18120a; color:#f0e6d2;
                 display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
          h1 { color:#e8603a; font-weight:600; letter-spacing:-0.5px; }
          p { color:#8a7256; }
        </style></head>
        <body><div style="text-align:center">
          <h1>${query.error ? 'something went wrong' : 'all good. you can close this tab.'}</h1>
          <p>${query.error ? String(query.error) : 'thera has the keys.'}</p>
        </div></body></html>
      `);
      server.close();
      clearTimeout(timer);
      if (query.error) reject(new Error(String(query.error)));
      else resolve(query);
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error('OAuth timed out after 5 min'));
    }, 5 * 60 * 1000);

    server.listen(0, '127.0.0.1', async () => {
      const { port } = server.address();
      try {
        const authUrl = await buildAuthUrl(port);
        await shell.openExternal(authUrl);
      } catch (e) {
        server.close();
        clearTimeout(timer);
        reject(e);
      }
    });
  });
}

module.exports = { runOAuthFlow };
