import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { CATEGORIES } from "./categories.ts";
import { validateRepo } from "./directory.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import { EXCLUDED, importAnthropic, PLUGINS, SKILLS } from "./import-anthropic.ts";
import { baseRepo } from "./test-util.ts";

const fx = (p: string) => new URL(`./__fixtures__/${p}`, import.meta.url).pathname;
const json = async (p: string) => JSON.parse(await readFile(p, "utf8"));

test("parseFrontmatter lee los tres formatos reales: >, |- y una línea (con y sin comillas)", () => {
  assert.deepEqual(parseFrontmatter("---\nname: a\ndescription: >\n  Uno dos\n  tres cuatro.\n  Cinco.\nlicense: x\n---\ncuerpo"),
    { name: "a", description: "Uno dos tres cuatro. Cinco." });
  assert.deepEqual(parseFrontmatter("---\nname: b\ndescription: |-\n  Primera línea.\n  Segunda línea.\nlicense: x\n---\n"),
    { name: "b", description: "Primera línea.\nSegunda línea." });
  assert.deepEqual(parseFrontmatter("---\nname: c\ndescription: Una sola línea: con dos puntos.\n---\n"), { name: "c", description: "Una sola línea: con dos puntos." });
  assert.deepEqual(parseFrontmatter('---\nname: d\ndescription: "Dice \\"hola\\"."\n---\n'), { name: "d", description: 'Dice "hola".' });
  assert.throws(() => parseFrontmatter("sin frontmatter"), /frontmatter/);
  assert.throws(() => parseFrontmatter("---\nname: e\n---\n"), /description/);
});

test("las tablas: 16 plugins y 18 skills, sin pdf-viewer, doc-coauthoring ni partner-built, con temas de la lista y Apache-2.0", () => {
  assert.equal(PLUGINS.length, 16);
  assert.ok(!PLUGINS.some((p) => p.name === "pdf-viewer"));
  assert.match(EXCLUDED.find((x) => x.name === "pdf-viewer")!.reason, /stdio/);
  assert.equal(SKILLS.length, 18);
  const names = SKILLS.map((s) => s.name);
  assert.ok(!names.includes("doc-coauthoring"));
  assert.ok(names.includes("skill-creator"));
  for (const x of ["apollo", "common-room", "slack", "zoom-plugin", "brand-voice"]) assert.ok(!PLUGINS.some((p) => p.name === x), x);
  for (const row of [...PLUGINS, ...SKILLS]) {
    assert.ok((CATEGORIES as readonly string[]).includes(row.category), row.name);
    assert.ok(row.tags.length <= 2 && row.tags.every((t) => (CATEGORIES as readonly string[]).includes(t) && t !== row.category), row.name);
  }
  assert.ok(SKILLS.every((s) => s.license === "Apache-2.0"));
  assert.equal(new Set(PLUGINS.map((p) => p.name)).size, 16);
  assert.equal(new Set(names).size, 18);
});

const COMMITS = { kwp: "877a617b435ee2edfb002d9a3703c0a1a03aa1ba", skills: "2c5958ecac7cee2b583967a2c4981d0f4a75c579" };
const TABLAS = {
  plugins: [{ name: "sales", category: "sales" as const, tags: ["marketing" as const] }, { name: "local", category: "engineering" as const, tags: [] }, { name: "engineering", category: "engineering" as const, tags: [] }],
  skills: [{ name: "alpha", category: "engineering" as const, tags: [], license: "Apache-2.0" as const }, { name: "beta", category: "design-media" as const, tags: [], license: "Apache-2.0" as const }],
};
const destino = baseRepo;

