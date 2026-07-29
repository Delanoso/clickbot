import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const port = process.env.DEMO_PORT || "4173";

const server = spawn("node", ["demo/server.js"], {
  env: { ...process.env, DEMO_PORT: port },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverReady = false;

server.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  if (text.includes("Demo apps listening")) {
    serverReady = true;
  }
});

server.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

async function waitForServer() {
  for (let i = 0; i < 40; i += 1) {
    if (serverReady) return;
    if (server.exitCode != null) {
      throw new Error(`Demo server exited early with code ${server.exitCode}`);
    }
    await delay(100);
  }
  throw new Error("Demo server did not become ready in time");
}

function runBot() {
  return new Promise((resolve, reject) => {
    const bot = spawn(
      "node",
      ["src/index.js", "allocate-drivers", "--config", "config/demo.json"],
      { stdio: "inherit", env: process.env }
    );
    bot.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Bot exited with code ${code}`));
    });
    bot.on("error", reject);
  });
}

try {
  await waitForServer();
  await runBot();
  console.log("\nDemo run finished successfully.");
  server.kill("SIGTERM");
  process.exit(0);
} catch (error) {
  console.error(error.message || error);
  server.kill("SIGTERM");
  process.exit(1);
}
