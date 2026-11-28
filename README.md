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

Los editores son `Nouter` (para `delivery-salesforce`) y `Anthropic` (para los otros 15 plugins y las 17 skills); la lista
está en [`schema/editors.json`](schema/editors.json).

## Qué entra

Solo con licencia libre (`Apache-2.0`, `MIT`, `BSD-2-Clause`, `BSD-3-Clause` o `ISC`), con su archivo de licencia en la
carpeta del item (`LICENSE*` o `LICENSES/`) y, si se copió de otro repo, su origen (`x-nouter.source`: repo y commit).
Además, `licenses` suma una licencia de la lista cerrada (hoy solo `OFL-1.1`) cuando el item trae archivos de fuente: va en
`x-nouter.licenses` de un plugin y en la raíz de un item suelto, y exige al menos una fuente y el texto de la SIL OFL 1.1
de cada familia (`<Familia>-OFL.txt`). Es la de las 29 familias de `canvas-design`, junto a su Apache-2.0; el índice del
Directory sigue llevando una sola licencia.

## La siembra de lo libre de Anthropic

Se **copia**, no se referencia: los plugins de `knowledge-work-plugins` cuyo `source` es local (los de terceros que lista su
marketplace no entran) y las skills de `anthropics/skills` con `LICENSE.txt` Apache-2.0 (sin ella, como `doc-coauthoring`, no entra;
tampoco `partner-built/*`). Cada item lleva su licencia (la del root, si el plugin no trae la suya) y su origen: `x-nouter.source`, con
el repo y el commit (`877a617` de `knowledge-work-plugins` y `2c5958e` de `skills`). Un servidor stdio corre un comando local: el OS de Nouter no lo ejecuta y el CI solo acepta http. A un plugin que trae stdio y http se le
quitan los stdio; uno que trae **solo** stdio no entra (`pdf-viewer`: depende de un servidor local, que Nouter no corre). Tampoco entran `cowork-plugin-management` (pide el entorno de la app Cowork) ni la skill `academy-guide` (recomienda Claude Academy y en Nouter el modelo puede no ser Claude): la lista, con su motivo, es `EXCLUDED` en `scripts/import-anthropic.ts`. Cada plugin y skill sembrado lleva un `tagline` curado (`x-nouter.tagline` o `tagline`, hasta 100 caracteres); sin él, la tarjeta usa la primera oración de la descripción.

El commit del que sale cada copia es un dato, `scripts/anthropic-lock.json` (`kwp` y `skills`): es el default del importador
y lo que exige el CLI. Se volvió a generar con `node scripts/import-anthropic.ts <knowledge-work-plugins> <skills>`, con los
dos repos clonados afuera de este (en una carpeta de datos) en esos commits. Correrlo de nuevo no duplica.

Traer una versión nueva es del job del reloj de nouter (`directory-seed-sync.yml`), que corre
`npm run sync:anthropic -- --clones <dir> --informe <archivo>`: clona los dos upstream, compara los HEAD con el lock, importa
con este mismo importador, deja el informe para el PR y **mueve el lock solo si los bytes copiados cambiaron**. No mergea ni
publica: abre (o actualiza) un PR en `sync/anthropic` con los tests y el `validate.ts` ya corridos, y una persona lo revisa,
mide los `.mcp.json` que cambiaron y lo mergea; el release y `directory:update` siguen a mano. Si un item de las tablas se fue
del upstream, una licencia cambió o un pin ya no existe, el script frena cerrado (sale 1) sin escribir nada.

La OFL de las fuentes de `canvas-design` se declara además de su Apache-2.0. Dos familias del upstream no traen su texto
(`IBMPlexSerif` e `InstrumentSerif`): viajan en `scripts/font-licenses/`, tal como los publican sus proyectos, y el importador
los repone después de copiar la skill. Una familia nueva sin texto la frena el CI.

## Formato

- **Plugins:** su fila de `.claude-plugin/marketplace.json` lleva, además de las del formato de marketplace de Claude,
  `category` (uno de los 18 temas de `schema/categories.json`), `tags` (hasta 2 temas más), `author.name`, `license`, y
  `x-nouter`: `{ verified, tagline?, flag?, source? }`. `flag` es el de nouter que esconde el item a quien no lo tiene
  (`schema/flags.json`, la foto de los nombres vigentes).
- **Skills y blueprints sueltos:** `.nouter/directory.json`, `{ items: [{ type, name, path, description, category, tags,
  author, license, verified, tagline?, flag?, source? }] }`. `path` es la carpeta con su `SKILL.md` o `blueprint.json`.
- **Destacados:** `.nouter/featured.json`, `{ skills?: "skill:<name>", plugins?: "plugin:<name>" }`, el banner de cada pestaña.

### Editores

`schema/editors.json` es la copia pública de los editores del Directory: quién publica, con solo cuatro datos por editor:
`editorId` (el slug estable), `kind` (`nouter`, `anthropic` o `partner`), `name` —el `publisher` que usa el índice— y
`verified`. Hoy son `nouter` y `anthropic`, los dos verificados.

El CI cruza cada entrada del índice —cada plugin y cada skill suelta— contra su editor: el `publisher` tiene que ser el
`name` de un editor, el `verified` de la entrada tiene que coincidir con el del editor (en las dos direcciones) y un item
de un `partner` exige un editor verificado. Un editor sin entradas no es un error: un partner puede estar registrado y no
haber publicado nada.

El archivo lo escribe el plano de control en el mismo PR que publica un item. Los datos sensibles de
un editor —el contacto de seguridad y el acuerdo— no viven en este repo: son del plano de control y no entran a esta
copia.

## Releases

Cada tag `vN` publica `directory.json` (el índice de lo que se muestra: las entradas con sus datos y `added`, la fecha del
commit que las agregó) y empuja la rama inmutable `release/vN` (`scripts/release-branch.ts`: si ya existe en el mismo commit, un re-run sigue; en otro, falla), que es la que sincroniza cada tenant (el lector de git del OS
solo sigue ramas). nouter fija una versión y la sube con un PR propio.

## Desarrollo

Node 24, sin dependencias: `npm test`, `node scripts/validate.ts` y `node scripts/build.ts dev`. El CI corre las dos primeras
en cada PR.

Licencia: Apache-2.0.
