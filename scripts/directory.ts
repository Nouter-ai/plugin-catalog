// Lo que Nouter muestra de este repo en Customize → Discover: el índice `directory.json` de cada release, con la forma de
// DirectoryReleaseIndex (el mismo contrato que publica mcp-catalog). Sale del marketplace (plugins), de .nouter/directory.json
// (skills y blueprints sueltos) y de .nouter/featured.json (el banner de Skills y de Plugins).

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DirectoryCategory } from "./categories.ts";
import { taglineOf } from "./frontmatter.ts";
import { isObj, licenseErrors, marketplaceErrors, metaErrors } from "./marketplace.ts";

export type DirectoryEntryType = "connector" | "plugin" | "skill" | "blueprint";
export interface DirectoryReleaseEntry {
  id: string; type: DirectoryEntryType; name: string; tagline: string; description: string; publisher: string; verified: boolean;
  categories: DirectoryCategory[]; added: string; logo?: string; flag?: string; offered?: boolean;
  connector?: { kind: "native" | "mcp"; signIn: "account" | "company" | "none" };
  path?: string; plugin?: string; skills?: string[]; license?: string; source?: { repo: string; commit: string };
}
export interface FeaturedCollection { id: string; title: string; subtitle: string; items: string[] }
export interface DirectoryReleaseIndex {
  repo: "mcp-catalog" | "plugin-catalog"; version: string; entries: DirectoryReleaseEntry[]; featured: FeaturedCollection[];
  banner?: { skills?: string; plugins?: string };
}

const json = (file: string): Promise<unknown> => readFile(file, "utf8").then((t) => JSON.parse(t) as unknown);
const SLUG = /^[a-z][a-z0-9-]{0,59}$/;
const ITEM_TYPES = ["skill", "blueprint"];
const ITEM_FILE: Record<string, string> = { skill: "SKILL.md", blueprint: "blueprint.json" };

interface Item { type: "skill" | "blueprint"; name: string; path: string; description: string; category: DirectoryCategory; tags: DirectoryCategory[];
  author: string; license: string; verified: boolean; flag?: string; source?: { repo: string; commit: string } }

async function readItems(root: string): Promise<unknown[] | string> {
  try {
    const d = await json(join(root, ".nouter/directory.json"));
    return isObj(d) && Array.isArray(d.items) ? d.items : ".nouter/directory.json: { items: [...] }";
  } catch { return ".nouter/directory.json: no existe o no es JSON"; }
}

// .nouter/directory.json: las skills y los blueprints sueltos, con las mismas reglas que un plugin.
export async function directoryItemsErrors(root: string): Promise<string[]> {
  const items = await readItems(root);
  if (typeof items === "string") return [items];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const [i, it] of items.entries()) {
    if (!isObj(it)) { errors.push(`items[${i}]: tiene que ser un objeto`); continue; }
    const at = `item ${typeof it.name === "string" ? it.name : i}`;
    const known = ["type", "name", "path", "description", "category", "tags", "author", "license", "verified", "flag", "source"];
    for (const k of Object.keys(it)) if (!known.includes(k)) errors.push(`${at}: clave desconocida ${k}`);
    if (!ITEM_TYPES.includes(it.type as string)) { errors.push(`${at}.type: skill o blueprint (tipo)`); continue; }
    if (typeof it.name !== "string" || !SLUG.test(it.name)) errors.push(`${at}.name: slug en minúsculas, letras, números y guiones`);
    const key = `${String(it.type)}:${String(it.name)}`;
    if (seen.has(key)) errors.push(`${at}: ${key} repetido`);
    seen.add(key);
    if (typeof it.description !== "string" || it.description.length < 1) errors.push(`${at}.description: obligatoria`);
    const dir = join(root, typeof it.path === "string" ? it.path : "\0");
    if (typeof it.path !== "string" || it.path.includes("..") || !existsSync(dir)) { errors.push(`${at}.path: ${String(it.path)} no existe`); continue; }
    const file = ITEM_FILE[it.type as string];
    if (!existsSync(join(dir, file))) errors.push(`${at}.path: ${it.path} no tiene ${file}`);
    errors.push(...metaErrors(at, { category: it.category, tags: it.tags ?? [], author: it.author, flag: it.flag, verified: it.verified, source: it.source, where: "item" }));
    errors.push(...await licenseErrors(at, it.license, dir));
  }
  return errors;
}

