import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CATEGORIES } from "./categories.ts";
import { FLAGS } from "./flags.ts";
import { LICENSES, licenseOf, marketplaceErrors } from "./marketplace.ts";
import { taglineOf } from "./frontmatter.ts";

const realRoot = new URL("..", import.meta.url).pathname;
const APACHE = await readFile(new URL("../LICENSE", import.meta.url), "utf8");

const ok = () => ({ name: "sales", source: "./plugins/sales", description: "d", version: "1.0.0", license: "Apache-2.0", category: "sales",
  tags: ["engineering"], author: { name: "Anthropic" },
  "x-nouter": { verified: true, flag: "directory-nativos", source: { repo: "anthropics/knowledge-work-plugins", commit: "877a617" } } });

// Un repo temporal con un marketplace de los plugins que se le pasen (cada uno con su carpeta, plugin.json y licencia).
async function repo(plugins: any[], mcp?: unknown): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mp-"));
  await mkdir(join(root, ".claude-plugin"), { recursive: true });
  await writeFile(join(root, ".claude-plugin/marketplace.json"), JSON.stringify({ name: "nouter", owner: { name: "Nouter" }, plugins }));
  for (const p of plugins) {
    const dir = join(root, "plugins", String(p.name));
    await mkdir(join(dir, ".claude-plugin"), { recursive: true });
    await writeFile(join(dir, ".claude-plugin/plugin.json"), JSON.stringify({ name: p.name, version: p.version }));
    await writeFile(join(dir, "LICENSE"), APACHE);
    if (mcp !== undefined) await writeFile(join(dir, ".mcp.json"), JSON.stringify(mcp));
  }
  return root;
}
const falla = async (plugins: any[], re: RegExp, mcp?: unknown) => assert.match((await marketplaceErrors(await repo(plugins, mcp))).join(" | "), re);

test("una entrada bien formada no da errores", async () => {
  assert.deepEqual(await marketplaceErrors(await repo([ok()])), []);
  const mcp = { mcpServers: { a: { type: "http", url: "https://mcp.example.com/mcp", oauth: { clientId: "x" } }, b: { type: "http", url: "" } } };
  assert.deepEqual(await marketplaceErrors(await repo([ok()], mcp)), []);
});

test("cada regla del marketplace falla con su palabra", async () => {
  await falla([{ ...ok(), category: "delivery" }], /categoría|category/);
  await falla([{ ...ok(), tags: ["sales"] }], /tags/);
  await falla([{ ...ok(), tags: ["legal", "finance", "websites"] }], /tags/);
  await falla([{ ...ok(), license: "CC-BY-4.0" }], /licencia|license/);
  await falla([{ ...ok(), source: "./plugins/nada" }], /path|no existe/);
  await falla([ok(), ok()], /repetid/);
  await falla([{ ...ok(), "x-nouter": { ...ok()["x-nouter"], verified: "sí" } }], /x-nouter/);
  await falla([{ ...ok(), "x-nouter": { ...ok()["x-nouter"], extra: 1 } }], /x-nouter/);
  await falla([{ ...ok(), "x-nouter": { ...ok()["x-nouter"], flag: "no-existe" } }], /flag/);
  await falla([{ ...ok(), author: { name: "" } }], /author/);
  await falla([ok()], /mcp/, { mcpServers: { x: { type: "stdio", command: "x" } } });
  await falla([ok()], /mcp/, { mcpServers: { x: { type: "http", url: "http://mcp.example.com" } } });
});

test("la versión y el nombre del marketplace son los de plugin.json; el plugin trae su licencia", async () => {
  const root = await repo([ok()]);
  await writeFile(join(root, "plugins/sales/.claude-plugin/plugin.json"), JSON.stringify({ name: "sales", version: "9.9.9" }));
  assert.match((await marketplaceErrors(root)).join(), /version/);
  const sinLicencia = await repo([ok()]);
  const { rm } = await import("node:fs/promises");
  await rm(join(sinLicencia, "plugins/sales/LICENSE"));
  assert.match((await marketplaceErrors(sinLicencia)).join(), /licencia|license/);
  const raiz = await repo([ok()]);
  await writeFile(join(raiz, ".claude-plugin/marketplace.json"), JSON.stringify({ name: "otro", plugins: [] }));
  assert.match((await marketplaceErrors(raiz)).join(" | "), /name[^|]*nouter[\s\S]*owner|owner[\s\S]*name/);
});

