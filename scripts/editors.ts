// schema/editors.json: la copia pública de los editores del Directory. Lleva solo el id, el tipo, el nombre y
// `verified`: el contacto de seguridad y el acuerdo viven en el plano de control y no entran al repo público. El CI cruza
// cada entrada del índice —cada `publisher` y su `verified`— contra este archivo, así que un item no puede publicarse con
// un editor que no existe o con una verificación que el editor no tiene.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isObj } from "./marketplace.ts";

export type EditorKind = "nouter" | "anthropic" | "partner";
/** Lo que va en `schema/editors.json`: solo lo que el CI necesita para validar. */
export interface PublicEditor { editorId: string; kind: EditorKind; name: string; verified: boolean }

const KINDS: readonly EditorKind[] = ["nouter", "anthropic", "partner"];
const KEYS = ["editorId", "kind", "name", "verified"];
const FILE = "schema/editors.json";
// El mismo SLUG que el `name` de un item (directory.ts): el id del editor es un slug estable en minúsculas.
const SLUG = /^[a-z][a-z0-9-]{0,59}$/;

interface IndexEntry { id: string; publisher: unknown; verified: unknown }

// El `publisher` y el `verified` de cada entrada del índice, leídos como los lee buildDirectory. Lo que no parsea lo
// reporta su propio validador (marketplaceErrors o directoryItemsErrors), acá se saltea.
async function indexEntries(root: string): Promise<IndexEntry[]> {
  const entries: IndexEntry[] = [];
  try {
    const m = JSON.parse(await readFile(join(root, ".claude-plugin/marketplace.json"), "utf8")) as unknown;
    if (isObj(m) && Array.isArray(m.plugins)) {
      for (const p of m.plugins) {
        if (!isObj(p)) continue;
        const x = p["x-nouter"];
        entries.push({ id: `plugin:${String(p.name)}`, publisher: isObj(p.author) ? p.author.name : undefined, verified: isObj(x) ? x.verified : undefined });
      }
    }
  } catch { /* lo reporta marketplaceErrors */ }
  try {
    const d = JSON.parse(await readFile(join(root, ".nouter/directory.json"), "utf8")) as unknown;
    if (isObj(d) && Array.isArray(d.items)) {
      for (const it of d.items) {
        if (!isObj(it)) continue;
        entries.push({ id: `${String(it.type)}:${String(it.name)}`, publisher: it.author, verified: it.verified });
      }
    }
  } catch { /* lo reporta directoryItemsErrors */ }
  return entries;
}

type Editor = { kind: unknown; verified: unknown };

/** Los errores de `schema/editors.json` y el cruce de cada entrada del índice con su editor. */
export async function editorsErrors(root: string): Promise<string[]> {
  let doc: unknown;
  try { doc = JSON.parse(await readFile(join(root, FILE), "utf8")) as unknown; }
  catch { return [`${FILE}: no existe o no es JSON`]; }
  if (!isObj(doc) || !Array.isArray(doc.editors)) return [`${FILE}: { editors: [...] }`];

  const errors: string[] = [];
  for (const k of Object.keys(doc)) if (k !== "editors") errors.push(`${FILE}: clave desconocida ${k}`);

  const ids = new Set<string>();
  const names = new Set<string>();
  const byName = new Map<string, Editor>();
  for (const [i, e] of doc.editors.entries()) {
    if (!isObj(e)) { errors.push(`editor ${i}: tiene que ser un objeto`); continue; }
    const id = typeof e.editorId === "string" ? e.editorId : String(i);
    const at = `editor ${id}`;
    for (const k of Object.keys(e)) {
      if (!KEYS.includes(k)) errors.push(`${at}: clave desconocida ${k} (solo editorId, kind, name y verified; el contacto y el acuerdo van al plano de control)`);
    }
    if (typeof e.editorId !== "string" || !SLUG.test(e.editorId)) errors.push(`${at}.editorId: slug en minúsculas, letras, números y guiones`);
    if (typeof e.editorId === "string" && ids.has(e.editorId)) errors.push(`${at}: editorId repetido`);
    if (typeof e.editorId === "string") ids.add(e.editorId);
    if (!KINDS.includes(e.kind as EditorKind)) errors.push(`${at}.kind: nouter, anthropic o partner (tipo)`);
    const validName = typeof e.name === "string" && e.name.trim().length > 0;
    if (!validName) errors.push(`${at}.name: obligatorio (es el publisher del índice)`);
    else if (names.has(e.name as string)) errors.push(`${at}: el name ${String(e.name)} repetido (el publisher es único)`);
    if (validName) names.add(e.name as string);
    if (typeof e.verified !== "boolean") errors.push(`${at}.verified: true o false`);
    // El primer editor de un name es el que cruza; el repetido ya falló arriba.
    if (validName && !byName.has(e.name as string)) byName.set(e.name as string, { kind: e.kind, verified: e.verified });
  }

  for (const entry of await indexEntries(root)) {
    // Un publisher fuera de lugar lo reporta el validador del índice; acá solo se cruza con los editores.
    if (typeof entry.publisher !== "string" || entry.publisher.length === 0) continue;
    const editor = byName.get(entry.publisher);
    if (!editor) { errors.push(`${entry.id}: el publisher ${entry.publisher} no es un editor de ${FILE}`); continue; }
    if (editor.kind === "partner" && editor.verified !== true) {
      errors.push(`${entry.id}: ${entry.publisher} es un partner sin verificar; un item de un partner exige un editor verificado (${FILE})`);
    }
    if (typeof entry.verified === "boolean" && typeof editor.verified === "boolean" && entry.verified !== editor.verified) {
      errors.push(`${entry.id}: verified ${entry.verified} no coincide con el de su editor ${entry.publisher} (${editor.verified})`);
    }
  }
  return errors;
}
