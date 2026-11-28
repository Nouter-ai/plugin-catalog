// Las reglas del marketplace de Nouter (.claude-plugin/marketplace.json) y las que comparten los items sueltos del Directory
// (scripts/directory.ts): categoría y tags de la lista cerrada, licencia libre con su archivo, `x-nouter` y `source`.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CATEGORIES } from "./categories.ts";
import { FLAGS } from "./flags.ts";

export const LICENSES = ["Apache-2.0", "MIT", "BSD-2-Clause", "BSD-3-Clause", "ISC"] as const;
// Las que se suman a la del item y valen solo para archivos de fuente (hoy la de las fuentes de canvas-design).
export const LICENCIAS_EXTRA = ["OFL-1.1"] as const;

// Reconoce la licencia de un texto, solo entre las libres que acepta el Directory.
export function licenseOf(text: string): string | null {
  const t = text.replace(/\s+/g, " ");
  if (/Apache License,? Version 2\.0/i.test(t)) return "Apache-2.0";
  if (/Permission is hereby granted, free of charge/i.test(t)) return "MIT";
  if (/Permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee/i.test(t)) return "ISC";
  if (/Redistribution and use in source and binary forms/i.test(t)) return /Neither the name of/i.test(t) ? "BSD-3-Clause" : "BSD-2-Clause";
  return null;
}

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, min: number, max: number): v is string => typeof v === "string" && v.length >= min && v.length <= max;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const SLUG = /^[a-z][a-z0-9-]{0,59}$/;

// Los textos de licencia de una carpeta: LICENSE* en su raíz y lo que haya en LICENSES/.
async function licenseTexts(dir: string): Promise<string[]> {
  const files: string[] = [];
  const top = await readdir(dir).catch(() => [] as string[]);
  files.push(...top.filter((f) => /^LICENSE/i.test(f) && !f.endsWith("/")).map((f) => join(dir, f)));
  if (top.includes("LICENSES")) files.push(...(await readdir(join(dir, "LICENSES"))).map((f) => join(dir, "LICENSES", f)));
  const out: string[] = [];
  for (const f of files) out.push(await readFile(f, "utf8").catch(() => ""));
  return out;
}

// La SIL OFL 1.1, que el CI reconoce para aceptar el texto de cada familia de fuentes.
export const isOflText = (text: string): boolean => /SIL OPEN FONT LICENSE,? (Version )?1\.1/i.test(text.replace(/\s+/g, " "));

const FUENTE = /\.(?:ttf|otf|woff2?)$/i;
const ARCHIVO_OFL = /-OFL\.txt$/i;
const carpeta = (dir: string) => dir.split("/").slice(-2).join("/");

async function archivosEn(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await archivosEn(p));
    else out.push(p);
  }
  return out;
}

// Las familias de las fuentes de una carpeta (recorre las subcarpetas): `InstrumentSerif-BoldItalic.ttf` es InstrumentSerif.
export async function familiasDeFuentes(dir: string): Promise<string[]> {
  const familias = new Set<string>();
  for (const f of await archivosEn(dir)) {
    if (!FUENTE.test(f)) continue;
    familias.add(f.split("/").pop()!.replace(FUENTE, "").split("-")[0]);
  }
  return [...familias].toSorted();
}

// La OFL exige fuentes en la carpeta y el texto de la SIL OFL 1.1 por familia (`<Familia>-OFL.txt`), y ningún `*-OFL.txt` sin él.
async function oflErrors(at: string, dir: string): Promise<string[]> {
  const archivos = await archivosEn(dir);
  const familias = await familiasDeFuentes(dir);
  if (!familias.length) return [`${at}.licenses: OFL-1.1 es para archivos de fuente y en ${carpeta(dir)} no hay ninguno (.ttf, .otf, .woff, .woff2)`];
  const textos = archivos.filter((f) => ARCHIVO_OFL.test(f));
  const errors: string[] = [];
  for (const familia of familias) {
    if (!textos.some((t) => t.split("/").pop() === `${familia}-OFL.txt`)) {
      errors.push(`${at}.licenses: falta el texto OFL de la familia ${familia} (${familia}-OFL.txt) en ${carpeta(dir)}`);
    }
  }
  for (const t of textos) {
    if (!isOflText(await readFile(t, "utf8").catch(() => ""))) errors.push(`${at}.licenses: ${t.split("/").pop()} no trae el texto de la SIL OFL 1.1`);
  }
  return errors;
}

