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
  /** How importance was measured for this graph. See KgWeight. */
  weight?: KgWeight
  /** Per-graph visual decisions, so taste is data and not a hardcode. See KgVisuals. */
  visuals?: KgVisuals
}

/**
 * How this graph wants to look. The app carries defaults; a document overrides them, which is
 * the difference between "the viewer draws arrows" and "this graph draws arrows".
 */
export type KgVisuals = {
  /** Draw a head on a directed relation by default. Off unless asked for. */
  arrows?: boolean
  /** Multiply every edge's width. */
  edge_width?: number
  /** Multiply every node's radius. */
  node_scale?: number
  /** Draw a ring around a node that has hidden nodes collapsed inside it. */
  halo?: boolean
  /** The most nodes this graph is known to be drawable at, on the host that measured it. */
  max_nodes?: number
  /** A note about the measurement, shown with the banner. */
  max_nodes_note?: string
}

/**
 * How node importance was measured. The document gets to say, because "who matters most in this
 * field" is a claim about the world, and a claim should travel with its method: weighting a map
 * by relevant papers and weighting it by grant money are different graphs of the same field.
 */
export type KgWeight = {
  /** What the numbers measure, in words: "relevant papers", "grant funding (USD)". */
  metric?: string
  /** kind -> what one unit of a node's connections is worth for that kind. */
  kind_multipliers?: Record<string, number>
  note?: string
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
  /**
   * An edge's power: how much this relation weighs, where 1 is a normal relation and a small
   * number is one that barely counts. It is a *display* multiplier, not a measurement — a count
   * (citations, co-citation hits) is a property of its own and is shown in the panel. `weight`
   * is read as a synonym so graphs written before `power` existed keep working.
   */
  power?: number
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

/**
 * Importance, when the document does not state it.
 *
 * The score is **half the sum of the powers of the edges touching a node** — one edge of power 1
 * counts 0.5 — times a multiplier for its kind, because a paper is a small element of a field
 * map and a concept is what the map is about. Both halves belong to the document: `meta.weight`
 * carries the metric and the multipliers, and `size` on a node overrides the result outright.
 * So "weigh this field by grant money instead of by papers" is a change of data.
 */
const DEFAULT_KIND_MULTIPLIERS: Record<string, number> = {
  publication: 0.1, paper: 0.1, article: 0.1,
  researcher: 1, scientist: 1, person: 1,
  lab: 3, institution: 3, company: 3,
  subject: 10, concept: 10,
}
/** px = SCALE * sqrt(score): a hundredfold score is a tenfold circle, not a hundredfold one. */
const WEIGHT_SCALE = 2.5
const WEIGHT_MIN_PX = 1.5
const WEIGHT_MAX_PX = 28

/** An edge's power: 1 is normal. This is how wide, and how faint, that makes it. */
export const POWER_DEFAULT = 1
const POWER_WEAK = 0.5
const POWER_WEAK_COLOR = 'rgba(82, 92, 107, 0.4)'

/** Edge width in px, clamped — the same numbers `edgePx` uses, shared with the overlay. */
export const EDGE_MIN_PX = 0.35
export const EDGE_MAX_PX = 6

const clamp = (lo: number, hi: number, v: number) => Math.min(hi, Math.max(lo, v))

/** What an edge says its power is, defaulting to 1 — `weight` is the older spelling. */
export function powerOf(attrs: Record<string, unknown>): number {
  const p = num(attrs.power) ?? num(attrs.weight)
  return p === undefined ? POWER_DEFAULT : p
}

/** The score in `weight` is abstract; sigma wants pixels. */
const pxFromWeight = (score: number) =>
  clamp(WEIGHT_MIN_PX, WEIGHT_MAX_PX, WEIGHT_SCALE * Math.sqrt(Math.max(0, score)))
/** A `size` written by hand is a weight too; this is the older, direct mapping. */
const pxFromSize = (s: number) => Math.min(30, 3 + s * 1.6)

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
 * What a node and an edge is worth on screen when the author did not say.
 *
 * A node's `weight` is the document's if it carries one, and otherwise half the sum of the
 * powers of its edges times the multiplier for its kind — so a map shows importance with no
 * editing, and a map that has *measured* importance shows that instead. `size` overrides both.
 * An edge's `power` becomes its width, and a relation below half power is drawn as a hairline at
 * low opacity, because "these two are barely related" should not look like "these two are the
 * same thing".
 */
function applyVisuals(g: Graph, meta: KgMeta): void {
  const multipliers = { ...DEFAULT_KIND_MULTIPLIERS, ...(meta.weight?.kind_multipliers ?? {}) }
  // Declaring a metric is a statement about the graph — "this is weighted by relevant papers" —
  // so it is what the drawing follows. Per-node `size` still wins in a graph that declares
  // nothing, which is how a hand-tuned map keeps its emphasis.
  const declared = meta.weight !== undefined && Object.keys(meta.weight).length > 0
  g.forEachNode((id, a) => {
    let sum = 0
    g.forEachEdge(id, (_key, e) => {
      sum += powerOf(e as Record<string, unknown>)
    })
    const authored = num(a.weight)
    const multipliersFor = num(multipliers[str(a.kind) ?? 'unknown'])
    const score = authored ?? 0.5 * sum * (multipliersFor ?? 1)
    g.setNodeAttribute(id, 'weight', Math.round(score * 1000) / 1000)
    g.setNodeAttribute(id, 'weight_from', authored === undefined ? 'connections' : 'document')
    const explicit = num(a.size)
    g.setNodeAttribute(
      id,
      'px',
      !declared && explicit !== undefined ? pxFromSize(explicit) : pxFromWeight(score),
    )
  })
  g.forEachEdge((key, a) => {
    const p = powerOf(a)
    g.setEdgeAttribute(key, 'power', p)
    // An edge with no colour of its own keeps the viewer's default; a weak relation is dimmed
    // so that texture stays texture.
    if (p < POWER_WEAK && typeof a.color !== 'string') {
      g.setEdgeAttribute(key, 'color', POWER_WEAK_COLOR)
    }
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

/**
 * What a relation looks like, said in the document.
 *
 * `style` is the edge's appearance, separate from what it means: the stroke (`solid`, `dashed`,
 * `dotted`) and the shape (`arrow`, `double`, `clamped`, `rectangle`, `triangle`), as
 * space-separated words — `"dotted arrow"` is a valid style and reads the way a person would say
 * it. Anything unrecognised is ignored rather than fatal: a graph from a future version still
 * draws, and the engine's `validate` is where an unknown word gets reported.
 *
 * `color` is the edge's own colour, `power` its emphasis (1 = an ordinary relation), and `dash`
 * an explicit pattern ("6 4") for when the three named strokes are not the one you want.
 */
const EDGE_STROKES: Record<string, number[]> = {
  solid: [],
  dashed: [6, 4],
  dotted: [1.5, 3],
}
const EDGE_SHAPES = new Set(['arrow', 'double', 'clamped', 'rectangle', 'triangle'])

function styleWords(v: unknown): string[] {
  return typeof v === 'string' ? v.toLowerCase().split(/[\s,]+/).filter(Boolean) : []
}

function dashPattern(v: unknown): number[] | undefined {
  if (Array.isArray(v)) {
    const nums = v.map((x) => num(x)).filter((x): x is number => x !== undefined)
    if (nums.length) return nums.length === 1 ? [nums[0], nums[0]] : nums
    return undefined
  }
  if (typeof v === 'string') {
    const nums = v.split(/[\s,]+/).map(Number).filter((x) => Number.isFinite(x) && x >= 0)
    if (nums.length) return nums.length === 1 ? [nums[0], nums[0]] : nums
  }
  return undefined
}

/** The dash to draw with, or none: the named stroke first, then the explicit pattern. */
export function edgeDash(a: Record<string, unknown>): number[] | undefined {
  const explicit = dashPattern(a.dash)
  if (explicit) return explicit
  for (const w of styleWords(a.style)) if (EDGE_STROKES[w]?.length) return EDGE_STROKES[w]
  return undefined
}

/** The shape to draw: a named one from the document, else the direction, else a plain line. */
export function edgeShape(a: Record<string, unknown>, arrows: boolean): string {
  for (const w of styleWords(a.style)) if (EDGE_SHAPES.has(w)) return w === 'double' ? 'double' : w
  if (!arrows) return 'line'
  if (a.dir === 'both') return 'double'
  if (a.dir === 'in' || a.dir === 'out') return 'arrow'
  return 'line'
}

/** sigma draws edges in pixels; `power` is emphasis and `width` beats it when stated. */
export function edgePx(a: Record<string, unknown>, scale = 1): number {
  const explicit = num(a.width)
  const px = explicit !== undefined ? explicit : 1.4 * powerOf(a) * scale
  return clamp(EDGE_MIN_PX, EDGE_MAX_PX, px)
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
      // `dir: out` means the arrow points at `from`, and a drawn edge can only point at its own
      // target — so the edge is stored reversed and the authored ends are kept beside it, which
      // is what the panel reads. Without this, `out` was a no-op.
      const out = str(e.dir) === 'out'
      if (out) {
        attrs.authored_from = e.from
        attrs.authored_to = e.to
      }
      graph.addEdgeWithKey(`e${i++}`, out ? e.to : e.from, out ? e.from : e.to, attrs)
    } catch {
      // The document is data, not a promise: a rejected edge is skipped, not fatal.
    }
  }

  // What things are worth before the layout runs, because the layout can be told to respect it:
  // node radius, edge width, and the weight every node's importance is recorded in.
  applyVisuals(graph, meta)

  const kg: Kg = { graph, meta, layout: 'authored' }
  kg.layout = ensurePositions(kg)
  return kg
}

/** sigma draws `size` in pixels; a document that set one by hand said "this weight". */
export function pxSize(raw: unknown): number {
  const s = num(raw) ?? 2
  return pxFromSize(s)
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

/**
 * The notes written beside the graph, inlined into the page by the engine — absent for a graph
 * that has none, and absent is fine: a note is optional, and a node without one is still a node.
 *
 * They are inlined rather than fetched because the page is opened over `file://`, where a
 * browser refuses to read a file next to it. Same reason the graph itself is inlined.
 */
export async function loadDocs(): Promise<Record<string, string>> {
  const el = document.getElementById('kg-docs')
  if (!el) return {}
  try {
    const v = JSON.parse(el.textContent || '{}') as unknown
    return v && typeof v === 'object' ? (v as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/** How much a node is worth, as the data layer resolved it — the mass a ring stands for. */
export function weightOf(kg: Kg, id: string): number {
  const a = kg.graph.getNodeAttributes(id) as { weight?: number; px?: number }
  if (typeof a.weight === 'number') return a.weight
  if (typeof a.px === 'number') return a.px
  return 1
}
