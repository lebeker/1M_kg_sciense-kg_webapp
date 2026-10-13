# kg-viewer

A React viewer for a `kg/1` knowledge-graph document — the web-app half of a
knowledge-graph skill. It builds to **one self-contained HTML file** with every
script and style inlined, so it opens from `file://` with no server, no network
and no build step on the reader's machine.

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

## Landing it in a skill

```bash
bun run build
node scripts/bundle.mjs /path/to/skill-repo
```

Copies `dist/index.html` to `<skill-repo>/assets/viewer.html` and writes
`assets/viewer.version`. The file is **copied, not symlinked**: a skill repo has
to work from a clone, on its own, with no build step and no reference back here.

## Using the same bundle as an MCP-App

The bundle is host-agnostic. To render it inside an AI app, serve this exact
file as an MCP resource at a `ui://` URI with mime `text/html;profile=mcp-app`
and have the tool advertise `_meta.ui.resourceUri`; the host fetches it and
renders it in a sandboxed iframe, and the page talks to the host over
postMessage via `@modelcontextprotocol/ext-apps`. No change to the HTML.

## Licence

MIT — see `LICENSE`.
