function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function assertValidNumber(value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error("Canonical JSON rejects non-finite numbers.");
  }
}

function assertUnsupportedType(value: unknown): void {
  const valueType = typeof value;
  if (valueType === "undefined" || valueType === "function" || valueType === "symbol") {
    throw new Error(`Canonical JSON rejects type ${valueType}.`);
  }
}

function canonicaliseValue(value: unknown): string {
  assertUnsupportedType(value);

  if (value === null || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    assertValidNumber(value);
    return JSON.stringify(value);
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicaliseValue(item)).join(",")}]`;
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    const pairs: string[] = [];

    for (const key of keys) {
      const item = value[key];
      assertUnsupportedType(item);
      if (item === undefined) {
        throw new Error("Canonical JSON rejects undefined properties.");
      }
      pairs.push(`${JSON.stringify(key)}:${canonicaliseValue(item)}`);
    }

    return `{${pairs.join(",")}}`;
  }

  throw new Error("Canonical JSON only supports JSON values.");
}

export function canonicalJson(value: unknown): string {
  return canonicaliseValue(value);
}
