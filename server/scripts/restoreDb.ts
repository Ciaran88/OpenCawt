import { createHash } from "node:crypto";
import { createReadStream, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { request } from "node:http";
import { getConfig } from "../config";

function usage(): never {
  process.stderr.write(
    "Usage: npm run db:restore -- <backup-file> [--force] [--checksum <checksum-file>]\n"
  );
  process.exit(1);
}

function parseArgs(argv: string[]): {
  backupPath: string;
  force: boolean;
  checksumPath?: string;
} {
  let backupPath = "";
  let checksumPath: string | undefined;
  let force = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--force") {
      force = true;
      continue;
    }
    if (token === "--checksum") {
      checksumPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (!backupPath) {
      backupPath = token;
      continue;
    }
    usage();
  }

  if (!backupPath) {
    usage();
  }

  return {
    backupPath: resolve(backupPath),
    force,
    checksumPath: checksumPath ? resolve(checksumPath) : undefined
  };
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  return await new Promise((resolvePromise, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolvePromise(hash.digest("hex")));
  });
}

function parseChecksumFile(path: string): string {
  const content = readFileSync(path, "utf8").trim();
  const [checksum] = content.split(/\s+/);
  if (!/^[a-f0-9]{64}$/i.test(checksum || "")) {
    throw new Error(`Checksum file is invalid: ${path}`);
  }
  return checksum.toLowerCase();
}

async function isLikelyApiRunning(host: string, port: number): Promise<boolean> {
  const targetHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  return await new Promise((resolvePromise) => {
    const req = request(
      {
        host: targetHost,
        port,
        path: "/api/health",
        method: "GET",
        timeout: 700
      },
      (res) => {
        resolvePromise((res.statusCode ?? 500) < 500);
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolvePromise(false);
    });
    req.on("error", () => resolvePromise(false));
    req.end();
  });
}

async function run(): Promise<void> {
  const config = getConfig();
  const args = parseArgs(process.argv.slice(2));
  const checksumPath = args.checksumPath ?? `${args.backupPath}.sha256`;

  if (!existsSync(args.backupPath)) {
    throw new Error(`Backup file was not found: ${args.backupPath}`);
  }
  if (!existsSync(checksumPath)) {
    throw new Error(`Checksum file was not found: ${checksumPath}`);
  }

  if (!args.force) {
    const running = await isLikelyApiRunning(config.apiHost, config.apiPort);
    if (running) {
      throw new Error(
        "API appears to be running. Stop the API before restore, or rerun with --force."
      );
    }
  }

  const expectedChecksum = parseChecksumFile(checksumPath);
  const actualChecksum = await sha256File(args.backupPath);
  if (actualChecksum !== expectedChecksum) {
    throw new Error("Backup checksum mismatch. Restore aborted.");
  }

  mkdirSync(dirname(config.dbPath), { recursive: true });
  const tempPath = `${config.dbPath}.restore.tmp`;
  copyFileSync(args.backupPath, tempPath);
  renameSync(tempPath, config.dbPath);

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        restoredTo: config.dbPath,
        backupPath: args.backupPath,
        checksum: actualChecksum,
        forced: args.force
      },
      null,
      2
    ) + "\n"
  );
}

run().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
