# PROMPT — a designed 3D body map with organ constellations

Hand everything below the rule to the other model. It has shell access and a browser; it is
expected to model, render, look at its own screenshots and iterate. Judge it on the pictures.

---

You are working in `~/Work/other/1M_kg_health_webapp` — a copy of the science-kg viewer plus a
standalone three.js page at `body/index.html`. Read `HISTORY.md` and `body/README.md` first: they
list every asset we pulled in and every attempt that failed, so you don't repeat them.

## The product

A personal health map. The body is the *map*, the graph is the *database*. A specialist opens it
and finds the weak point fast — a cardiologist sees that the ophthalmologist already marked
retinopathy on the eye, and follows the thread. Detail lives in the graph; the body is how you
navigate it.

## The bar

This is a **designed 3D illustration**, not a diagram. It will be judged on screenshots at
1280×800, at 100% zoom, next to the science-kg case. A stickman, a mannequin of spheres, or
anything that reads as a placeholder is a failed delivery. The body must look intentional: clean
forms, a consistent palette, soft studio lighting, a silhouette you would put on a landing page.
Stylised is fine — cheap is not.

Organs are **modelled and recognisable**, moderately detailed, each its own mesh: a heart with
atria, ventricles and aortic arch; a bean-shaped kidney with a ureter; a lobed liver; lungs with
lobes; a curved stomach; a coiled intestine. Not spheres.

Clicking an organ opens its **constellation**: a local graph where every node carries a small 3D
organ or object — reusing the same meshes, scaled down — never an SVG icon.

## What exists

- `body/index.html` — static page, three.js r146, no build step. Legend with per-layer eye toggles,
  a sex switch, three view modes (one body / one layer out / all apart), GLB layers from
  `body/models/`.
- `body/models/` — Z-Anatomy-derived layers (bones, muscles, cardio, nervous, lymphoid, organs with
  104 separate organs) plus a CC0 female surface. **Reference material, not the target style** —
  use them for shape, proportion and topology; restyle, retopologise, decimate, re-material them.
  Do not ship them as they are.
- The graph contract, unchanged from science-kg: `kg/1` JSON with nodes (`id`, `type`, `label`,
  `level`, `weight`, `props`) and edges (`from`, `to`, `kind`, `power`), embedded as
  `<script id="kg-graph" type="application/json">__KG_GRAPH__</script>`, documents as
  `<script id="kg-docs" ...>`. `src/` is the React app — don't break it.

## Build

1. **The figure.** A stylised, androgynous human body with separable layers (skin, muscles, bones,
   circulatory, nervous, lymphatic, organs). Author it properly — Blender is installed at
   `~/Applications/Blender.app`; MakeHuman/MPFB2 and the CC0 scan in `HISTORY.md` are legitimate
   bases to retopo and restyle, and Z-Anatomy's skeleton is the reference for proportion. Same
   height and framing as now; keep the legend, eye toggles, three modes and the sex prop.

2. **The organs.** Each organ a separate mesh, positioned plausibly, coloured by system, with
   hover/selection states and a badge carrying its node count. Derive shapes from the atlas organs
   (decimate, smooth, restyle) rather than blocking them out of primitives.

3. **The constellation.** On click, open a view where the organ sits at the centre and its parts,
   conditions, analyses and protocols radiate out; each node shows a miniature 3D object (same
   meshes, instanced and scaled, or small dedicated GLBs). Edges are labelled by kind (`has-part`,
   `sign-of`, `measured-by`, `treated-by`, `risk-from`). Layout is radial or force-directed — it
   carries no anatomical meaning. Nodes open a detail panel; a condition or analysis can be
   attached to any organ, which is how one specialist leaves a mark for the next.

4. **The store.** A minimal editor — create node, connect, delete — persisted to `localStorage`
   behind one async module (`body/store.js`) shaped like a future API (`listNodes`, `addNode`,
   `addEdge`, `removeNode`). Organ blobs read their ids from the graph.

5. **Fixture.** A small `kg/1` graph for the heart's neighbourhood — heart, chambers, valves,
   hypertension, ECG, echocardiogram, beta-blocker, cardiologist — loaded when no `kg-graph` script
   is present, so the constellation has something real to show.

## Acceptance

- Three screenshots, at 1280×800: the whole body, one layer pulled out, and the heart's
  constellation open. They must look like a designed product, not a prototype — clean silhouette,
  coherent palette, soft light, no primitive seams, no placeholder shapes.
- Every organ is individually clickable; the heart's constellation shows at least eight nodes with
  labelled edges and miniatures; a node opens its details.
- Add a node, connect it, reload — it persists; the organ badge increments.
- 60 fps at 1280×800 with all layers visible; page weight under 8MB; no console errors.
- `body/README.md` documents the art direction, the store interface and the fixture format.

## Constraints

- No servers or build step for `body/` — static page plus ES modules.
- Z-Anatomy geometry is CC BY-SA 4.0: attribution and share-alike stay in `body/README.md` if any
  of it survives. The CC0 scan and MakeHuman output carry no such obligation.
- Do not chase photoreal or clinical accuracy — chase a beautiful, readable map. But "stylised" is
  a design decision, not an excuse for crude geometry.
- Iterate on screenshots at least twice before you call it done; the first pass is never the
  delivery.
- Commit once at the end; do not commit per file.
