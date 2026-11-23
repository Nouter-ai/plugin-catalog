import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { editorsErrors } from "./editors.ts";
import { baseRepo, realRoot } from "./test-util.ts";
import { validateRepo } from "./validate.ts";

const N = { editorId: "nouter", kind: "nouter", name: "Nouter", verified: true };
const A = { editorId: "anthropic", kind: "anthropic", name: "Anthropic", verified: true };
const partner = (name: string, verified = true) => ({ editorId: name.toLowerCase(), kind: "partner", name, verified });
const item = (author: unknown, verified: unknown) => ({ type: "skill", name: "acme-skill", path: "skills/acme-skill", description: "d",
  category: "engineering", tags: [], author, license: "Apache-2.0", verified });

// Un repo temporal con los editores y las skills sueltas que se le pasen; el marketplace de base es delivery-salesforce (Nouter).
async function con(editors: unknown, items: unknown[] = [], extra?: (root: string) => Promise<void>): Promise<string> {
  const root = await baseRepo();
  await writeFile(join(root, "schema/editors.json"), JSON.stringify({ editors }));
  await writeFile(join(root, ".nouter/directory.json"), JSON.stringify({ items }));
  await extra?.(root);
  return root;
}
const falla = async (root: string, re: RegExp) => assert.match((await editorsErrors(root)).join(" | "), re);

test("el repo real vale: los editores de hoy y cada entrada del índice con el suyo", async () => {
  assert.deepEqual(await editorsErrors(realRoot), []);
  assert.deepEqual(await validateRepo(realRoot), []);
  const { editors } = JSON.parse(await readFile(join(realRoot, "schema/editors.json"), "utf8"));
  assert.deepEqual(editors, [N, A]);
});

test("un publisher sin editor falla; el archivo se nombra junto con la entrada", async () => {
  await falla(await con([N, A], [item("Inventado", true)]), /skill:acme-skill.*publisher Inventado.*no es un editor/);
  await falla(await con([], []), /plugin:delivery-salesforce.*publisher Nouter.*no es un editor/);
});

test("el verified de una entrada tiene que coincidir con el de su editor, en las dos direcciones", async () => {
  await falla(await con([N, A], [item("Anthropic", false)]), /skill:acme-skill.*verified.*no coincide/);
  await falla(await con([N, { ...A, verified: false }], [item("Anthropic", true)]), /skill:acme-skill.*verified.*no coincide/);
});

test("un partner sin verificar no puede tener entradas; uno verificado con una entrada que verifica pasa", async () => {
  await falla(await con([N, A, partner("Acme", false)], [item("Acme", false)]), /skill:acme-skill.*Acme.*partner sin verificar/);
  assert.deepEqual(await editorsErrors(await con([N, A, partner("Acme")], [item("Acme", true)])), []);
});

test("un editor sin entradas no es error: un partner puede estar registrado y no haber publicado nada", async () => {
  assert.deepEqual(await editorsErrors(await con([N, A, partner("Acme")], [])), []);
});

test("cada regla del archivo falla con su palabra", async () => {
  await falla(await con([N, { ...A, editorId: "nouter" }], []), /editorId repetido/);
  await falla(await con([N, { ...A, name: "Nouter" }], []), /name Nouter repetido/);
  await falla(await con([N, { ...A, kind: "otro" }], []), /kind.*nouter, anthropic o partner/);
  await falla(await con([N, { ...A, editorId: "Anthropic" }], []), /editorId.*slug/);
  await falla(await con([N, { ...A, name: "" }], []), /name.*obligatorio/);
  await falla(await con([N, { ...A, verified: "sí" }], []), /verified.*true o false/);
  await falla(await con([N, { ...A, contact: "security@example.com" }], []), /clave desconocida contact/);
  await falla(await con([N, A], [], (r) => writeFile(join(r, "schema/editors.json"), JSON.stringify({ editors: [N, A], extra: 1 }))), /clave desconocida extra/);
  await falla(await con([N, A], [], (r) => writeFile(join(r, "schema/editors.json"), JSON.stringify({ editors: {} }))), /editors.*\[\.\.\.\]/);
  await falla(await con([N, A], [], (r) => rm(join(r, "schema/editors.json"))), /schema\/editors\.json.*no existe o no es JSON/);
});

test("validateRepo hace valer el archivo, como el resto del repo", async () => {
  assert.deepEqual(await validateRepo(await con([N, A])), []);
  const roto = await con([N, A], [], (r) => rm(join(r, "schema/editors.json")));
  assert.match((await validateRepo(roto)).join(" | "), /schema\/editors\.json/);
});
