const role = (process.env.SERVICE_ROLE || "api").trim().toLowerCase();

void (async () => {
  if (role === "worker") {
    await import("./mint-worker/main.js");
  } else {
    await import("./main.js");
  }
})().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});

export {};
