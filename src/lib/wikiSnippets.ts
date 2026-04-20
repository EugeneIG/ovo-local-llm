import type { WikiPage } from "../db/wiki";
import type { SlashCommand } from "./slashCommands";

// [START] Phase 8 — Wiki-driven snippet/template slash commands.
// Any non-archived wiki page tagged `#snippet` becomes a `template`-kind
// slash command at `/{slug}`. Picking it inserts the page body into the
// chat input so the user can edit before sending. This is the home for the
// "프롬프트 템플릿/Snippets" roadmap item — Wiki is already the durable
// store, so reusing it avoids a parallel snippet table.

const SNIPPET_TAG = "snippet";

export function isSnippet(page: WikiPage): boolean {
  if (page.archived) return false;
  return page.tags.some((t) => t.toLowerCase() === SNIPPET_TAG);
}

export function snippetSlashCommand(page: WikiPage): SlashCommand {
  // The popup matches by id/aliases prefix; we want both the slug and the
  // user-friendly title to be discoverable.
  const aliases: string[] = [];
  const titleSlug = page.title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9가-힣-]/g, "");
  if (titleSlug && titleSlug !== page.slug) aliases.push(titleSlug);

  return {
    id: page.slug,
    aliases,
    name: `/${page.slug}`,
    emoji: "📋",
    description: page.title || page.slug,
    kind: "template",
    template: () => page.content,
  };
}

export function buildSnippetCommands(pages: WikiPage[]): SlashCommand[] {
  return pages.filter(isSnippet).map(snippetSlashCommand);
}
// [END]
