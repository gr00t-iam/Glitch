import { webcrypto } from "node:crypto";
import { TextDecoder, TextEncoder } from "node:util";
import { decryptCredential, encryptCredential } from "../src/db/nexusDB";

beforeAll(() => {
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
  Object.defineProperty(globalThis, "TextDecoder", { configurable: true, value: TextDecoder });
  Object.defineProperty(globalThis, "TextEncoder", { configurable: true, value: TextEncoder });
});

test("rebranding preserves the prototype's encrypted credentials", async () => {
  const digest = Buffer.from("d490d6f15e25baf260fa572badff8d4f8c9d1070e50a9c5c37986af74566b099", "hex");
  const key = await webcrypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt"]);
  const iv = new Uint8Array(12);
  const data = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, Buffer.from("saved-test-credential"));
  const payload = JSON.stringify({ alg: "AES-GCM", iv: Buffer.from(iv).toString("base64"), data: Buffer.from(data).toString("base64") });
  expect(await decryptCredential(payload)).toBe("saved-test-credential");
  expect(await decryptCredential(await encryptCredential("new-test-credential"))).toBe("new-test-credential");
});
