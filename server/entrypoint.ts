const role = (process.env.SERVICE_ROLE || "api").trim().toLowerCase();

if (role === "worker") {
  await import("./mint-worker/main");
} else {
  await import("./main");
}

export {};
