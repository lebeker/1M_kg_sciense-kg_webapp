import Graph from 'graphology'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import random from 'graphology-layout/random'

/**
 * kg/1 is the document format. The skill writes it, this app reads it.
 * Only `nodes[].id` and `edges[].{from,to}` are required.
 */
export type KgMeta = {
  title?: string
  schema?: string
  colors?: Record<string, string>
  /** The app that should draw this graph (a template name in the skill's assets/). */
  app?: string
  /** Where to fetch that app from if it is not installed. */
  app_url?: string
  /** What the graph needs beyond the document itself. */
  requires?: { skills?: string[]; plugins?: string[]; tools?: string[] }
}

export type KgNode = {
  id: string
  label?: string
  kind?: string
  level?: number
  size?: number
  style?: string
  desc?: string
  link?: string
  color?: string
  tags?: string[]
  x?: number
  y?: number
  parent?: string
  /**
   * Every other key is a property in its own right: carried through untouched, and the panel
   * gives it its own row. That is the contract — a graph can gain a field without this app
   * changing. `doi` (bare, `10.1126/science.abn9257`) is the canonical case: an identifier,
   * not prose, so it is never buried in `desc`.
   */
  [key: string]: unknown
}

export type KgEdge = {
  from: string
  to: string
  label?: string
  dir?: string
  /** When the edge is a piece of work (a paper, a trial), its date. */
  time?: string | number
  link?: string
  [key: string]: unknown
}

export type KgJson = { meta?: KgMeta; nodes: KgNode[]; edges: KgEdge[] }

/**
 * The one in-memory representation every renderer works from.
 *
 * `graph` is a graphology instance: sigma reads it directly, and the 3D view
 * goes through adapters/forceGraph.ts. Nothing else holds graph state, so a
 * renderer can be swapped or added without touching the data layer.
 */
export type Kg = { graph: Graph; meta: KgMeta; layout: 'authored' | 'rings' | 'computed' }

/**
 * The starter vocabulary's colours. A graph that sets its own meta.colors always wins; this is
 * only what a node looks like before anyone has an opinion, so the main cases of a research map
 * are recognisable without configuration. Anything outside the list gets a stable hash colour.
 */
