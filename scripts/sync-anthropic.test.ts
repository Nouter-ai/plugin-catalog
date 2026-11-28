import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { importAnthropic } from "./import-anthropic.ts";
import { actualizarClon, syncAnthropic } from "./sync-anthropic.ts";
import { anthropicUpstream, baseRepo } from "./test-util.ts";

const APACHE = await readFile(new URL("../LICENSE", import.meta.url), "utf8");
const MIT = "MIT License\n\nCopyright (c) 2026 X\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files";
const TABLAS = {
  plugins: [{ name: "sales", category: "sales" as const, tags: ["marketing" as const] }, { name: "engineering", category: "engineering" as const, tags: [] }],
  skills: [{ name: "alpha", category: "engineering" as const, tags: [], license: "Apache-2.0" as const },
    { name: "beta", category: "design-media" as const, tags: [], license: "Apache-2.0" as const }],
};
const VIEJO = { kwp: "1".repeat(40), skills: "2".repeat(40) };
const NUEVO = { kwp: "5".repeat(40), skills: "e".repeat(40) };
const MCP = { mcpServers: { hubspot: { type: "http", url: "https://mcp.hubspot.com/v1" }, benchling: { type: "http", url: "" } } };

// El catálogo con el seed de los fixtures en los pines viejos, su lock y un informe afuera: lo que hay antes de que corra el job.
async function armado(mutar?: (fx: { dir: string; kwp: string; skills: string }) => Promise<void>) {
  const out = await baseRepo();
  const fx = await anthropicUpstream({ plugins: ["sales", "engineering"], skills: ["alpha", "beta"] });
  await writeFile(join(fx.kwp, "sales/.mcp.json"), JSON.stringify(MCP));
  await importAnthropic({ kwp: fx.kwp, skills: fx.skills, out, commits: VIEJO, tables: TABLAS });
  await mutar?.(fx);
  const lock = join(await mkdtemp(join(tmpdir(), "lock-")), "anthropic-lock.json");
  await writeFile(lock, `${JSON.stringify(VIEJO, null, 2)}\n`);
  const informe = join(await mkdtemp(join(tmpdir(), "informe-")), "informe.md");
  const sync = (heads = NUEVO, extra: Record<string, unknown> = {}) => syncAnthropic({ clones: fx.dir, out, lock, tables: TABLAS, informe,
    clonar: async () => {}, head: async (d: string) => (d === fx.kwp ? heads.kwp : heads.skills), ...extra });
  const reporte = () => readFile(informe, "utf8");
  return { out, fx, lock, sync, reporte };
}

test("sin cambios no escribe: el lock queda igual, el árbol no se toca y el informe lo dice", async () => {
  const { out, lock, sync, reporte } = await armado();
  const mapa = await readFile(join(out, ".claude-plugin/marketplace.json"), "utf8");
  const items = await readFile(join(out, ".nouter/directory.json"), "utf8");
  assert.equal(await sync(VIEJO), 0);
  assert.equal(await readFile(lock, "utf8"), `${JSON.stringify(VIEJO, null, 2)}\n`);
  assert.equal(await readFile(join(out, ".claude-plugin/marketplace.json"), "utf8"), mapa);
  assert.equal(await readFile(join(out, ".nouter/directory.json"), "utf8"), items);
  assert.match(await reporte(), /sin cambios/i);
});

test("con los pins iguales no importa: un seed que difiere de lo que daría el importador queda intacto", async () => {
  const { out, lock, sync, reporte } = await armado();
  // El seed commiteado difiere de lo que produce el importador (por ejemplo, alguien tocó el archivo a mano).
  const archivo = join(out, "skills/alpha/SKILL.md");
  const aMano = "---\nname: alpha\ndescription: The alpha skill.\n---\n\nTocado a mano.\n";
  await writeFile(archivo, aMano);
  const mapa = await readFile(join(out, ".claude-plugin/marketplace.json"), "utf8");
  assert.equal(await sync(VIEJO), 0);
  assert.equal(await readFile(archivo, "utf8"), aMano, "sin cambios no importa: el árbol queda como está");
  assert.equal(await readFile(join(out, ".claude-plugin/marketplace.json"), "utf8"), mapa);
  assert.deepEqual(JSON.parse(await readFile(lock, "utf8")), VIEJO);
  assert.match(await reporte(), /sin cambios/i);
});