test("licenseOf reconoce las cinco licencias libres y nada más", async () => {
  assert.equal(licenseOf(APACHE), "Apache-2.0");
  const mit = "MIT License\n\nCopyright (c) 2025 X\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software";
  assert.equal(licenseOf(mit), "MIT");
  const bsd = (extra: string) => `Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:\n1. Redistributions of source code\n2. Redistributions in binary form\n${extra}`;
  assert.equal(licenseOf(bsd("")), "BSD-2-Clause");
  assert.equal(licenseOf(bsd("3. Neither the name of the copyright holder nor the names of its contributors")), "BSD-3-Clause");
  assert.equal(licenseOf("Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted"), "ISC");
  assert.equal(licenseOf("All rights reserved. Proprietary."), null);
  assert.deepEqual([...LICENSES], ["Apache-2.0", "MIT", "BSD-2-Clause", "BSD-3-Clause", "ISC"]);
});

test("las listas copiadas: categorías (la tabla del contrato y mcp-catalog) y flags (la foto de nouter)", async () => {
  const s = JSON.parse(await readFile(new URL("../schema/categories.json", import.meta.url), "utf8"));
  assert.deepEqual(s.categories.map((c: any) => c.id), [...CATEGORIES]);
  assert.equal(CATEGORIES.length, 18);
  assert.equal(s.categories[0].label, "Automation & workflows");
  assert.equal(s.categories[17].label, "Websites");
  const f = JSON.parse(await readFile(new URL("../schema/flags.json", import.meta.url), "utf8"));
  assert.deepEqual(f.flags, [...FLAGS]);
  assert.ok(FLAGS.includes("salesforce-delivery"));
});

test("taglineOf corta en la primera oración y a 100 caracteres con …", () => {
  assert.equal(taglineOf("Manage tasks.  Plan your day."), "Manage tasks");
  assert.equal(taglineOf("Sin punto final"), "Sin punto final");
  const largo = taglineOf(`${"palabra ".repeat(20)}fin. Otra.`);
  assert.equal(largo.length, 100);
  assert.ok(largo.endsWith("…"));
});

test("el marketplace real del repo vale", async () => {
  assert.deepEqual(await marketplaceErrors(realRoot), []);
});

test("las claves del marketplace y de cada entrada están cerradas", async () => {
  await falla([{ ...ok(), extra: 1 }], /clave desconocida extra/);
  for (const k of ["displayName", "keywords", "homepage", "repository", "treeHash"]) {
    assert.deepEqual(await marketplaceErrors(await repo([{ ...ok(), [k]: k === "keywords" ? ["a"] : "x" }])), [], k);
  }
  const root = await repo([ok()]);
  await writeFile(join(root, ".claude-plugin/marketplace.json"), JSON.stringify({ name: "nouter", owner: { name: "Nouter" }, plugins: [ok()], otra: 1 }));
  assert.match((await marketplaceErrors(root)).join(), /clave desconocida otra/);
});

test("se rechaza lo peligroso: hooks, bin/, mcpServers y lspServers, y credenciales o headers en .mcp.json", async () => {
  await falla([{ ...ok(), hooks: {} }], /hooks/);
  await falla([{ ...ok(), mcpServers: {} }], /mcpServers/);
  await falla([{ ...ok(), lspServers: {} }], /lspServers/);
  const con = async (rel: string, text: string) => {
    const root = await repo([ok()]);
    await mkdir(join(root, "plugins/sales", rel, ".."), { recursive: true });
    await writeFile(join(root, "plugins/sales", rel), text);
    return (await marketplaceErrors(root)).join(" | ");
  };
  const manifest = (extra: object) => JSON.stringify({ name: "sales", version: "1.0.0", ...extra });
  assert.match(await con(".claude-plugin/plugin.json", manifest({ hooks: {} })), /hooks/);
  assert.match(await con(".claude-plugin/plugin.json", manifest({ mcpServers: {} })), /mcpServers/);
  assert.match(await con(".claude-plugin/plugin.json", manifest({ lspServers: {} })), /lspServers/);
  assert.match(await con("hooks/hooks.json", "{}"), /hooks/);
  assert.match(await con("bin/run", "#!/bin/sh"), /bin/);
  assert.match(await con(".mcp.json", JSON.stringify({ mcpServers: { a: { type: "http", url: "https://u:p@mcp.example.com/mcp" } } })), /credenciales/);
  assert.match(await con(".mcp.json", JSON.stringify({ mcpServers: { a: { type: "http", url: "https://mcp.example.com/mcp", headers: { Authorization: "x" } } } })), /headers/);
});

test("el name de un plugin es el de su carpeta", async () => {
  await falla([{ ...ok(), source: "./plugins/otro" }], /source/);
});
