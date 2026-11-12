# Nouter plugin catalog

Los plugins, las skills y los blueprints que Nouter ofrece a todas las empresas. Es un marketplace
(`.claude-plugin/marketplace.json`, nombre `nouter`) y, junto con [`Nouter-ai/mcp-catalog`](https://github.com/Nouter-ai/mcp-catalog)
(los conectores), el **Nouter Directory**: lo que muestra *Customize → Discover*. Cada tenant lo sincroniza como la colección
del sistema *Nouter Directory*, en el release que fija el plano de control.

| Plugin | Qué es |
|---|---|
| `delivery-salesforce` | Delivery for Salesforce, el primer stack de la línea de entrega: la plantilla de proceso «Delivery order» y las skills de cada etapa. |

## Qué entra

Solo con licencia libre (`Apache-2.0`, `MIT`, `BSD-2-Clause`, `BSD-3-Clause` o `ISC`), con su archivo de licencia en la
carpeta del item (`LICENSE*` o `LICENSES/`) y, si se copió de otro repo, su origen (`x-nouter.source`: repo y commit).

## Formato

- **Plugins:** su fila de `.claude-plugin/marketplace.json` lleva, además de las del formato de marketplace de Claude,
  `category` (uno de los 18 temas de `schema/categories.json`), `tags` (hasta 2 temas más), `author.name`, `license`, y
  `x-nouter`: `{ verified, flag?, source? }`. `flag` es el de nouter que esconde el item a quien no lo tiene
  (`schema/flags.json`, la foto de los nombres vigentes).
- **Skills y blueprints sueltos:** `.nouter/directory.json`, `{ items: [{ type, name, path, description, category, tags,
  author, license, verified, flag?, source? }] }`. `path` es la carpeta con su `SKILL.md` o `blueprint.json`.
- **Destacados:** `.nouter/featured.json`, `{ skills?: "skill:<name>", plugins?: "plugin:<name>" }`, el banner de cada pestaña.

## Releases

Cada tag `vN` publica `directory.json` (el índice de lo que se muestra: las entradas con sus datos y `added`, la fecha del
commit que las agregó) y empuja la rama inmutable `release/vN`, que es la que sincroniza cada tenant (el lector de git del OS
solo sigue ramas). nouter fija una versión y la sube con un PR propio.

## Desarrollo

Node 24, sin dependencias: `npm test`, `node scripts/validate.ts` y `node scripts/build.ts dev`. El CI corre las dos primeras
en cada PR.

Licencia: Apache-2.0.