test("con cambios copia, mueve el lock e informa el item, la versión y los servidores del .mcp.json", async () => {
  const { out, lock, sync, reporte } = await armado(async (fx) => {
    await writeFile(join(fx.kwp, "sales/.claude-plugin/plugin.json"), JSON.stringify({ name: "sales", version: "1.1.0", description: "The sales plugin." }));
    await writeFile(join(fx.kwp, "sales/.mcp.json"), JSON.stringify({ mcpServers: {
      hubspot: { type: "http", url: "https://mcp.hubspot.com/v2" }, notes: { type: "http", url: "https://mcp.notes.example/mcp" } } }));
    await writeFile(join(fx.skills, "skills/alpha/SKILL.md"), "---\nname: alpha\ndescription: The alpha skill, now better.\n---\n");
  });
  assert.equal(await sync(), 0);
  assert.deepEqual(JSON.parse(await readFile(lock, "utf8")), NUEVO);
  const m = JSON.parse(await readFile(join(out, ".claude-plugin/marketplace.json"), "utf8"));
  assert.equal(m.plugins.find((p: any) => p.name === "sales").version, "1.1.0");
  const texto = await reporte();
  assert.match(texto, /plugin sales: 1\.0\.0 → 1\.1\.0/);
  assert.match(texto, /servidor mcp hubspot: https:\/\/mcp\.hubspot\.com\/v1 → https:\/\/mcp\.hubspot\.com\/v2/);
  assert.match(texto, /servidor mcp notes: https:\/\/mcp\.notes\.example\/mcp \(nuevo\)/);
  assert.match(texto, /servidor mcp benchling: ya no está/);
  assert.match(texto, /skill alpha/);
});

test("un item de las tablas que falta en el upstream frena cerrado: sale 1 y no escribe", async () => {
  const { out, lock, sync, reporte } = await armado(async (fx) => { await rm(join(fx.kwp, "engineering"), { recursive: true }); });
  const mapa = await readFile(join(out, ".claude-plugin/marketplace.json"), "utf8");
  assert.equal(await sync(), 1);
  assert.deepEqual(JSON.parse(await readFile(lock, "utf8")), VIEJO);
  assert.equal(await readFile(join(out, ".claude-plugin/marketplace.json"), "utf8"), mapa);
  assert.match(await reporte(), /engineering/);
});

test("una skill que ya no trae su licencia frena cerrado: sale 1, sin PR y sin escribir", async () => {
  const { out, lock, sync, reporte } = await armado(async (fx) => { await writeFile(join(fx.skills, "skills/alpha/LICENSE.txt"), MIT); });
  const items = await readFile(join(out, ".nouter/directory.json"), "utf8");
  assert.equal(await sync(), 1);
  assert.deepEqual(JSON.parse(await readFile(lock, "utf8")), VIEJO);
  assert.equal(await readFile(join(out, ".nouter/directory.json"), "utf8"), items);
  assert.match(await reporte(), /alpha[^\n]*licencia|licencia[^\n]*alpha/i);
});