test("importAnthropic copia lo libre, completa la licencia, omite lo que no la trae y conserva lo propio", async () => {
  const out = await destino();
  const n = await importAnthropic({ kwp: fx("kwp"), skills: fx("skills"), out, commits: COMMITS, tables: TABLAS });
  assert.equal(n, 3, "2 plugins (local, solo stdio, no) y la skill con licencia; beta no trae LICENSE.txt");
  // Copia tal cual, y a engineering (sin LICENSE) le pone la del root.
  // El .mcp.json queda salvo los servidores stdio: los http (con URL o vacía) no se tocan, y un plugin con solo stdio no se importa.
  assert.deepEqual(Object.keys((await json(join(out, "plugins/sales/.mcp.json"))).mcpServers), ["hubspot", "benchling"]);

  assert.ok((await stat(join(out, "plugins/sales/skills/forecast/SKILL.md"))).isFile());
  assert.equal(await readFile(join(out, "plugins/engineering/LICENSE"), "utf8"), await readFile(fx("kwp/LICENSE"), "utf8"));
  await assert.rejects(stat(join(out, "skills/beta")));
  assert.ok((await stat(join(out, "skills/alpha/LICENSE.txt"))).isFile());
  // El marketplace: lo propio sigue y cada entrada lleva su origen y sus datos.
  const m = await json(join(out, ".claude-plugin/marketplace.json"));
  assert.deepEqual(m.plugins.map((p: any) => p.name), ["delivery-salesforce", "sales", "engineering"], "local (solo stdio) no entra");
  await assert.rejects(stat(join(out, "plugins/local")));
  const sales = m.plugins.find((p: any) => p.name === "sales");
  assert.deepEqual([sales.version, sales.description, sales.license, sales.category, sales.tags, sales.author, sales.displayName],
    ["2.1.0", "Sell more. Close faster.", "Apache-2.0", "sales", ["marketing"], { name: "Anthropic" }, "Sales"]);
  assert.deepEqual(sales["x-nouter"], { verified: true, source: { repo: "anthropics/knowledge-work-plugins", commit: COMMITS.kwp } });
  assert.equal(m.plugins[0]["x-nouter"].flag, "salesforce-delivery");
  // La skill suelta, con su origen.
  const d = await json(join(out, ".nouter/directory.json"));
  assert.deepEqual(d.items, [{ type: "skill", name: "alpha", path: "skills/alpha", description: "Alpha does a thing. It does it well.", category: "engineering",
    tags: [], author: "Anthropic", license: "Apache-2.0", verified: true, source: { repo: "anthropics/skills", commit: COMMITS.skills } }]);
  assert.deepEqual(await validateRepo(out), []);
});

test("correrlo dos veces no duplica nada", async () => {
  const out = await destino();
  const opts = { kwp: fx("kwp"), skills: fx("skills"), out, commits: COMMITS, tables: TABLAS };
  await importAnthropic(opts);
  const leer = async () => [await readFile(join(out, ".claude-plugin/marketplace.json"), "utf8"), await readFile(join(out, ".nouter/directory.json"), "utf8")];
  const antes = await leer();
  await importAnthropic(opts);
  assert.deepEqual(await leer(), antes);
});

test("un plugin de la tabla que el repo de origen no tiene corta la importación", async () => {
  const out = await destino();
  await assert.rejects(importAnthropic({ kwp: fx("kwp"), skills: fx("skills"), out, commits: COMMITS,
    tables: { plugins: [{ name: "nada", category: "sales", tags: [] }], skills: [] } }), /nada/);
});

test("el repo sembrado: 17 plugins (16 y delivery-salesforce) y 18 skills sueltas, cada uno con su origen fijado", async () => {
  const { buildDirectory } = await import("./directory.ts");
  const { realRoot } = await import("./test-util.ts");
  const idx = await buildDirectory(realRoot, "v1", () => "2026-01-01T00:00:00Z");
  assert.equal(idx.entries.length, 35);
  assert.equal(idx.entries.filter((e) => e.type === "plugin").length, 17);
  assert.equal(idx.entries.filter((e) => e.type === "skill").length, 18);
  const sembradas = idx.entries.filter((e) => e.source);
  assert.equal(sembradas.length, 34);
  assert.ok(sembradas.every((e) => e.publisher === "Anthropic" && e.verified && /^[0-9a-f]{40}$/.test(e.source!.commit)));
  assert.deepEqual(idx.banner, { skills: "skill:skill-creator", plugins: "plugin:sales" });
  assert.ok(idx.entries.find((e) => e.id === "plugin:sales")!.skills!.length > 0);
});
