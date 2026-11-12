// Las reglas del marketplace de Nouter (.claude-plugin/marketplace.json) y las que comparten los items sueltos del Directory
// (scripts/directory.ts): categoría y tags de la lista cerrada, licencia libre con su archivo, `x-nouter` y `source`.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CATEGORIES } from "./categories.ts";
import { FLAGS } from "./flags.ts";

export const LICENSES = ["Apache-2.0", "MIT", "BSD-2-Clause", "BSD-3-Clause", "ISC"] as const;

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

// La licencia declarada tiene que ser una de las libres, con su texto en la carpeta del item.
export async function licenseErrors(at: string, license: unknown, dir: string): Promise<string[]> {
  if (typeof license !== "string" || !(LICENSES as readonly string[]).includes(license)) {
    return [`${at}.license: la licencia tiene que ser una libre (${LICENSES.join(", ")})`];
  }
  const found = (await licenseTexts(dir)).map(licenseOf);
  return found.includes(license) ? [] : [`${at}.license: falta el archivo de licencia ${license} (LICENSE* o LICENSES/) en ${dir.split("/").slice(-2).join("/")}`];
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
  }
  return errors;
}

export async function marketplaceErrors(root: string): Promise<string[]> {
  const errors: string[] = [];
  const file = join(root, ".claude-plugin/marketplace.json");
  let m: unknown;
  try { m = JSON.parse(await readFile(file, "utf8")); } catch { return [".claude-plugin/marketplace.json: no existe o no es JSON"]; }
  if (!isObj(m)) return ["marketplace.json: tiene que ser un objeto"];
  if (m.name !== "nouter") errors.push('marketplace.json: name tiene que ser "nouter"');
  if (!isObj(m.owner) || !str(m.owner.name, 1, 100)) errors.push("marketplace.json: owner.name obligatorio");
  if (!Array.isArray(m.plugins)) return [...errors, "marketplace.json: plugins tiene que ser una lista"];
  const names = new Set<string>();
  for (const [i, p] of m.plugins.entries()) {
    if (!isObj(p)) { errors.push(`plugins[${i}]: tiene que ser un objeto`); continue; }
    const name = typeof p.name === "string" ? p.name : "";
    const at = `plugin ${name || i}`;
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
      if (manifest.version !== p.version) errors.push(`${at}: plugin.json dice version ${String(manifest.version)} y el marketplace ${String(p.version)}`);
    }
    const author = isObj(p.author) ? p.author.name : undefined;
    const x = p["x-nouter"];
    if (!isObj(x) || Object.keys(x).some((k) => !["verified", "flag", "source"].includes(k))) {
      errors.push(`${at}: x-nouter tiene que ser { verified, flag?, source? } sin otras claves`);
    }
    errors.push(...metaErrors(at, { category: p.category, tags: p.tags ?? [], author, flag: isObj(x) ? x.flag : undefined,
      verified: isObj(x) ? x.verified : undefined, source: isObj(x) ? x.source : undefined, where: "x-nouter" }));
    errors.push(...await licenseErrors(at, p.license, dir));
    const mcp = await readFile(join(dir, ".mcp.json"), "utf8").then((t) => JSON.parse(t) as unknown, () => undefined);
    if (mcp !== undefined) errors.push(...mcpErrors(at, mcp));
  }
  return errors;
}
