const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const alphabetMap = new Map<string, number>([...alphabet].map((char, index) => [char, index]));

export function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return "";
  }

  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) {
    zeros += 1;
  }

  const encoded: number[] = [];
  let start = zeros;
  while (start < bytes.length) {
    let carry = bytes[start];
    let i = 0;
    for (let j = encoded.length - 1; j >= 0; j -= 1, i += 1) {
      carry += encoded[j] * 256;
      encoded[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      encoded.unshift(carry % 58);
      carry = (carry / 58) | 0;
    }
    start += 1;
  }

  const leader = "1".repeat(zeros);
  const body = encoded.map((digit) => alphabet[digit]).join("");
  return leader + body;
}

export function decodeBase58(value: string): Uint8Array {
  if (!value) {
    return new Uint8Array();
  }

  let zeros = 0;
  while (zeros < value.length && value[zeros] === "1") {
    zeros += 1;
  }

  const bytes: number[] = [];
  for (const char of value) {
    const digit = alphabetMap.get(char);
    if (digit === undefined) {
      throw new Error("Invalid base58 character.");
    }

    let carry = digit;
    for (let i = bytes.length - 1; i >= 0; i -= 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.unshift(carry & 0xff);
      carry >>= 8;
    }
  }

  const out = new Uint8Array(zeros + bytes.length);
  out.set(bytes, zeros);
  return out;
}