const STARTER_PALETTE: Record<string, string> = {
  publication: '#cdd9e5',
  researcher: '#d47fa6',
  subject: '#7b9ecb',
  lab: '#93c47d',
  institution: '#9aa0a6',
  company: '#f5a623',
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

function hashColor(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return `hsl(${Math.abs(h) % 360} 55% 55%)`
}

export function emptyKg(): Kg {
  return { graph: new Graph({ multi: true, type: 'directed' }), meta: {}, layout: 'authored' }
}

const placed = (a: Record<string, unknown>): boolean =>
  typeof a.x === 'number' && typeof a.y === 'number' &&
  Number.isFinite(a.x) && Number.isFinite(a.y)

/**
 * Positions are optional in the document and mandatory for sigma: a node without a numeric
 * x/y makes it throw inside the constructor, which leaves a blank page rather than a graph.
 *
 * Three cases, in the order the document gets to decide:
 *   - every node has x,y  -> the author's placement, used as given
 *   - any node has `ring` -> the rings are built (0 at the centre, higher numbers further out)
 *   - neither             -> a force layout, so a graph nobody placed is still readable
 */
export function ensurePositions(kg: Kg): 'authored' | 'rings' | 'computed' {
  const g = kg.graph
  const n = g.order
  if (n === 0) return 'authored'
  let given = 0
  let ringed = 0
  g.forEachNode((_id, a) => {
    if (placed(a)) given += 1
    if (num(a.ring) !== undefined) ringed += 1
  })
  if (given === n) return 'authored'

  if (ringed > 0) {
    layoutRings(g)
    return 'rings'
  }

  if (given === 0) {
    random.assign(g, { scale: 100 })
  } else {
    g.forEachNode((id, a) => {
      if (placed(a)) return
      g.mergeNodeAttributes(id, { x: Math.random() * 100, y: Math.random() * 100 })
    })
  }

  forceAtlas2.assign(g, {
    iterations: n > 500 ? 60 : n > 100 ? 150 : 300,
    // Barnes-Hut is the difference between "instant" and "hang" past a few hundred nodes.
    settings: { barnesHutOptimize: n > 500, scalingRatio: 10, gravity: 1, adjustSizes: true },
  })
  return 'computed'
}

/**
 * `ring` is placement the author asked for, so it is built rather than simulated: ring 0 at the
 * centre, each higher ring further out, nodes spread evenly inside their ring in a stable order
 * so the same document always comes out the same way. A node that also carries x,y keeps them —
 * "put these in the middle" and "move that one left of this" have to be able to coexist.
 */
function layoutRings(g: Graph): void {
  const byRing = new Map<number, string[]>()
  g.forEachNode((id, a) => {
    const r = Math.max(0, Math.round(num(a.ring) ?? 0))
    const bucket = byRing.get(r)
    if (bucket) bucket.push(id)
    else byRing.set(r, [id])
  })

  // Spacing follows the size of the graph, so rings do not touch on a 60-node map and do not
  // scatter to the horizon on a 600-node one.
  const step = 70 + 8 * Math.sqrt(g.order)
  for (const [r, ids] of [...byRing.entries()].sort((a, b) => a[0] - b[0])) {
    const radius = r === 0 ? step * 0.35 : r * step
    ids.sort()
    // Each ring starts at a different angle — without the stagger, a ring of two nodes is a
    // vertical line through the centre and a ring of one is always straight up, which is
    // geometrically defensible and visually useless.
    const skew = r * 0.9
    ids.forEach((id, i) => {
      const a = g.getNodeAttributes(id)
      if (placed(a)) return
      const angle = (2 * Math.PI * i) / ids.length - Math.PI / 2 + skew
      g.mergeNodeAttributes(id, {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
      })
    })
  }
}

/**
 * What a node and an edge look like when the author did not say.
 *
 * `size` and `weight` are the direct controls: set them and they are used as given. Leave them
 * out and the graph still reads — a node is drawn by how connected it is, an edge by how strong
 * it is. That is the difference between a picture that needs editing to be legible and one that
 * is legible on arrival.
 */
function applyVisuals(g: Graph): void {
  g.forEachNode((id, a) => {
    if (num(a.size) !== undefined) return
    g.setNodeAttribute(id, 'size', 1 + Math.log2(1 + g.degree(id)))
  })
  g.forEachEdge((key, a) => {
    const w = num(a.weight)
    if (w === undefined || w <= 1) return
    // Line thickness, so the strongest relations read first.
    g.setEdgeAttribute(key, 'size', Math.min(9, 1 + Math.log2(w)))
  })
}

/**
 * The node keys this reader handles explicitly. Anything else in the document is passed
 * through as it is — the app must not have an opinion about what a graph can carry.
 */
const RESERVED_NODE_KEYS = new Set([
  'id', 'label', 'kind', 'level', 'size', 'style', 'desc', 'link', 'color', 'tags',
  'x', 'y', 'parent',
])

const RESERVED_EDGE_KEYS = new Set(['from', 'to'])

/** kg/1 JSON -> the single graphology graph. */
export function toKg(doc: KgJson): Kg {
  const meta = doc.meta ?? {}
  const graph = new Graph({ multi: true, type: 'directed', allowSelfLoops: true })

  for (const n of doc.nodes ?? []) {
    if (!n?.id || graph.hasNode(n.id)) continue
    const attrs: Record<string, unknown> = {}
    const label = str(n.label), kind = str(n.kind), desc = str(n.desc)
    const link = str(n.link), color = str(n.color), style = str(n.style)
    const parent = str(n.parent)
    if (label !== undefined) attrs.label = label
    if (kind !== undefined) attrs.kind = kind
    if (desc !== undefined) attrs.desc = desc
    if (link !== undefined) attrs.link = link
    if (color !== undefined) attrs.color = color
    if (style !== undefined) attrs.style = style
    if (parent !== undefined) attrs.parent = parent
    if (Array.isArray(n.tags)) attrs.tags = n.tags
    const x = num(n.x), y = num(n.y), size = num(n.size), level = num(n.level)
    if (x !== undefined) attrs.x = x
    if (y !== undefined) attrs.y = y
    if (size !== undefined) attrs.size = size
    if (level !== undefined) attrs.level = level

    // Everything else the document carries is still a property of this node, so it is copied
    // as it is. Enumerating fields here is what used to force a change in this app every time
    // a graph gained one: a graph is data, and its reader must not impose a schema on it.
    for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
      if (RESERVED_NODE_KEYS.has(k) || v === undefined || v === null) continue
      if (typeof v === 'object' && !Array.isArray(v)) continue
      attrs[k] = v
    }
    graph.addNode(n.id, attrs)
  }

  // Colour is a rendering concern, so it is filled in here rather than demanded from the
  // document: the graph's own palette wins over the app's starter colours, and a kind neither
  // of them knows about gets a stable hash — so an unfamiliar kind is at worst oddly coloured,
  // never invisible.
  const palette: Record<string, string> = { ...STARTER_PALETTE, ...(meta.colors ?? {}) }
  graph.forEachNode((id, a) => {
    if (typeof a.color === 'string') return
    const kind = str(a.kind) ?? 'unknown'
    if (!palette[kind]) palette[kind] = hashColor(kind)
    graph.setNodeAttribute(id, 'color', palette[kind])
  })

  let i = 0
  for (const e of doc.edges ?? []) {
    if (!e?.from || !e?.to) continue
    if (!graph.hasNode(e.from) || !graph.hasNode(e.to)) continue
    const attrs: Record<string, unknown> = {}
    const label = str(e.label), dir = str(e.dir)
    if (label !== undefined) attrs.label = label
    if (dir !== undefined) attrs.dir = dir
    // Same rule as nodes: an edge property the document carries is kept, not dropped because
    // this file did not know about it. `weight` on a co-citation edge is the common case.
    for (const [k, v] of Object.entries(e as Record<string, unknown>)) {
      if (RESERVED_EDGE_KEYS.has(k) || v === undefined || v === null) continue
      if (typeof v === 'object' && !Array.isArray(v)) continue
      attrs[k] = v
    }
    try {
      graph.addEdgeWithKey(`e${i++}`, e.from, e.to, attrs)
    } catch {
      // The document is data, not a promise: a rejected edge is skipped, not fatal.
    }
  }

  // Sizes and edge thickness before the layout, because the layout can be told to respect them.
  applyVisuals(graph)

  const kg: Kg = { graph, meta, layout: 'authored' }
  kg.layout = ensurePositions(kg)
  return kg
}

