import express from "express";
import { createServer } from "http";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import { ENV } from "./_core/env";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  const setNoStoreHeaders = (res: express.Response) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  };

  app.use(express.static(staticPath, {
    maxAge: "1y",
    setHeaders: (res, filePath) => {
      if (filePath.endsWith("index.html") || filePath.endsWith(`${path.sep}sw.js`)) {
        setNoStoreHeaders(res);
      }
    },
  }));

  // Bound HTML-entry fallbacks separately from immutable static assets. `ipKeyGenerator`
  // normalizes IPv6 addresses and avoids trusting spoofable forwarded headers directly.
  const htmlEntryLimiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: request => ipKeyGenerator(request.ip ?? request.socket.remoteAddress ?? "unknown"),
    handler: (_request, response) => response.status(429).send("Too many requests"),
  });

  // Mount the fallback through a dedicated router so all cache-bypass HTML
  // requests cross the limiter before the catch-all handler executes.
  const htmlEntryRouter = express.Router();
  htmlEntryRouter.use(htmlEntryLimiter);
  htmlEntryRouter.get("{*path}", (_req, res) => {
    setNoStoreHeaders(res);
    res.sendFile(path.join(staticPath, "index.html"));
  });
  app.use(htmlEntryRouter);

  const port = ENV.port;

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
