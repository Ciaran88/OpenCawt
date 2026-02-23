import { strict as assert } from "node:assert";
import { createOcpId, deriveAgreementCode } from "../server/ids";

type Result = { passed: number; failed: number };

async function test(name: string, fn: () => void | Promise<void>, results: Result): Promise<void> {
  try {
    await fn();
    results.passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.failed++;
    const msg = err instanceof assert.AssertionError
      ? `Expected ${JSON.stringify(err.expected)}, got ${JSON.stringify(err.actual)}`
      : (err instanceof Error ? err.message : String(err));
    console.error(`  ✗ ${name}: ${msg}`);
  }
}

export async function run(): Promise<Result> {
  const results: Result = { passed: 0, failed: 0 };

  await test("createOcpId: starts with given prefix", () => {
    const id = createOcpId("prop");
    assert.ok(id.startsWith("prop_"), `Expected id to start with 'prop_', got ${id}`);
  }, results);

  await test("createOcpId: different calls produce different ids", () => {
    const id1 = createOcpId("prop");
    const id2 = createOcpId("prop");
    assert.notStrictEqual(id1, id2);
  }, results);

  await test("deriveAgreementCode: deterministic", () => {
    const hash = "e790e5354b75b128c9588860537c4e6208b026c4653224a0a453fcac16811676";
    assert.strictEqual(deriveAgreementCode(hash), deriveAgreementCode(hash));
  }, results);

  await test("deriveAgreementCode: exactly 10 characters", () => {
    const hash = "6fc15f11e186abcda48eb4635bf10fd1cb1058900563c16d2db34afca13d6ea9";
    assert.strictEqual(deriveAgreementCode(hash).length, 10);
  }, results);

  await test("deriveAgreementCode: Crockford alphabet only", () => {
    const hash = "e790e5354b75b128c9588860537c4e6208b026c4653224a0a453fcac16811676";
    const code = deriveAgreementCode(hash);
    // Crockford: 0-9, A-Z minus I, L, O, U
    assert.ok(/^[0-9A-HJKMNP-TV-Z]{10}$/.test(code), `Invalid Crockford code: ${code}`);
  }, results);

  await test("deriveAgreementCode: different hashes → different codes", () => {
    const h1 = "e790e5354b75b128c9588860537c4e6208b026c4653224a0a453fcac16811676";
    const h2 = "6fc15f11e186abcda48eb4635bf10fd1cb1058900563c16d2db34afca13d6ea9";
    assert.notStrictEqual(deriveAgreementCode(h1), deriveAgreementCode(h2));
  }, results);

  await test("deriveAgreementCode: pinned value for vector 1", () => {
    const hash = "e790e5354b75b128c9588860537c4e6208b026c4653224a0a453fcac16811676";
    assert.strictEqual(deriveAgreementCode(hash), "PV4DBJZ9WQ");
  }, results);

  await test("deriveAgreementCode: pinned value for vector 2", () => {
    const hash = "6fc15f11e186abcda48eb4635bf10fd1cb1058900563c16d2db34afca13d6ea9";
    assert.strictEqual(deriveAgreementCode(hash), "R36W4520R8");
  }, results);

  return results;
}
