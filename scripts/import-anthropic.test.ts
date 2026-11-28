import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CATEGORIES } from "./categories.ts";
import { validateRepo } from "./directory.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import { EXCLUDED, importAnthropic, leerLock, PLUGINS, SKILLS } from "./import-anthropic.ts";
import { anthropicFixtures, baseRepo } from "./test-util.ts";

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

test("las tablas: 15 plugins y 17 skills, sin pdf-viewer, cowork-plugin-management, academy-guide, doc-coauthoring ni partner-built, con temas de la lista y Apache-2.0", () => {
  assert.equal(PLUGINS.length, 15);
  assert.ok(!PLUGINS.some((p) => p.name === "pdf-viewer"));
  assert.match(EXCLUDED.find((x) => x.name === "pdf-viewer")!.reason, /stdio/);
  assert.match(EXCLUDED.find((x) => x.name === "cowork-plugin-management")!.reason, /Cowork/);
  assert.match(EXCLUDED.find((x) => x.name === "academy-guide")!.reason, /Claude Academy/);
  // doc-coauthoring queda afuera por no tener licencia, y por eso está en la lista: si no, el job la vería como nueva cada día.
  assert.deepEqual(EXCLUDED.find((x) => x.name === "doc-coauthoring")!.type, "skill");
  assert.match(EXCLUDED.find((x) => x.name === "doc-coauthoring")!.reason, /licencia/i);
  assert.deepEqual(EXCLUDED.map((x) => `${x.type}:${x.name}`).toSorted(), ["plugin:cowork-plugin-management", "plugin:pdf-viewer", "skill:academy-guide", "skill:doc-coauthoring"]);
  for (const x of EXCLUDED) assert.ok(!PLUGINS.some((p) => p.name === x.name) && !SKILLS.some((k) => k.name === x.name), x.name);
  // Cada fila sembrada trae su tagline curado, corto y para una persona (no la instrucción al modelo de la descripción).
  for (const row of [...PLUGINS, ...SKILLS]) assert.ok(row.tagline && row.tagline.length <= 100 && !/^(Use this|Stop and check|After you)/.test(row.tagline), row.name);
  assert.equal(SKILLS.length, 17);
  const names = SKILLS.map((s) => s.name);
  assert.ok(!names.includes("doc-coauthoring"));
  assert.ok(names.includes("skill-creator"));
  for (const x of ["apollo", "common-room", "slack", "zoom-plugin", "brand-voice"]) assert.ok(!PLUGINS.some((p) => p.name === x), x);
  for (const row of [...PLUGINS, ...SKILLS]) {
    assert.ok((CATEGORIES as readonly string[]).includes(row.category), row.name);
    assert.ok(row.tags.length <= 2 && row.tags.every((t) => (CATEGORIES as readonly string[]).includes(t) && t !== row.category), row.name);
  }
  assert.ok(SKILLS.every((s) => s.license === "Apache-2.0"));
  assert.equal(new Set(PLUGINS.map((p) => p.name)).size, 15);
  assert.equal(new Set(names).size, 17);
});

// Las carpetas de los dos upstream en los pins del lock (877a617b y 2c5958ec, medidos el 2026-11-28). Con las tablas
// inyectadas, cada una tiene que estar decidida: en la tabla de lo que entra o en EXCLUDED con su motivo. Lo que aparezca
// mañana no está acá; el job lo informa como nuevo y una persona decide.
const UPSTREAM_SKILLS = ["academy-guide", "algorithmic-art", "brand-guidelines", "canvas-design", "claude-api", "discernment-nudge",
  "doc-coauthoring", "docx", "frontend-design", "internal-comms", "mcp-builder", "pdf", "pptx", "skill-creator", "slack-gif-creator",
  "theme-factory", "web-artifacts-builder", "webapp-testing", "xlsx"];
const UPSTREAM_PLUGINS = ["bio-research", "cowork-plugin-management", "customer-support", "data", "design", "engineering",
  "enterprise-search", "finance", "human-resources", "legal", "marketing", "operations", "pdf-viewer", "product-management",
  "productivity", "sales", "small-business"];

