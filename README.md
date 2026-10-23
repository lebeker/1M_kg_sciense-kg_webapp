# kg-viewer

A React viewer for a `kg/1` knowledge-graph document — the web-app half of a
knowledge-graph skill.

**Two worked cases:** <https://lebeker.github.io/1M_kg_sciense-kg_webapp/> — a drug overview of the
neurokinin antagonist class (35 nodes), and a field survey of longevity research (1,817 nodes, 110
categories, 1,563 works), where the graph carries nine documents and the report beside the map is
readable in the page. Each case shows the document it came from and the page it renders into. It
builds to **one self-contained HTML file** with every script and style inlined, so it opens from
`file://` with no server, no network and no build step on the reader's machine.

## The graph object

One representation, three renderers:

```
kg/1 JSON  ──toKg()──▶  { graph: Graph (graphology), meta }  ──┬─▶ sigma          (2D, WebGL)
                                                               └─▶ adapters/forceGraph.ts ─▶ 3d-force-graph (3D)
```

`kg.graph` is a **graphology** instance and is the only graph state anything
reads. `src/kg.ts` builds it from the document (and fills in node colours from
`meta.colors`, hash-coloured per `kind` for anything unspecified).
`src/adapters/forceGraph.ts` turns the same graph into the `{ nodes, links }`
shape 3d-force-graph wants — it returns fresh objects every call, because
3d-force-graph mutates its input in place (it swaps `source`/`target` strings for
node references and writes `x`/`y`/`z` back onto nodes). Passing it the live
graph would corrupt the shared data layer.

`z` carries hierarchy when the document has `level`; otherwise it is 0 and the
force layout arranges depth itself.

## Two builds, on purpose

| command | output | why |
|---|---|---|
| `bun run build` | `dist/index.html` — one file, ~1.8 MB | what the skill ships; must open from `file://` |
| `bun run build:multi` | `dist-multi/` — code-split | what a hosted app serves; 3D is fetched on demand |

`vite-plugin-singlefile` sets `codeSplitting: false` (Rollup's
`inlineDynamicImports`), so **lazy loading and single-file output cannot coexist
in one build** — it is one or the other. Hence the flag. In `build:multi` the 3D
code is its own chunk and is not fetched until the 3D button is pressed:

```
dist-multi/assets/index-*.js            383.79 kB │ gzip: 107.88 kB   app + sigma + graphology
dist-multi/assets/3d-force-graph-*.js 1,388.13 kB │ gzip: 371.21 kB   three + 3d-force-graph — on demand
```

In the single-file build everything is present but 3D still only *executes* when
it is opened.

## Build

```bash
bun install            # or: npm install
bun run build          # -> dist/index.html
bun run build:multi    # -> dist-multi/
bun run dev            # dev server; reads ./graph.json as a sidecar
bun run typecheck
```

`public/graph.json` is gone: the dev server falls back to `fetch('./graph.json')`
if one is present next to the served page, and otherwise renders an empty graph.

## Getting the graph in

A page opened from `file://` **cannot** `fetch()` a sidecar JSON file — the
browser blocks it. So the graph is inlined into the document:

```html
<script id="kg-graph" type="application/json">__KG_GRAPH__</script>
```

The build output keeps that element and that placeholder verbatim. Whatever
produces the final page replaces the element's text with the `kg/1` JSON and
changes nothing else. Opening the file with the placeholder still in place shows
an empty graph and logs no errors.

The documents beside the graph travel the same way, so the page needs no folder:

```html
<script id="kg-docs" type="application/json">__KG_DOCS__</script>
```

It is a map of `docs/<file>` → text. When more than one is present the page opens
them as a folder — a list on the left, the document beside it, a node id in
backticks selecting that node on the map — and `meta.docs` (written by
`docs/index.json`) gives each one its title and role. A page with only a single
note still shows a plain **notes** button.

## The app's declaration — `app.json`

This repository ships two things, not one. The second is `app.json`: what this app **is for**,
what it **needs** in order to be useful, and the node kinds and edge patterns a graph for it
is made of.

It is what turns "make me a graph" into a specific thing to build. A skill reads it to:

- match a user's words to this app rather than to whatever is first in a list,
- tell the user what has to be installed first — and **why** (`tool_notes`: OpenAlex carries
  works, authors, institutions and concepts; a web search is the only way to evidence a
  company; nothing else lists what a private company is working on),
- build the graph to this app's conventions: `kinds` seed the palette, `edges` are the
  patterns that make a map of this kind legible. A piece of work is an **edge** between the
  researcher and the subject, not a node with a line to something.

Edit it here, in this repo — the app owns the definition of its own goal. It is published at
`…/main/app.json` (not tag-pinned: what the app is *for* does not change when the build
does), and picked up by `fetch-app`, or copied in by `bundle.mjs` as
`assets/viewer.app.json`.

## Landing it in a skill

```bash
bun run build
node scripts/bundle.mjs /path/to/skill-repo
```

Copies `dist/index.html` to `<skill-repo>/assets/viewer.html`, `app.json` to
`assets/viewer.app.json`, and writes `assets/viewer.version` (repo, commit, build time, where
to fetch a newer one). The files are **copied, not symlinked**: a skill repo has to work from
a clone, on its own, with no build step and no reference back here.

## Publishing a new build

```bash
bun run build:local && bun run release
```

`release` writes the artifact to a `dist` branch (git plumbing, never a checked-out orphan
branch) and tags it `viewer-v<version>`: an immutable URL, one `curl`, no node and no bun for
whoever wants the viewer. A fix gets a new version — the old tag keeps serving exactly what
it served. With `gh` authenticated it also attaches the file to a GitHub Release.

## Using the same bundle as an MCP-App

The bundle is host-agnostic. To render it inside an AI app, serve this exact
file as an MCP resource at a `ui://` URI with mime `text/html;profile=mcp-app`
and have the tool advertise `_meta.ui.resourceUri`; the host fetches it and
renders it in a sandboxed iframe, and the page talks to the host over
postMessage via `@modelcontextprotocol/ext-apps`. No change to the HTML.

## Licence

MIT — see `LICENSE`.
