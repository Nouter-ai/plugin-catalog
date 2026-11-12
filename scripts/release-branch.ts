// La rama inmutable release/vN que sincroniza cada tenant (el lector de git del OS solo sigue ramas). Un re-run del release (por
// ejemplo, después de un `gh release create` fallido) tiene que funcionar: la rama puede existir, pero solo en este mismo commit.
// Uso (en el workflow): node scripts/release-branch.ts <tag>

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Decision = "push" | "skip" | "conflict";

export const parseLsRemote = (out: string): string | null => out.trim().split(/\s+/)[0] || null;

export const decide = (remote: string | null, head: string): Decision => (remote === null ? "push" : remote === head ? "skip" : "conflict");

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tag = process.argv[2];
  if (!/^v[1-9][0-9]*$/.test(tag ?? "")) throw new Error("uso: node scripts/release-branch.ts vN");
  const branch = `release/${tag}`;
  const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8" });
  const head = git("rev-parse", "HEAD").trim();
  const d = decide(parseLsRemote(git("ls-remote", "--heads", "origin", branch)), head);
  if (d === "conflict") throw new Error(`${branch} ya existe en otro commit: un release no se rehace, se sube la versión`);
  if (d === "push") git("push", "origin", `HEAD:refs/heads/${branch}`);
  console.log(`${branch}: ${d === "push" ? "creada" : "ya estaba en este commit"}`);
}