test("EXCLUDED más las tablas cubren cada carpeta del upstream: ninguna queda sin decidir", () => {
  assert.equal(UPSTREAM_SKILLS.length, 19);
  assert.equal(UPSTREAM_PLUGINS.length, 17);
  const decididas = (tipo: "plugin" | "skill", tablas: { name: string }[]) =>
    new Set([...tablas.map((x) => x.name), ...EXCLUDED.filter((x) => x.type === tipo).map((x) => x.name)]);
  assert.deepEqual(UPSTREAM_SKILLS.filter((n) => !decididas("skill", SKILLS).has(n)), []);
  assert.deepEqual(UPSTREAM_PLUGINS.filter((n) => !decididas("plugin", PLUGINS).has(n)), []);
});

const COMMITS = { kwp: "877a617b435ee2edfb002d9a3703c0a1a03aa1ba", skills: "2c5958ecac7cee2b583967a2c4981d0f4a75c579" };
const TABLAS = {
  plugins: [{ name: "sales", category: "sales" as const, tags: ["marketing" as const] }, { name: "local", category: "engineering" as const, tags: [] }, { name: "engineering", category: "engineering" as const, tags: [] }],
  skills: [{ name: "alpha", category: "engineering" as const, tags: [], license: "Apache-2.0" as const }, { name: "beta", category: "design-media" as const, tags: [], license: "Apache-2.0" as const }],
};
const destino = baseRepo;

const MARKETPLACE = ".claude-plugin/marketplace.json";
const ITEMS = ".nouter/directory.json";
const commitDe = (m: any, name: string) => m.plugins.find((p: any) => p.name === name)["x-nouter"].source.commit;

test("los pins por defecto salen del lock del repo, y otro lock cambia el source.commit que se escribe", async () => {
  const lock = await leerLock();
  assert.match(lock.kwp, /^[0-9a-f]{40}$/);
  assert.match(lock.skills, /^[0-9a-f]{40}$/);
  const fx = await anthropicFixtures();

  const out = await destino();
  await importAnthropic({ kwp: fx.kwp, skills: fx.skills, out, tables: TABLAS });
  const m = await json(join(out, MARKETPLACE));
  assert.equal(commitDe(m, "sales"), lock.kwp, "sin commits, el default es el del lock");
  assert.equal((await json(join(out, ITEMS))).items[0].source.commit, lock.skills);

  // El lock es un dato: si cambia, lo que se escribe cambia con él.
  const otro = join(await mkdtemp(join(tmpdir(), "lock-")), "anthropic-lock.json");
  const pins = { kwp: "a".repeat(40), skills: "b".repeat(40) };
  await writeFile(otro, JSON.stringify(pins));
  const out2 = await destino();
  await importAnthropic({ kwp: fx.kwp, skills: fx.skills, out: out2, tables: TABLAS, lock: otro });
  assert.equal(commitDe(await json(join(out2, MARKETPLACE)), "sales"), pins.kwp);
  assert.equal((await json(join(out2, ITEMS))).items[0].source.commit, pins.skills);
});

test("el CLI exige los clones en los commits del lock, no en los que estaban en el código", async () => {
  const git = async (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: "pipe" });
  const repo = await mkdtemp(join(tmpdir(), "git-"));
  await git("-C", repo, "init", "-q");
  await git("-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-qm", "x");
  const script = fileURLToPath(new URL("./import-anthropic.ts", import.meta.url));
  const out = await destino();
  let salida = "";
  try {
    execFileSync(process.execPath, [script, repo, repo, out], { encoding: "utf8", stdio: "pipe" });
  } catch (e) {
    salida = `${(e as { stdout?: string }).stdout ?? ""}${(e as { stderr?: string }).stderr ?? ""}`;
  }
  const { kwp } = await leerLock();
  assert.match(salida, new RegExp(kwp), "el mensaje nombra el pin del lock");
  assert.deepEqual(await json(join(out, ITEMS)), { items: [] }, "no escribió nada");
});

