// Los 18 temas del Directory (docs/nouter/producto/conectores/nouter-directory.md#categorías): la misma lista, con rótulos, en
// schema/categories.json, en mcp-catalog y en @yunta/ui. Un test compara esta con el archivo.

export const CATEGORIES = [
  "automation-workflows", "contacts-leads", "databases", "design-media", "email-messages", "engineering", "events-tickets",
  "files-documents", "finance", "legal", "logs-errors", "marketing", "notes-memory", "reference-docs", "retail-ecommerce",
  "sales", "tickets-tasks", "websites",
] as const;
export type DirectoryCategory = (typeof CATEGORIES)[number];