// La licencia declarada tiene que ser una de las libres, con su texto en la carpeta del item; `licenses` son las adicionales
// (hoy solo la OFL, que además exige sus fuentes y el texto de cada familia).
export async function licenseErrors(at: string, license: unknown, licenses: unknown, dir: string): Promise<string[]> {
  const errors: string[] = [];
  if (typeof license !== "string" || !(LICENSES as readonly string[]).includes(license)) {
    errors.push(`${at}.license: la licencia tiene que ser una libre (${LICENSES.join(", ")})`);
  } else {
    const found = (await licenseTexts(dir)).map(licenseOf);
    if (!found.includes(license)) errors.push(`${at}.license: falta el archivo de licencia ${license} (LICENSE* o LICENSES/) en ${carpeta(dir)}`);
  }
  if (licenses !== undefined) {
    const extra = Array.isArray(licenses) && licenses.length > 0 && licenses.every((l) => (LICENCIAS_EXTRA as readonly unknown[]).includes(l))
      && new Set(licenses).size === licenses.length && !(licenses as unknown[]).includes(license);
    if (!extra) errors.push(`${at}.licenses: las adicionales son de la lista (${LICENCIAS_EXTRA.join(", ")}), una vez cada una y distintas de license`);
    else if ((licenses as string[]).includes("OFL-1.1")) errors.push(...await oflErrors(at, dir));
  }
  return errors;
}

// category, tags, author, verified, flag y source de un plugin o de un item suelto. `author` es un texto en los items y { name } en los plugins.
export function metaErrors(at: string, m: { category: unknown; tags: unknown; author: unknown; flag?: unknown; verified: unknown;
  source?: unknown; where: "x-nouter" | "item" }): string[] {
  const errors: string[] = [];
  const cat = (v: unknown): v is (typeof CATEGORIES)[number] => (CATEGORIES as readonly unknown[]).includes(v);
  if (!cat(m.category)) errors.push(`${at}.category: la categoría tiene que ser uno de los 18 temas (schema/categories.json)`);
  if (!Array.isArray(m.tags) || m.tags.length > 2 || !m.tags.every(cat) || new Set(m.tags).size !== m.tags.length || m.tags.includes(m.category)) {
    errors.push(`${at}.tags: hasta 2 temas de la lista, distintos entre sí y de category`);
  }
  if (!str(m.author, 1, 40)) errors.push(`${at}.author: el nombre del autor, de 1 a 40 caracteres`);
  const w = m.where === "x-nouter" ? `${at}.x-nouter` : at;
  if (typeof m.verified !== "boolean") errors.push(`${w}.verified: true o false`);
  if (m.flag !== undefined && !(typeof m.flag === "string" && FLAGS.includes(m.flag))) errors.push(`${w}.flag: ${String(m.flag)} no es un flag vigente (scripts/flags.ts)`);
  if (m.source !== undefined) {
    const s = m.source;
    if (!isObj(s) || !str(s.repo, 1, 100) || !str(s.commit, 7, 40) || Object.keys(s).some((k) => k !== "repo" && k !== "commit")) {
      errors.push(`${w}.source: { repo, commit } sin otras claves`);
    }
  }
  return errors;
}

// `.mcp.json` opcional: cada servidor es http con una URL https o vacía (la que el tenant completa). Las demás claves (oauth) se dejan.
function mcpErrors(at: string, raw: unknown): string[] {
  const servers = isObj(raw) && isObj(raw.mcpServers) ? raw.mcpServers : raw;
  if (!isObj(servers)) return [`${at}/.mcp.json: tiene que ser un objeto de servidores mcp`];
  const errors: string[] = [];
  for (const [name, s] of Object.entries(servers)) {
    const ok = isObj(s) && s.type === "http" && typeof s.url === "string" && (s.url === "" || s.url.startsWith("https://"));
    if (!ok) errors.push(`${at}/.mcp.json: el servidor mcp ${name} tiene que ser { type: "http", url: https o "" }`);
    if (isObj(s) && ("headers" in s || "headersHelper" in s)) errors.push(`${at}/.mcp.json: el servidor mcp ${name} lleva headers: una credencial en el repo llegaría a cada tenant`);
    if (isObj(s) && typeof s.url === "string" && s.url.startsWith("https://")) {
      try {
        const u = new URL(s.url);
        if (u.username || u.password) errors.push(`${at}/.mcp.json: la URL del servidor mcp ${name} lleva credenciales (usuario:clave@)`);
      } catch { errors.push(`${at}/.mcp.json: la URL del servidor mcp ${name} no es válida`); }
    }
  }
  return errors;
}

const ENTRY_KEYS = ["name", "displayName", "source", "description", "version", "license", "keywords", "category", "tags", "author", "homepage",
  "repository", "treeHash", "x-nouter"];