test("importAnthropic copia lo libre, completa la licencia, omite lo que no la trae y conserva lo propio", async () => {
  const out = await destino();
  const fx = await anthropicFixtures();
  const n = await importAnthropic({ kwp: fx.kwp, skills: fx.skills, out, commits: COMMITS, tables: TABLAS });
  assert.equal(n, 3, "2 plugins (local, solo stdio, no) y la skill con licencia; beta no trae LICENSE.txt");
  // Copia tal cual, y a engineering (sin LICENSE) le pone la del root.
  // El .mcp.json queda salvo los servidores stdio: los http (con URL o vacía) no se tocan, y un plugin con solo stdio no se importa.
  assert.deepEqual(Object.keys((await json(join(out, "plugins/sales/.mcp.json"))).mcpServers), ["hubspot", "benchling"]);

  assert.ok((await stat(join(out, "plugins/sales/skills/forecast/SKILL.md"))).isFile());
  assert.equal(await readFile(join(out, "plugins/engineering/LICENSE"), "utf8"), await readFile(join(fx.kwp, "LICENSE"), "utf8"));
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

test("licenses va a x-nouter en el plugin y a la raíz del item en la skill; sin licenses no deja la clave", async () => {
  const fx = await anthropicFixtures();
  const conLicencias = { plugins: [{ ...TABLAS.plugins[0], licenses: ["OFL-1.1"] }], skills: [{ ...TABLAS.skills[0], licenses: ["OFL-1.1"] }] };
  const out = await destino();
  await importAnthropic({ kwp: fx.kwp, skills: fx.skills, out, commits: COMMITS, tables: conLicencias });
  assert.deepEqual((await json(join(out, MARKETPLACE))).plugins.find((p: any) => p.name === "sales")["x-nouter"].licenses, ["OFL-1.1"]);
  assert.deepEqual((await json(join(out, ITEMS))).items[0].licenses, ["OFL-1.1"]);

  const sin = await destino();
  await importAnthropic({ kwp: fx.kwp, skills: fx.skills, out: sin, commits: COMMITS, tables: TABLAS });
  assert.ok(!("licenses" in (await json(join(sin, MARKETPLACE))).plugins.find((p: any) => p.name === "sales")["x-nouter"]));
  assert.ok(!("licenses" in (await json(join(sin, ITEMS))).items[0]));
});

test("las dos OFL que el upstream no trae vienen de scripts/font-licenses, tal como las publican sus proyectos", async () => {
  const plex = await readFile(new URL("./font-licenses/IBMPlexSerif-OFL.txt", import.meta.url), "utf8");
  const serif = await readFile(new URL("./font-licenses/InstrumentSerif-OFL.txt", import.meta.url), "utf8");
  assert.match(plex, /Copyright © 2017 IBM Corp\. with Reserved Font Name "Plex"/);
  assert.match(plex, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(serif, /Copyright 2022 The Instrument Serif Project Authors/);
  assert.match(serif, /SIL OPEN FONT LICENSE Version 1\.1/);
});

test("después de copiar una skill, repone el texto de las dos familias que no lo traen y deja las demás como están", async () => {
  const out = await destino();
  const fx = await anthropicFixtures();
  const fuentes = join(fx.skills, "skills/alpha/canvas-fonts");
  await mkdir(fuentes, { recursive: true });
  for (const f of ["IBMPlexSerif-Regular.ttf", "IBMPlexSerif-Bold.ttf", "InstrumentSerif-Italic.ttf", "Otra-Regular.ttf"]) {
    await writeFile(join(fuentes, f), "");
  }
  const tablas = { plugins: [], skills: [{ ...TABLAS.skills[0], licenses: ["OFL-1.1"] }] };
  await importAnthropic({ kwp: fx.kwp, skills: fx.skills, out, commits: COMMITS, tables: tablas });
  const copiadas = join(out, "skills/alpha/canvas-fonts");
  assert.equal(await readFile(join(copiadas, "IBMPlexSerif-OFL.txt"), "utf8"),
    await readFile(new URL("./font-licenses/IBMPlexSerif-OFL.txt", import.meta.url), "utf8"));
  assert.equal(await readFile(join(copiadas, "InstrumentSerif-OFL.txt"), "utf8"),
    await readFile(new URL("./font-licenses/InstrumentSerif-OFL.txt", import.meta.url), "utf8"));
  // Una familia que no está en el mapa queda sin texto: el CI la frena hasta que alguien lo agregue.
  await assert.rejects(stat(join(copiadas, "Otra-OFL.txt")));
});

test("correrlo dos veces no duplica nada", async () => {
  const out = await destino();
  const fx = await anthropicFixtures();
  const opts = { kwp: fx.kwp, skills: fx.skills, out, commits: COMMITS, tables: TABLAS };
  await importAnthropic(opts);
  const leer = async () => [await readFile(join(out, ".claude-plugin/marketplace.json"), "utf8"), await readFile(join(out, ".nouter/directory.json"), "utf8")];
  const antes = await leer();
  await importAnthropic(opts);
  assert.deepEqual(await leer(), antes);
});

test("un plugin de la tabla que el repo de origen no tiene corta la importación", async () => {
  const out = await destino();
  const fx = await anthropicFixtures();
  await assert.rejects(importAnthropic({ kwp: fx.kwp, skills: fx.skills, out, commits: COMMITS,
    tables: { plugins: [{ name: "nada", category: "sales", tags: [] }], skills: [] } }), /nada/);
});

test("el repo sembrado: 16 plugins (15 y delivery-salesforce) y 17 skills sueltas, cada uno con su origen fijado", async () => {
  const { buildDirectory } = await import("./directory.ts");
  const { realRoot } = await import("./test-util.ts");
  const idx = await buildDirectory(realRoot, "v1", () => "2026-01-01T00:00:00Z");
  assert.equal(idx.entries.length, 33);
  assert.equal(idx.entries.filter((e) => e.type === "plugin").length, 16);
  assert.equal(idx.entries.filter((e) => e.type === "skill").length, 17);
  const sembradas = idx.entries.filter((e) => e.source);
  assert.equal(sembradas.length, 32);
  assert.ok(sembradas.every((e) => e.publisher === "Anthropic" && e.verified && /^[0-9a-f]{40}$/.test(e.source!.commit)));
  assert.deepEqual(idx.banner, { skills: "skill:skill-creator", plugins: "plugin:sales" });
  assert.ok(idx.entries.find((e) => e.id === "plugin:sales")!.skills!.length > 0);
  for (const e of idx.entries) assert.ok(e.tagline.length <= 100, e.id);
  assert.ok(!idx.entries.some((e) => /^(Use this|Stop and check)/.test(e.tagline)));
  assert.ok(!idx.entries.some((e) => e.id === "plugin:cowork-plugin-management" || e.id === "skill:academy-guide" || e.id === "plugin:pdf-viewer"));
});

test("el tagline curado va a la entrada y se conserva si la tabla no lo trae; lo excluido se borra del destino", async () => {
  const out = await destino();
  const fx = await anthropicFixtures();
  const tablas = { plugins: [{ name: "sales", category: "sales" as const, tags: [], tagline: "Prep calls and run your pipeline" }], skills: [{ ...TABLAS.skills[0], tagline: "Does a thing, well" }] };
  const base = { kwp: fx.kwp, skills: fx.skills, out, commits: COMMITS };
  await importAnthropic({ ...base, tables: tablas });
  const m = await json(join(out, ".claude-plugin/marketplace.json"));
  assert.equal(m.plugins.find((p: any) => p.name === "sales")["x-nouter"].tagline, "Prep calls and run your pipeline");
  assert.equal((await json(join(out, ".nouter/directory.json"))).items[0].tagline, "Does a thing, well");
  // Sin tagline en la tabla, queda el que ya estaba.
  await importAnthropic({ ...base, tables: { plugins: [{ name: "sales", category: "sales", tags: [] }], skills: [{ ...TABLAS.skills[0] }] } });
  assert.equal((await json(join(out, ".claude-plugin/marketplace.json"))).plugins.find((p: any) => p.name === "sales")["x-nouter"].tagline, "Prep calls and run your pipeline");
  assert.equal((await json(join(out, ".nouter/directory.json"))).items[0].tagline, "Does a thing, well");
  // Lo excluido se borra: carpeta y fila.
  await importAnthropic({ ...base, tables: { plugins: [], skills: [] }, excluded: [{ type: "plugin", name: "sales", reason: "x" }, { type: "skill", name: "alpha", reason: "x" }] });
  assert.deepEqual((await json(join(out, ".claude-plugin/marketplace.json"))).plugins.map((p: any) => p.name), ["delivery-salesforce"]);
  assert.deepEqual((await json(join(out, ".nouter/directory.json"))).items, []);
  await assert.rejects(stat(join(out, "plugins/sales")));
  await assert.rejects(stat(join(out, "skills/alpha")));
});
