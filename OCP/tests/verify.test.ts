import { strict as assert } from "node:assert";
import { verifyBothAttestations } from "../server/verify/index";
import { buildAttestationString, hashAttestationString } from "../server/canonicalise/index";
import { encodeBase58 } from "../shared/base58";

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

async function generateKeypair(): Promise<{ agentId: string; privateKey: CryptoKey }> {
  const keypair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const publicKeyRaw = await crypto.subtle.exportKey("raw", keypair.publicKey as CryptoKey);
  const agentId = encodeBase58(new Uint8Array(publicKeyRaw));
  return { agentId, privateKey: keypair.privateKey as CryptoKey };
}

async function signAttestation(
  privateKey: CryptoKey,
  attestationInput: Parameters<typeof buildAttestationString>[0]
): Promise<string> {
  const attestStr = buildAttestationString(attestationInput);
  const digest = hashAttestationString(attestStr);
  const sigBytes = await crypto.subtle.sign("Ed25519", privateKey, digest);
  return Buffer.from(sigBytes).toString("base64");
}

export async function run(): Promise<Result> {
  const results: Result = { passed: 0, failed: 0 };

  const keyA = await generateKeypair();
  const keyB = await generateKeypair();

  const attestationInput = {
    proposalId: "prop_test_verify_001",
    termsHash: "e790e5354b75b128c9588860537c4e6208b026c4653224a0a453fcac16811676",
    agreementCode: "PV4DBJZ9WQ",
    partyAAgentId: keyA.agentId,
    partyBAgentId: keyB.agentId,
    expiresAtIso: "2027-01-01T00:00:00.000Z",
  };

  const sigA = await signAttestation(keyA.privateKey, attestationInput);
  const sigB = await signAttestation(keyB.privateKey, attestationInput);

  await test("Both valid signatures: ok = true", async () => {
    const result = await verifyBothAttestations({ ...attestationInput, sigA, sigB });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.sigAValid, true);
    assert.strictEqual(result.sigBValid, true);
  }, results);

  await test("Invalid sigA: ok = false, sigAValid = false", async () => {
    const badSig = Buffer.alloc(64).toString("base64");
    const result = await verifyBothAttestations({ ...attestationInput, sigA: badSig, sigB });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.sigAValid, false);
    assert.strictEqual(result.sigBValid, true);
  }, results);

  await test("Invalid sigB: ok = false, sigBValid = false", async () => {
    const badSig = Buffer.alloc(64).toString("base64");
    const result = await verifyBothAttestations({ ...attestationInput, sigA, sigB: badSig });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.sigAValid, true);
    assert.strictEqual(result.sigBValid, false);
  }, results);

  await test("Swapped sigs (A uses B's sig): ok = false", async () => {
    const result = await verifyBothAttestations({ ...attestationInput, sigA: sigB, sigB: sigA });
    assert.strictEqual(result.ok, false);
  }, results);

  await test("Modified termsHash invalidates both sigs", async () => {
    const result = await verifyBothAttestations({
      ...attestationInput,
      termsHash: "0000000000000000000000000000000000000000000000000000000000000000",
      sigA,
      sigB,
    });
    assert.strictEqual(result.ok, false);
  }, results);

  await test("Invalid agentId (wrong pubkey): ok = false", async () => {
    const wrongKey = await generateKeypair();
    const result = await verifyBothAttestations({
      ...attestationInput,
      partyAAgentId: wrongKey.agentId, // wrong pubkey, same sig
      sigA,
      sigB,
    });
    assert.strictEqual(result.ok, false);
  }, results);

  await test("Malformed sigA (not base64): ok = false", async () => {
    const result = await verifyBothAttestations({
      ...attestationInput,
      sigA: "not-valid-base64!!!",
      sigB,
    });
    assert.strictEqual(result.ok, false);
  }, results);

  return results;
}
