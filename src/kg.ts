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
}

export type KgEdge = {
  from: string
  to: string
  label?: string
  dir?: string
  /** When the edge is a piece of work (a paper, a trial), its date. */
  time?: string | number
  link?: string
}

export type KgJson = { meta?: KgMeta; nodes: KgNode[]; edges: KgEdge[] }

/**
 * The one in-memory representation every renderer works from.
 *
 * `graph` is a graphology instance: sigma reads it directly, and the 3D view
 * goes through adapters/forceGraph.ts. Nothing else holds graph state, so a
 * renderer can be swapped or added without touching the data layer.
 */
export type Kg = { graph: Graph; meta: KgMeta; layout: 'authored' | 'computed' }

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
 * So a graph that carries no positions is laid out here, once, and the fact is recorded on
 * `kg.layout` so the page can say which of the two it is showing. Authored positions are
 * left alone — they are an editorial decision (rings, clusters), not noise to be optimised
 * away. A half-placed graph keeps what was given and refines the whole thing.
 */
export function ensurePositions(kg: Kg): 'authored' | 'computed' {
  const g = kg.graph
  const n = g.order
  if (n === 0) return 'authored'
  let given = 0
  g.forEachNode((_id, a) => {
    if (placed(a)) given += 1
  })
  if (given === n) return 'authored'

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
    graph.addNode(n.id, attrs)
  }

  // Colour is a rendering concern, so it is filled in here rather than demanded
  // from the document: meta.colors wins, everything else gets a stable hash.
  const palette: Record<string, string> = { ...(meta.colors ?? {}) }
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
    try {
      graph.addEdgeWithKey(`e${i++}`, e.from, e.to, attrs)
    } catch {
      // The document is data, not a promise: a rejected edge is skipped, not fatal.
    }
  }

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
