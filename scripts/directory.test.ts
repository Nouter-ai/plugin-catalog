import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { buildDirectory } from "./directory.ts";
import { baseRepo, realRoot } from "./test-util.ts";
import { validateRepo } from "./validate.ts";

const APACHE = await readFile(new URL("../LICENSE", import.meta.url), "utf8");
const item = () => ({ type: "skill", name: "skill-creator", path: "skills/skill-creator", description: "d", category: "engineering", tags: [],
  author: "Anthropic", license: "Apache-2.0", verified: true, source: { repo: "anthropics/skills", commit: "2c5958e" } });

const copia = baseRepo;
async function conItems(items: unknown[], extra?: (root: string) => Promise<void>): Promise<string> {
  const root = await copia();
  await mkdir(join(root, "skills/skill-creator"), { recursive: true });
  await writeFile(join(root, "skills/skill-creator/SKILL.md"), "---\nname: skill-creator\ndescription: d\n---\n");
  await writeFile(join(root, "skills/skill-creator/LICENSE.txt"), APACHE);
  await writeFile(join(root, ".nouter/directory.json"), JSON.stringify({ items }));
  await extra?.(root);
  return root;
}
const falla = async (root: string, re: RegExp) => assert.match((await validateRepo(root)).join(" | "), re);

test("un item suelto válido pasa, con su SKILL.md y su licencia", async () => {
  assert.deepEqual(await validateRepo(await conItems([item()])), []);
});

test("cada regla de un item suelto falla con su palabra", async () => {
  await falla(await conItems([{ ...item(), type: "otro" }]), /type|tipo/);
  await falla(await conItems([{ ...item(), path: "skills/nada" }]), /path|no existe/);
  await falla(await conItems([item()], (r) => rm(join(r, "skills/skill-creator/LICENSE.txt"))), /licencia|license/);
  await falla(await conItems([{ ...item(), category: "otra" }]), /category|categoría/);
  await falla(await conItems([{ ...item(), license: "GPL-3.0" }]), /licencia|license/);
  await falla(await conItems([item(), item()]), /repetid/);
  await falla(await conItems([{ ...item(), flag: "no-existe" }]), /flag/);
  await falla(await conItems([{ ...item(), verified: "sí" }]), /verified/);
  await falla(await conItems([{ ...item(), type: "blueprint", name: "bp", path: "skills/skill-creator" }]), /blueprint\.json|path/);
});

test("el armado: delivery-salesforce con sus categorías, su ruta, su added, sus skills y el banner", async () => {
  const idx = await buildDirectory(realRoot, "v1", () => "2026-01-01T00:00:00Z");
  assert.equal(idx.repo, "plugin-catalog");
  assert.equal(idx.version, "v1");
  assert.deepEqual(idx.featured, []);
  const p = idx.entries.find((e) => e.id === "plugin:delivery-salesforce")!;
  assert.equal(p.type, "plugin");
  assert.deepEqual(p.categories, ["sales", "engineering", "automation-workflows"]);
  assert.equal(p.path, "plugins/delivery-salesforce");
  assert.equal(p.added, "2026-01-01T00:00:00Z");
  assert.equal(p.publisher, "Nouter");
  assert.equal(p.verified, true);
  assert.equal(p.flag, "salesforce-delivery");
  assert.equal(p.skills!.length, 6);
  assert.ok(p.skills!.includes("delivery-salesforce-build"));
  assert.ok(p.tagline.length <= 100);
  const ids = new Set(idx.entries.map((e) => e.id));
  for (const id of Object.values(idx.banner!)) assert.ok(ids.has(id), id);
});

test("un item suelto entra al índice como skill:<name>", async () => {
  const root = await conItems([item()]);
  const idx = await buildDirectory(root, "v1", () => "2026-01-01T00:00:00Z");
  const s = idx.entries.find((e) => e.id === "skill:skill-creator")!;
  assert.deepEqual([s.type, s.path, s.publisher, s.license, s.source], ["skill", "skills/skill-creator", "Anthropic", "Apache-2.0", { repo: "anthropics/skills", commit: "2c5958e" }]);
});

test("un destacado que nombra un id que no existe o de otro tipo falla", async () => {
  const con = async (featured: unknown) => {
    const root = await copia();
    await writeFile(join(root, ".nouter/featured.json"), JSON.stringify(featured));
    return root;
  };
  await falla(await con({ skills: "skill:nada" }), /featured/);
  await falla(await con({ plugins: "plugin:nada" }), /featured/);
  await falla(await con({ plugins: "skill:skill-creator" }), /featured/);
  await falla(await con({ otro: "x" }), /featured/);
  await assert.rejects(async () => buildDirectory(await con({ plugins: "plugin:nada" }), "v1", () => "x"), /featured/);
});

test("el repo real vale, y los dos workflows existen", async () => {
  assert.deepEqual(await validateRepo(realRoot), []);
  const ci = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(ci, /npm test/);
  assert.match(ci, /node scripts\/validate\.ts/);
  const rel = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  assert.match(rel, /fetch-depth: 0/);
  assert.match(rel, /dist\/directory\.json/);
  assert.match(rel, /release\/\$\{GITHUB_REF_NAME\}/);
  assert.match(rel, /contents: write/);
});
