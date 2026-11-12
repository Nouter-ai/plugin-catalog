import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { decide, parseLsRemote } from "./release-branch.ts";

test("la rama release/vN: se empuja si no existe, se deja si ya está en este commit y falla si está en otro", () => {
  assert.equal(decide(null, "abc"), "push");
  assert.equal(decide("abc", "abc"), "skip");
  assert.equal(decide("def", "abc"), "conflict");
});

test("parseLsRemote lee el sha de la rama, o null si no hay", () => {
  assert.equal(parseLsRemote(""), null);
  assert.equal(parseLsRemote("0123456789abcdef0123456789abcdef01234567\trefs/heads/release/v1\n"), "0123456789abcdef0123456789abcdef01234567");
});

test("el workflow de release usa el script, para que un re-run tras un gh release fallido funcione", async () => {
  const y = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  assert.match(y, /node scripts\/release-branch\.ts/);
  assert.ok(!/ls-remote --exit-code/.test(y));
});
