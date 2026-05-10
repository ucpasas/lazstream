# WIKI_SCHEMA — lazstream

This file defines the conventions all wiki pages must follow.
The LLM reads this file to know how to write and maintain the wiki.
The human reads this file to understand the layout.

---

## Directory layout

```
wiki/
  WIKI_SCHEMA.md        ← this file (never modify content — only add to it)
  index.md              ← navigation hub; one status row per page
  log.md                ← append-only chronological record
  projects/             ← one page per major workstream / module
    manifest-loader.md
    streaming-engine.md
    decoder-workers.md
    renderer.md
    chunk-caching.md
    spatial-index.md
  concepts/             ← reusable technical concepts, format-level details
    laz-format.md
    webgpu-compute.md
    http2-range-requests.md
    lidarscout-chunk-seed.md
    ring-buffer-gpu.md
```

Raw source documents (PDFs, articles, specs) live in `docs/` and are **read-only** — the LLM never modifies them.

---

## Frontmatter

Every wiki page (except `log.md` and `index.md`) starts with YAML frontmatter:

```yaml
---
title: Human-readable page title
type: project | concept
status: active | draft | stale | archived
updated: YYYY-MM-DD
tags: [tag1, tag2]
---
```

- `status: active` — current, authoritative
- `status: draft` — skeleton; content incomplete
- `status: stale` — may be outdated; needs review
- `status: archived` — superseded; kept for history

---

## Wikilinks

Internal cross-references use double-bracket wikilink syntax:

```
[[Page Title]]                  ← links to a page by its title
[[Page Title|display text]]     ← aliased link
```

Pages are identified by their `title` frontmatter field, not their filename.
When creating a new page that is referenced from another page, add the link immediately — do not leave dangling references.

---

## Log entries

`log.md` is append-only. Each entry:

```markdown
## YYYY-MM-DD — Short summary of what happened

- Ingested: <source name>
- Created: [[Page Title]]
- Updated: [[Page Title]], [[Another Page]]
- Key finding: one sentence.
```

Always append to the bottom of `log.md`. Never edit existing entries.

---

## Lint checklist

Run periodically. Check for:
- [ ] Pages with `status: stale` that need content review
- [ ] Wikilinks that reference pages which do not exist
- [ ] Pages with no inbound wikilinks (orphans)
- [ ] Concepts mentioned in project pages that lack their own concept page
- [ ] `index.md` rows that are missing or have wrong status
- [ ] `updated` dates older than 60 days on `status: active` pages
