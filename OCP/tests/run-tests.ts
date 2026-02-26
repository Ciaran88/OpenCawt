/**
 * OCP Test Runner
 * Usage: node --import tsx tests/run-tests.ts
 *
 * Runs all test suites in sequence. Each suite exports a run() function.
 */

const suites = [
  { name: "Canonicaliser", path: "./canonicalise.test.ts" },
  { name: "IDs & Agreement Code", path: "./ids.test.ts" },
  { name: "Attestation Verification", path: "./verify.test.ts" },
  { name: "NotifyUrl validation (SSRF)", path: "./notifyUrlValidation.test.ts" },
  { name: "Integration (full flow)", path: "./integration.test.ts" },
  { name: "API (auth, rate limit)", path: "./api.test.ts" },
];

let totalPassed = 0;
let totalFailed = 0;

for (const suite of suites) {
  console.log(`\n=== ${suite.name} ===`);
  const mod = await import(suite.path) as { run: () => Promise<{ passed: number; failed: number }> };
  const result = await mod.run();
  totalPassed += result.passed;
  totalFailed += result.failed;
}

console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${totalPassed} passed, ${totalFailed} failed`);
if (totalFailed > 0) {
  process.exit(1);
}
