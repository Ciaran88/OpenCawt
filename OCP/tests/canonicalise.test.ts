import { strict as assert } from "node:assert";
import {
  buildCanonicalTerms,
  toCanonicalJsonString,
  computeTermsHash,
  buildAttestationString,
} from "../server/canonicalise/index";
import { deriveAgreementCode } from "../server/ids";
import { ALL_VECTORS } from "../server/canonicalise/testVectors";

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

  // ---- Test vectors ----
  for (const vector of ALL_VECTORS) {
    await test(`Vector: ${vector.description} - canonical JSON`, () => {
      const canonical = buildCanonicalTerms(vector.input);
      const json = toCanonicalJsonString(canonical);
      assert.strictEqual(json, vector.expectedCanonicalJson);
    }, results);

    await test(`Vector: ${vector.description} - termsHash`, () => {
      const canonical = buildCanonicalTerms(vector.input);
      const json = toCanonicalJsonString(canonical);
      const hash = computeTermsHash(json);
      assert.strictEqual(hash, vector.expectedTermsHash);
    }, results);

    await test(`Vector: ${vector.description} - agreementCode`, () => {
      const code = deriveAgreementCode(vector.expectedTermsHash);
      assert.strictEqual(code, vector.expectedAgreementCode);
    }, results);
  }

  // ---- Whitespace normalisation ----
  await test("Whitespace: tabs and multiple spaces collapsed to single space", () => {
    const input = {
      ...ALL_VECTORS[0].input,
      obligations: [
        {
          actorAgentId: "AgentABase58PublicKey1111",
          action: "deliver",
          deliverable: "Widget\t with\t  tabs",
        },
      ],
    };
    const canonical = buildCanonicalTerms(input);
    const deliverable = (canonical.obligations[0] as { deliverable: string }).deliverable;
    assert.strictEqual(deliverable, "Widget with tabs");
  }, results);

  await test("Whitespace: leading and trailing whitespace trimmed", () => {
    const input = {
      ...ALL_VECTORS[0].input,
      obligations: [
        {
          actorAgentId: "AgentABase58PublicKey1111",
          action: "  deliver  ",
          deliverable: " Widget ",
        },
      ],
    };
    const canonical = buildCanonicalTerms(input);
    assert.strictEqual((canonical.obligations[0] as { action: string }).action, "deliver");
    assert.strictEqual((canonical.obligations[0] as { deliverable: string }).deliverable, "Widget");
  }, results);

  // ---- Key sorting ----
  await test("Key sorting: obligation keys sorted lexicographically", () => {
    const canonical = buildCanonicalTerms(ALL_VECTORS[0].input);
    const json = toCanonicalJsonString(canonical);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const obligationKeys = Object.keys((parsed.obligations as unknown[])[0] as object);
    const sorted = [...obligationKeys].sort();
    assert.deepStrictEqual(obligationKeys, sorted);
  }, results);

  // ---- Optional field stripping ----
  await test("Optional fields: absent conditions key absent from canonical JSON", () => {
    // Vector 1 obligation has no conditions field — verify it's not in the output
    const canonical = buildCanonicalTerms(ALL_VECTORS[0].input);
    const json = toCanonicalJsonString(canonical);
    const parsed = JSON.parse(json) as { obligations: Array<Record<string, unknown>> };
    assert.ok(!("conditions" in parsed.obligations[0]), "conditions key should be absent when not provided");
  }, results);

  await test("Optional fields: present conditions key included in canonical JSON", () => {
    const input = {
      ...ALL_VECTORS[0].input,
      obligations: [
        {
          actorAgentId: "AgentABase58PublicKey1111",
          action: "deliver",
          deliverable: "Widget",
          conditions: "Must complete by due date.",
        },
      ],
    };
    const canonical = buildCanonicalTerms(input);
    const json = toCanonicalJsonString(canonical);
    assert.ok(json.includes('"conditions"'), "conditions key should be present when set");
  }, results);

  // ---- Determinism ----
  await test("Determinism: same input always produces same hash", () => {
    const canonical1 = buildCanonicalTerms(ALL_VECTORS[0].input);
    const canonical2 = buildCanonicalTerms(ALL_VECTORS[0].input);
    assert.strictEqual(
      computeTermsHash(toCanonicalJsonString(canonical1)),
      computeTermsHash(toCanonicalJsonString(canonical2))
    );
  }, results);

  // ---- Attestation string ----
  await test("Attestation string: correct pipe-delimited format", () => {
    const str = buildAttestationString({
      proposalId: "prop_test_0001",
      termsHash: "abc123",
      agreementCode: "TESTCODE01",
      partyAAgentId: "agentA",
      partyBAgentId: "agentB",
      expiresAtIso: "2026-03-01T00:00:00.000Z",
    });
    assert.strictEqual(
      str,
      "OPENCAWT_AGREEMENT_V1|prop_test_0001|abc123|TESTCODE01|agentA|agentB|2026-03-01T00:00:00.000Z"
    );
  }, results);

  // ---- Agreement code ----
  await test("Agreement code: exactly 10 characters", () => {
    const code = deriveAgreementCode(ALL_VECTORS[0].expectedTermsHash);
    assert.strictEqual(code.length, 10);
  }, results);

  await test("Agreement code: Crockford alphabet only (no I, L, O, U)", () => {
    const code = deriveAgreementCode(ALL_VECTORS[0].expectedTermsHash);
    assert.ok(/^[0-9A-HJKMNP-TV-Z]{10}$/.test(code), `Invalid code: ${code}`);
  }, results);

  await test("Agreement code: different hashes produce different codes", () => {
    const code1 = deriveAgreementCode(ALL_VECTORS[0].expectedTermsHash);
    const code2 = deriveAgreementCode(ALL_VECTORS[1].expectedTermsHash);
    assert.notStrictEqual(code1, code2);
  }, results);

  return results;
}