const ROOT_KEYS = ["name", "owner", "plugins"];
// Lo que ejecuta código o abre una puerta en la máquina de quien instala: nunca entra al Directory.
const RISKY = ["hooks", "mcpServers", "lspServers"];

export async function marketplaceErrors(root: string): Promise<string[]> {
  const errors: string[] = [];
  const file = join(root, ".claude-plugin/marketplace.json");
  let m: unknown;
  try { m = JSON.parse(await readFile(file, "utf8")); } catch { return [".claude-plugin/marketplace.json: no existe o no es JSON"]; }
  if (!isObj(m)) return ["marketplace.json: tiene que ser un objeto"];
  for (const k of Object.keys(m)) if (!ROOT_KEYS.includes(k)) errors.push(`marketplace.json: clave desconocida ${k}`);
  if (m.name !== "nouter") errors.push('marketplace.json: name tiene que ser "nouter"');
  if (!isObj(m.owner) || !str(m.owner.name, 1, 100)) errors.push("marketplace.json: owner.name obligatorio");
  if (!Array.isArray(m.plugins)) return [...errors, "marketplace.json: plugins tiene que ser una lista"];
  const names = new Set<string>();
  for (const [i, p] of m.plugins.entries()) {
    if (!isObj(p)) { errors.push(`plugins[${i}]: tiene que ser un objeto`); continue; }
    const name = typeof p.name === "string" ? p.name : "";
    const at = `plugin ${name || i}`;
    for (const k of Object.keys(p)) {
      if (RISKY.includes(k)) errors.push(`plugin ${name || i}: ${k} no entra al Directory (ejecuta o abre algo en la máquina de quien instala)`);
      else if (!ENTRY_KEYS.includes(k)) errors.push(`plugin ${name || i}: clave desconocida ${k}`);
    }
    if (!SLUG.test(name)) errors.push(`${at}: name en minúsculas, letras, números y guiones`);
    if (names.has(name)) errors.push(`${at}: name repetido`);
    names.add(name);
    if (!str(p.description, 1, 1000)) errors.push(`${at}: description obligatoria`);
    if (typeof p.version !== "string" || !SEMVER.test(p.version)) errors.push(`${at}: version semver exacta (1.0.0)`);
    const dir = join(root, "plugins", name);
    if (p.source !== `./plugins/${name}` || !existsSync(dir)) {
      errors.push(`${at}: source tiene que ser ./plugins/${name} y esa carpeta no existe (path)`);
      continue;
    }
    const manifest = await readFile(join(dir, ".claude-plugin/plugin.json"), "utf8").then((t) => JSON.parse(t) as Record<string, unknown>, () => null);
    if (!manifest) errors.push(`${at}: falta .claude-plugin/plugin.json`);
    else {
      if (manifest.name !== name) errors.push(`${at}: plugin.json dice name ${String(manifest.name)}`);
      for (const k of RISKY) if (k in manifest) errors.push(`${at}: plugin.json lleva ${k}, que no entra al Directory`);
      if (manifest.version !== p.version) errors.push(`${at}: plugin.json dice version ${String(manifest.version)} y el marketplace ${String(p.version)}`);
    }
    const author = isObj(p.author) ? p.author.name : undefined;
    const x = p["x-nouter"];
    if (!isObj(x) || Object.keys(x).some((k) => !["verified", "flag", "source", "tagline", "licenses"].includes(k))) {
      errors.push(`${at}: x-nouter tiene que ser { verified, flag?, source?, tagline?, licenses? } sin otras claves`);
    }
    if (isObj(x) && x.tagline !== undefined && !str(x.tagline, 1, 100)) errors.push(`${at}: x-nouter.tagline de 1 a 100 caracteres`);
    errors.push(...metaErrors(at, { category: p.category, tags: p.tags ?? [], author, flag: isObj(x) ? x.flag : undefined,
      verified: isObj(x) ? x.verified : undefined, source: isObj(x) ? x.source : undefined, where: "x-nouter" }));
    errors.push(...await licenseErrors(at, p.license, isObj(x) ? x.licenses : undefined, dir));
    if (existsSync(join(dir, "hooks/hooks.json"))) errors.push(`${at}: hooks/hooks.json: los hooks no entran al Directory`);
    if (existsSync(join(dir, "bin"))) errors.push(`${at}: bin/: los ejecutables no entran al Directory`);
    const mcp = await readFile(join(dir, ".mcp.json"), "utf8").then((t) => JSON.parse(t) as unknown, () => undefined);
    if (mcp !== undefined) errors.push(...mcpErrors(at, mcp));
  }
  return errors;
}
