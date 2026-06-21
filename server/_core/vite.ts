import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";
import { ENV } from "./env";

/**
 * Inject server-side runtime values as <meta> tags into the HTML shell.
 * Also injects cache-busting meta tags so browsers never cache the HTML entry point.
 * Currently injects:
 *   - vapid-public-key: VAPID public key for Web Push subscription in the browser
 *   - http-equiv Cache-Control / Pragma / Expires: prevent browser HTML caching
 */
function injectServerMeta(html: string): string {
  const metas: string[] = [
    // Cache-busting meta tags — belt-and-suspenders alongside the Cache-Control header
    `<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />`,
    `<meta http-equiv="Pragma" content="no-cache" />`,
    `<meta http-equiv="Expires" content="0" />`,
  ];
  if (ENV.vapidPublicKey) {
    // Escape any quotes in the key (should not occur for base64url, but defensive)
    const safeKey = ENV.vapidPublicKey.replace(/"/g, '&quot;');
    metas.push(`<meta name="vapid-public-key" content="${safeKey}" />`);
  }
  // Insert before </head>
  return html.replace('</head>', `  ${metas.join('\n  ')}\n</head>`);
}

/** Set no-cache headers on the HTML entry point response. */
function setNoCacheHeaders(res: import("express").Response): void {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("{*path}", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      template = injectServerMeta(template);
      const page = await vite.transformIndexHtml(url, template);
      setNoCacheHeaders(res);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  // Serve static assets (JS/CSS chunks) with long-lived cache — they have content-hash filenames
  app.use(express.static(distPath, {
    // 1 year for hashed assets, but index.html is handled separately below
    maxAge: "1y",
    setHeaders: (res, filePath) => {
      // Never cache the HTML entry point — it must always be fresh
      if (filePath.endsWith("index.html")) {
        setNoCacheHeaders(res);
      }
    },
  }));

  // fall through to index.html — inject CSP nonce and server meta into the HTML
  app.use("{*path}", (req: import("express").Request, res: import("express").Response) => {
    const indexPath = path.resolve(distPath, "index.html");
    let html = fs.readFileSync(indexPath, "utf-8");
    // Inject nonce from res.locals (set by Helmet nonce middleware)
    const nonce: string | undefined = (res.locals as { nonce?: string }).nonce;
    if (nonce) {
      html = html.replace(/<script/g, `<script nonce="${nonce}"`);
    }
    // Inject server-side runtime meta tags (VAPID key, cache-busting, etc.)
    html = injectServerMeta(html);
    setNoCacheHeaders(res);
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  });
}
