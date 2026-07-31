import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.DEMO_PORT || 4173);

const routes = {
  "/": "index.html",
  "/dispatch": "dispatch.html",
  "/fleet": "fleet.html",
};

const server = createServer(async (req, res) => {
  const path = (req.url || "/").split("?")[0];
  const file = routes[path];

  if (!file) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  try {
    const body = await readFile(join(__dirname, file), "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(body);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(String(error));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Demo apps listening on http://127.0.0.1:${port}`);
  console.log(`  Dispatch: http://127.0.0.1:${port}/dispatch`);
  console.log(`  Fleet:    http://127.0.0.1:${port}/fleet`);
});
