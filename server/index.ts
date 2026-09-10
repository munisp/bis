import express from "express";
import { createServer } from "http";
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

  // Handle client-side routing - serve a non-cacheable HTML entry for all routes
  app.get("{*path}", (_req, res) => {
    setNoStoreHeaders(res);
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = ENV.port;

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
