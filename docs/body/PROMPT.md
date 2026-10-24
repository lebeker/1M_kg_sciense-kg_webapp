# PROMPT — schematic body map with organ constellations

Copy everything below the line into the other model. It assumes the model has shell access to the
repo and can run a browser for verification.

---

You are working in `~/Work/other/1M_kg_health_webapp` — a copy of the science-kg viewer plus a
standalone static three.js page at `body/index.html`. Read `HISTORY.md` and `body/README.md` first:
they record every asset we pulled in and every attempt that failed, so you do not repeat them.

## What this product is

A **personal health map**, not an anatomy atlas. The 3D body is a schematic map whose only job is
to help a user or a specialist *find the weak point fast*: a cardiologist opens the map, sees that
the ophthalmologist already marked retinopathy on the eye node, and follows it. Detail belongs in
the graph, not in the mesh.

Three consequences, in order of importance:

1. **The body is cartoonish and schematic.** An androgynous figure with smooth, simple shapes and
   flat colour. No realistic skin, no muscles with fibre detail, no anatomical texturing. Readable
   at a glance, cheap to render, and it must not pretend to be a medical model.
2. **Organs are blobs.** Each organ is a simple shape at a plausible place, not an anatomically
   accurate mesh. A blob is enough to click.
3. **Clicking an organ opens a constellation.** The blob is a doorway: it opens a local graph of
   that organ's nodes — the organ itself, its parts, conditions, analyses, protocols — laid out as
   a constellation where each node carries a small, recognisable silhouette of what it represents.
   Position inside the constellation has **no anatomical meaning**; the edges carry the meaning.

The graph is the database. Users add their own nodes (a diagnosis, an analysis, a protocol, a
medication) and edges; the map is how they browse it. Scans and documents are assets stored beside
the graph, never inside it.

## What exists today

- `body/index.html` — a static page, three.js r146, no build step. Left legend with per-layer eye
  toggles, a sex switch, three view modes (one body / one layer out / all apart), GLB layers loaded
  from `body/models/`.
- `body/models/` — `bones`, `muscles`, `cardio`, `nervous`, `lymphoid`, `organs` (104 separate
  organs, coloured), `skin`, `skinbits`, `reproductive-male`, `reproductive-female`, `skin-female`.
  All exported from Z-Anatomy (models CC BY-SA 4.0) plus one CC0 body scan. They are **reference**,
  not the target style.
- The graph contract (unchanged from science-kg): a `kg/1` JSON with nodes (`id`, `type`, `label`,
  `level`, `weight`, `props`) and edges (`from`, `to`, `kind`, `power`), embedded in the page as
  `<script id="kg-graph" type="application/json">__KG_GRAPH__</script>`; documents as
  `<script id="kg-docs" type="application/json">__KG_DOCS__</script>`.
- `src/` — the React + Vite app (sigma for 2D, three for 3D). Do not break it.

## Build this

**1. Schematic body.** Replace the realistic shells with a stylised androgynous figure built from
simple geometry (capsules, spheres, rounded boxes — either generated in three.js or exported once
as a small GLB). Layer groups stay the same (bones, muscles, organs, cardio, nervous, lymphoid,
skin) but every layer is flat-shaded, low-poly and clearly diagrammatic. Keep the existing legend,
eye toggles and three view modes. The sex switch stays as a `meta.props`-driven control, but the
figure itself is androgynous — the switch changes the reproductive layer only.

**2. Organ blobs.** One blob per organ, each a separate mesh (so each can be a graph node), placed
plausibly, coloured by system, with hover and selection states. Organs that belong to a system
still live in that layer; clicking any organ selects it.

**3. The constellation.** Clicking an organ opens a canvas overlay or side panel showing that
organ's local graph: the organ node at the centre, its parts/conditions/analyses radiating out,
edges labelled by kind (`has-part`, `sign-of`, `measured-by`, `treated-by`, `risk-from`). Every
node carries a small silhouette (SVG is fine) of what it represents — a kidney node looks like a
kidney, a blood test looks like a vial. Layout is force-directed or radial; **it does not encode
anatomy**. Clicking a node in the constellation opens its details, and nodes of type `condition`
or `analysis` can be attached to other organs — that is how a specialist leaves a mark for the
next one.

**4. The graph as a database.** Add a minimal editor: create a node (type, label, optional props),
connect it to an existing node, delete what you created. Persist to `localStorage` for now behind a
single module (`body/store.js`) whose interface is async and shaped like a future API
(`listNodes`, `addNode`, `addEdge`, `removeNode`), so a server can replace it later without touching
the UI. Every organ blob reads its id from the graph; no hard-coded organ names in the viewer beyond
the fixture.

**5. Ship a fixture.** Author a small `kg/1` graph for one region — heart and its neighbourhood:
heart, its chambers and valves, hypertension, ECG, echocardiogram, beta-blocker, cardiologist — so
the constellation has something real to show. Keep it in `body/fixture.json`, loaded when no
`kg-graph` script is present.

## Acceptance

- Opening `body/index.html` (over `http://`, any static server) shows the schematic androgynous
  body with all layers, legend, eye toggles and the three view modes, and no realistic meshes.
- Clicking the heart blob opens a constellation with at least six nodes and labelled edges; every
  node has a silhouette; clicking one opens its details.
- Adding a node, connecting it and reloading keeps it (localStorage), and the organ blob reflects
  the new count on its badge.
- No console errors; 60 fps at 1280×800 with all layers visible; page weight under 6MB.
- `README.md` in `body/` documents the store interface, the fixture format and the layer naming.

## Constraints

- No servers, no build step for `body/` — it is a static page plus ES modules.
- Do not deform the existing realistic meshes to make them schematic; build the schematic shapes
  separately and leave the anatomy GLBs untouched as reference.
- Z-Anatomy models are CC BY-SA 4.0: if any of their geometry survives in the product, the
  attribution and share-alike note stays in `body/README.md`.
- Do not chase realism, anatomical placement accuracy, or clinical correctness. If a choice is
  between "looks more medical" and "reads faster", pick reads faster.
- Commit once at the end with a message that says what changed; do not commit per file.
