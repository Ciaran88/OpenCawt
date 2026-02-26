/**
 * Unit tests for notifyUrl validation (SSRF protection).
 */

import { strict as assert } from "node:assert";
import { isBlockedNotifyUrlHost, isValidNotifyUrl } from "../server/notifyUrlValidation";

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

export async function run(): Promise<{ passed: number; failed: number }> {
  const results: Result = { passed: 0, failed: 0 };

  await test("isBlockedNotifyUrlHost: localhost blocked", () => {
    assert.strictEqual(isBlockedNotifyUrlHost("localhost"), true);
  }, results);

  await test("isBlockedNotifyUrlHost: 127.0.0.1 blocked", () => {
    assert.strictEqual(isBlockedNotifyUrlHost("127.0.0.1"), true);
  }, results);

  await test("isBlockedNotifyUrlHost: 0.0.0.0 blocked", () => {
    assert.strictEqual(isBlockedNotifyUrlHost("0.0.0.0"), true);
  }, results);

  await test("isBlockedNotifyUrlHost: ::1 blocked", () => {
    assert.strictEqual(isBlockedNotifyUrlHost("::1"), true);
  }, results);

  await test("isBlockedNotifyUrlHost: 169.254.169.254 blocked (cloud metadata)", () => {
    assert.strictEqual(isBlockedNotifyUrlHost("169.254.169.254"), true);
  }, results);

  await test("isBlockedNotifyUrlHost: 10.0.0.1 blocked (RFC 1918)", () => {
    assert.strictEqual(isBlockedNotifyUrlHost("10.0.0.1"), true);
  }, results);

  await test("isBlockedNotifyUrlHost: 172.16.0.1 blocked (RFC 1918)", () => {
    assert.strictEqual(isBlockedNotifyUrlHost("172.16.0.1"), true);
  }, results);

  await test("isBlockedNotifyUrlHost: 192.168.1.1 blocked (RFC 1918)", () => {
    assert.strictEqual(isBlockedNotifyUrlHost("192.168.1.1"), true);
  }, results);

  await test("isBlockedNotifyUrlHost: metadata.google.internal blocked", () => {
    assert.strictEqual(isBlockedNotifyUrlHost("metadata.google.internal"), true);
  }, results);

  await test("isBlockedNotifyUrlHost: example.local blocked", () => {
    assert.strictEqual(isBlockedNotifyUrlHost("example.local"), true);
  }, results);

  await test("isBlockedNotifyUrlHost: example.com allowed", () => {
    assert.strictEqual(isBlockedNotifyUrlHost("example.com"), false);
  }, results);

  await test("isBlockedNotifyUrlHost: api.example.com allowed", () => {
    assert.strictEqual(isBlockedNotifyUrlHost("api.example.com"), false);
  }, results);

  await test("isBlockedNotifyUrlHost: 8.8.8.8 allowed (public IP)", () => {
    assert.strictEqual(isBlockedNotifyUrlHost("8.8.8.8"), false);
  }, results);

  await test("isValidNotifyUrl: https://example.com/webhook allowed (prod)", () => {
    assert.strictEqual(isValidNotifyUrl("https://example.com/webhook", false), true);
  }, results);

  await test("isValidNotifyUrl: https://127.0.0.1/webhook blocked (prod)", () => {
    assert.strictEqual(isValidNotifyUrl("https://127.0.0.1/webhook", false), false);
  }, results);

  await test("isValidNotifyUrl: https://169.254.169.254/ blocked (prod)", () => {
    assert.strictEqual(isValidNotifyUrl("https://169.254.169.254/", false), false);
  }, results);

  await test("isValidNotifyUrl: http://localhost:8080/webhook blocked even in dev (SSRF)", () => {
    assert.strictEqual(isValidNotifyUrl("http://localhost:8080/webhook", true), false);
  }, results);

  await test("isValidNotifyUrl: http://example.com/webhook allowed in dev", () => {
    assert.strictEqual(isValidNotifyUrl("http://example.com/webhook", true), true);
  }, results);

  await test("isValidNotifyUrl: ftp://example.com blocked", () => {
    assert.strictEqual(isValidNotifyUrl("ftp://example.com/webhook", true), false);
  }, results);

  await test("isValidNotifyUrl: invalid URL returns false", () => {
    assert.strictEqual(isValidNotifyUrl("not-a-url", false), false);
  }, results);

  return results;
}
