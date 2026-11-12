# Nouter plugin catalog

Los plugins, las skills y los blueprints que Nouter ofrece a todas las empresas. Es un marketplace
(`.claude-plugin/marketplace.json`, nombre `nouter`) y, junto con [`Nouter-ai/mcp-catalog`](https://github.com/Nouter-ai/mcp-catalog)
(los conectores), el **Nouter Directory**: lo que muestra *Customize → Discover*. Cada tenant lo sincroniza como la colección
del sistema *Nouter Directory*, en el release que fija el plano de control.

| Plugin | Qué es |
|---|---|
| `delivery-salesforce` | Delivery for Salesforce, el primer stack de la línea de entrega: la plantilla de proceso «Delivery order» y las skills de cada etapa. |
| los 15 de Anthropic | Los plugins propios de [`anthropics/knowledge-work-plugins`](https://github.com/anthropics/knowledge-work-plugins) (`sales`, `finance`, `legal`, …), copiados. |

Además, 17 skills sueltas de [`anthropics/skills`](https://github.com/anthropics/skills) (`.nouter/directory.json`).

## Qué entra

Solo con licencia libre (`Apache-2.0`, `MIT`, `BSD-2-Clause`, `BSD-3-Clause` o `ISC`), con su archivo de licencia en la
carpeta del item (`LICENSE*` o `LICENSES/`) y, si se copió de otro repo, su origen (`x-nouter.source`: repo y commit).

## La siembra de lo libre de Anthropic

Se **copia**, no se referencia: los plugins de `knowledge-work-plugins` cuyo `source` es local (los de terceros que lista su
marketplace no entran) y las skills de `anthropics/skills` con `LICENSE.txt` Apache-2.0 (sin ella, como `doc-coauthoring`, no entra;
tampoco `partner-built/*`). Cada item lleva su licencia (la del root, si el plugin no trae la suya) y su origen: `x-nouter.source`, con
el repo y el commit (`877a617` de `knowledge-work-plugins` y `2c5958e` de `skills`). Un servidor stdio corre un comando local: el OS de Nouter no lo ejecuta y el CI solo acepta http. A un plugin que trae stdio y http se le
quitan los stdio; uno que trae **solo** stdio no entra (`pdf-viewer`: depende de un servidor local, que Nouter no corre). Tampoco entran `cowork-plugin-management` (pide el entorno de la app Cowork) ni la skill `academy-guide` (recomienda Claude Academy y en Nouter el modelo puede no ser Claude): la lista, con su motivo, es `EXCLUDED` en `scripts/import-anthropic.ts`. Cada plugin y skill sembrado lleva un `tagline` curado (`x-nouter.tagline` o `tagline`, hasta 100 caracteres); sin él, la tarjeta usa la primera oración de la descripción.

Se volvió a generar con `node scripts/import-anthropic.ts <knowledge-work-plugins> <skills>`, con los dos repos clonados afuera de
este (en una carpeta de datos) en esos commits. Correrlo de nuevo no duplica. Traer versiones nuevas es del backlog del Directory.

## Formato

- **Plugins:** su fila de `.claude-plugin/marketplace.json` lleva, además de las del formato de marketplace de Claude,
  `category` (uno de los 18 temas de `schema/categories.json`), `tags` (hasta 2 temas más), `author.name`, `license`, y
  `x-nouter`: `{ verified, tagline?, flag?, source? }`. `flag` es el de nouter que esconde el item a quien no lo tiene
  (`schema/flags.json`, la foto de los nombres vigentes).
- **Skills y blueprints sueltos:** `.nouter/directory.json`, `{ items: [{ type, name, path, description, category, tags,
  author, license, verified, tagline?, flag?, source? }] }`. `path` es la carpeta con su `SKILL.md` o `blueprint.json`.
- **Destacados:** `.nouter/featured.json`, `{ skills?: "skill:<name>", plugins?: "plugin:<name>" }`, el banner de cada pestaña.

## Releases

Cada tag `vN` publica `directory.json` (el índice de lo que se muestra: las entradas con sus datos y `added`, la fecha del
commit que las agregó) y empuja la rama inmutable `release/vN` (`scripts/release-branch.ts`: si ya existe en el mismo commit, un re-run sigue; en otro, falla), que es la que sincroniza cada tenant (el lector de git del OS
solo sigue ramas). nouter fija una versión y la sube con un PR propio.

## Desarrollo

Node 24, sin dependencias: `npm test`, `node scripts/validate.ts` y `node scripts/build.ts dev`. El CI corre las dos primeras
en cada PR.

Licencia: Apache-2.0.