/** sigma draws `size` in pixels; the document's size is an abstract weight. */
export function pxSize(raw: unknown): number {
  const s = num(raw) ?? 2
  return Math.min(30, 3 + s * 1.6)
}

export type KindCount = { kind: string; color: string; count: number }

export function kindsOf(kg: Kg): KindCount[] {
  const by = new Map<string, KindCount>()
  kg.graph.forEachNode((_id, a) => {
    const kind = str(a.kind) ?? 'unknown'
    const cur = by.get(kind)
    if (cur) cur.count += 1
    else by.set(kind, { kind, color: str(a.color) ?? '#7b9ecb', count: 1 })
  })
  return [...by.values()].sort((a, b) => b.count - a.count)
}

export function parseKgJson(text: string | null | undefined): KgJson | null {
  if (!text) return null
  const t = text.trim()
  if (!t || t === '__KG_GRAPH__') return null
  try {
    const doc = JSON.parse(t) as KgJson
    return doc && Array.isArray(doc.nodes) ? doc : null
  } catch {
    return null
  }
}

/**
 * The page carries its graph inline (`script#kg-graph`) because a file:// page
 * cannot fetch a sidecar file. The fetch below is the dev-server path only.
 */
export async function loadKg(): Promise<Kg> {
  const inlined = parseKgJson(document.getElementById('kg-graph')?.textContent)
  if (inlined) return toKg(inlined)
  try {
    const res = await fetch('./graph.json')
    if (res.ok) {
      const doc = (await res.json()) as KgJson
      if (Array.isArray(doc?.nodes)) return toKg(doc)
    }
  } catch {
    // expected under file://
  }
  return emptyKg()
}