async function readFeatured(root: string): Promise<Record<string, unknown> | string> {
  try {
    const f = await json(join(root, ".nouter/featured.json"));
    return isObj(f) ? f : ".nouter/featured.json: tiene que ser un objeto";
  } catch { return ".nouter/featured.json: no existe o no es JSON"; }
}

// .nouter/featured.json: el banner de Skills (`skills`, un `skill:<name>`) y el de Plugins (`plugins`, un `plugin:<name>`), con ids que existan.
export async function featuredErrors(root: string, entries: ReadonlyMap<string, unknown>): Promise<string[]> {
  const f = await readFeatured(root);
  if (typeof f === "string") return [f];
  const errors: string[] = [];
  for (const [k, v] of Object.entries(f)) {
    if (k !== "skills" && k !== "plugins") { errors.push(`featured.json: clave desconocida ${k}`); continue; }
    const prefix = k === "skills" ? "skill:" : "plugin:";
    if (typeof v !== "string" || !v.startsWith(prefix) || !entries.has(v)) errors.push(`featured.json: ${k} tiene que ser el id de un ${prefix.slice(0, -1)} que exista (${String(v)})`);
  }
  return errors;
}

async function sources(root: string): Promise<{ plugins: Record<string, unknown>[]; items: Item[] }> {
  const m = await json(join(root, ".claude-plugin/marketplace.json")).catch(() => null);
  const items = await readItems(root);
  return { plugins: (isObj(m) && Array.isArray(m.plugins) ? m.plugins : []) as Record<string, unknown>[], items: (typeof items === "string" ? [] : items) as Item[] };
}

// Todo lo que el CI exige del repo: el marketplace, los items sueltos y los destacados.
export async function validateRepo(root: string): Promise<string[]> {
  const errors = [...await marketplaceErrors(root), ...await directoryItemsErrors(root)];
  const { plugins, items } = await sources(root);
  const ids = new Map<string, true>([...plugins.map((p) => [`plugin:${String(p.name)}`, true] as const), ...items.map((i) => [`${i.type}:${i.name}`, true] as const)]);
  return [...errors, ...await featuredErrors(root, ids)];
}

// La fecha del primer commit que agregó la ruta (la más vieja). Sin commit, falla: un release sale de commits.
export function gitAddedAt(root: string): (path: string) => string {
  return (path) => {
    const out = execFileSync("git", ["log", "--diff-filter=A", "--format=%cI", "--", path], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
    if (!out.length) throw new Error(`${path}: no tiene un commit que lo agregue (added sale del historial de git)`);
    return out[out.length - 1];
  };
}

export async function buildDirectory(root: string, version: string, addedOf: (path: string) => string): Promise<DirectoryReleaseIndex> {
  const errors = await validateRepo(root);
  if (errors.length) throw new Error(errors.join("; "));
  const { plugins, items } = await sources(root);
  const entries: DirectoryReleaseEntry[] = [];
  for (const p of plugins) {
    const name = p.name as string, x = p["x-nouter"] as { verified: boolean; flag?: string; source?: { repo: string; commit: string } };
    const skillsDir = join(root, "plugins", name, "skills");
    const skills = existsSync(skillsDir) ? (await readdir(skillsDir)).filter((s) => existsSync(join(skillsDir, s, "SKILL.md"))).toSorted() : [];
    entries.push({ id: `plugin:${name}`, type: "plugin", name: typeof p.displayName === "string" ? p.displayName : name,
      tagline: taglineOf(p.description as string), description: p.description as string, publisher: (p.author as { name: string }).name,
      verified: x.verified, categories: [p.category as DirectoryCategory, ...(p.tags as DirectoryCategory[] ?? [])],
      added: addedOf(`plugins/${name}`), ...(x.flag ? { flag: x.flag } : {}), path: `plugins/${name}`, skills, license: p.license as string,
      ...(x.source ? { source: x.source } : {}) });
  }
  for (const it of items) {
    entries.push({ id: `${it.type}:${it.name}`, type: it.type, name: it.name, tagline: taglineOf(it.description), description: it.description,
      publisher: it.author, verified: it.verified, categories: [it.category, ...it.tags], added: addedOf(it.path), ...(it.flag ? { flag: it.flag } : {}),
      path: it.path, license: it.license, ...(it.source ? { source: it.source } : {}) });
  }
  const featured = await json(join(root, ".nouter/featured.json")) as { skills?: string; plugins?: string };
  return { repo: "plugin-catalog", version, entries, featured: [], banner: { ...(featured.skills ? { skills: featured.skills } : {}), ...(featured.plugins ? { plugins: featured.plugins } : {}) } };
}
