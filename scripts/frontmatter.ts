// Textos que el índice saca de las descripciones.

// La primera oración de una descripción, hasta 100 caracteres (con «…» si se corta), sin el punto final: es la línea de la tarjeta.
export function taglineOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const first = flat.split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, "");
  return first.length <= 100 ? first : `${first.slice(0, 99).trimEnd()}…`;
}
