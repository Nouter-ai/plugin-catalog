// Foto de los nombres de los flags de nouter (packages/yunta-control/src/flags.ts): el CI de este repo no tiene acceso al
// de nouter, así que un item que dice `x-nouter.flag` se valida contra esta lista. schema/flags.json la espeja y un test las
// compara; se actualiza cuando un item del catálogo pasa a depender de un flag nuevo.

export const FLAGS: readonly string[] = [
  "analitica-producto",
  "blueprints-customize",
  "conector-emdash",
  "conector-eset",
  "conector-hexnode",
  "conector-nouter-sor",
  "customize-plugins",
  "directory-nativos",
  "falla-slack-caido",
  "fresh-hop",
  "gatekeeper-control",
  "inbox",
  "incluido-organizacion",
  "lenguaje-visual",
  "link-invitacion",
  "niveles",
  "preferencias-avisos",
  "prueba-flags",
  "roles-y-permisos",
  "salesforce-delivery",
  "skills-catalogo",
  "skills-estado",
  "skills-sharing"
];
