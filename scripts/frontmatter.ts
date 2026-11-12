// Textos que el índice saca de las descripciones.

// La primera oración de una descripción, hasta 100 caracteres (con «…» si se corta), sin el punto final: es la línea de la tarjeta.
export function taglineOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const first = flat.split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, "");
  return first.length <= 100 ? first : `${first.slice(0, 99).trimEnd()}…`;
}

// El `name` y la `description` del frontmatter de un SKILL.md. Lee los formatos reales: `>` (se pliega en un renglón),
// `|` y `|-` (conservan los renglones), una línea simple y una línea entre comillas. Las demás claves se ignoran.
export function parseFrontmatter(text: string): { name: string; description: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!m) throw new Error("falta el frontmatter (--- ... ---) al principio del SKILL.md");
  const lines = m[1].split(/\r?\n/);
  const out: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const k = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!k) continue;
    const [, key, rest] = k;
    const block = /^([>|])[+-]?$/.exec(rest.trim());
    if (block) {
      const body: string[] = [];
      while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || lines[i + 1] === "")) body.push(lines[++i].replace(/^\s+/, ""));
      while (body.length && body[body.length - 1] === "") body.pop();
      out[key] = block[1] === ">" ? body.join(" ").replace(/\s+/g, " ").trim() : body.join("\n");
    } else if (/^".*"$/.test(rest)) out[key] = rest.slice(1, -1).replace(/\\(["\\])/g, "$1");
    else if (/^'.*'$/.test(rest)) out[key] = rest.slice(1, -1).replace(/''/g, "'");
    else out[key] = rest.trim();
  }
  if (!out.name) throw new Error("el frontmatter no tiene name");
  if (!out.description) throw new Error("el frontmatter no tiene description");
  return { name: out.name, description: out.description };
}