test("un clon que ya existe se trae el tip de la rama por defecto: nunca se queda en el HEAD viejo", async () => {
  const origen = await mkdtemp(join(tmpdir(), "origen-"));
  const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
  await git(origen, "init", "-q", "-b", "main");
  const commit = async (texto: string) => {
    await writeFile(join(origen, "README.md"), texto);
    await git(origen, "add", "README.md");
    await git(origen, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", texto);
    return git(origen, "rev-parse", "HEAD");
  };
  const viejo = await commit("a");
  const destino = join(await mkdtemp(join(tmpdir(), "clon-")), "kwp");
  await actualizarClon(`file://${origen}`, destino, viejo);
  assert.equal(git(destino, "rev-parse", "HEAD"), viejo);
  const nuevo = await commit("b");
  // El pin del lock sigue existiendo: el clon reusado tiene que ver el tip de la rama por defecto, no el HEAD del día que se clonó.
  await actualizarClon(`file://${origen}`, destino, viejo);
  assert.equal(git(destino, "rev-parse", "HEAD"), nuevo, "un clon reusado ve el commit nuevo");
  await assert.rejects(actualizarClon(`file://${origen}`, destino, "0".repeat(40)), /0{40}|remote ref/i);
});

test("un plugin que cambia de licencia frena cerrado: sale 1, sin PR y sin escribir", async () => {
  const { out, lock, sync, reporte } = await armado(async (fx) => { await writeFile(join(fx.kwp, "sales/LICENSE"), MIT); });
  const mapa = await readFile(join(out, ".claude-plugin/marketplace.json"), "utf8");
  assert.equal(await sync(), 1);
  assert.deepEqual(JSON.parse(await readFile(lock, "utf8")), VIEJO);
  assert.equal(await readFile(join(out, ".claude-plugin/marketplace.json"), "utf8"), mapa);
  assert.match(await reporte(), /sales[^\n]*licencia|licencia[^\n]*sales/i);
});

test("un pin que el upstream no tiene sale 1 con el SHA y no escribe", async () => {
  const { lock, sync, reporte } = await armado();
  const roto = async () => { throw new Error(`fatal: couldn't find remote ref ${VIEJO.kwp}`); };
  assert.equal(await sync(NUEVO, { clonar: roto }), 1);
  assert.deepEqual(JSON.parse(await readFile(lock, "utf8")), VIEJO);
  const texto = await reporte();
  assert.match(texto, new RegExp(VIEJO.kwp));
  assert.match(texto, /no pudo traer el seed/);
});

test("lo nuevo del upstream se informa y no se copia; lo partner-built y lo de fuente externa no se informan", async () => {
  const { out, lock, sync, reporte } = await armado(async (fx) => {
    const m = JSON.parse(await readFile(join(fx.kwp, ".claude-plugin/marketplace.json"), "utf8"));
    m.plugins.push({ name: "nuevo", source: "./nuevo", description: "Brand new." });
    await writeFile(join(fx.kwp, ".claude-plugin/marketplace.json"), JSON.stringify(m));
    await mkdir(join(fx.kwp, "nuevo/.claude-plugin"), { recursive: true });
    await writeFile(join(fx.kwp, "nuevo/.claude-plugin/plugin.json"), JSON.stringify({ name: "nuevo", version: "0.1.0", description: "Brand new." }));
    await writeFile(join(fx.kwp, "nuevo/LICENSE"), APACHE);
    await mkdir(join(fx.skills, "skills/gamma"), { recursive: true });
    await writeFile(join(fx.skills, "skills/gamma/SKILL.md"), "---\nname: gamma\ndescription: The gamma skill.\n---\n");
  });
  assert.equal(await sync(), 0);
  // Los bytes copiados son los mismos: el lock no se mueve.
  assert.deepEqual(JSON.parse(await readFile(lock, "utf8")), VIEJO);
  await assert.rejects(stat(join(out, "plugins/nuevo")));
  await assert.rejects(stat(join(out, "skills/gamma")));
  const texto = await reporte();
  assert.match(texto, /plugin nuevo \(Apache-2\.0\)/);
  assert.match(texto, /skill gamma \(sin licencia\)/);
  assert.ok(!/slack-by-salesforce/.test(texto), "partner-built no se informa");
  assert.ok(!/tavily/.test(texto), "una fuente externa no se informa");
  assert.match(texto, /se queda/);
});
