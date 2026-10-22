import { type Kg, relationOf } from '../kg'

/**
 * The 3d-force-graph shape. It is deliberately *not* graphology: 3d-force-graph
 * wants plain objects and mutates them in place.
 */
export type ForceNode = {
  id: string
  label: string
  kind: string
  color: string
  /** Radius in pixels, already resolved from `weight`/`size` by the data layer. */
  size: number
  x?: number
  y?: number
  z?: number
  /** Fixed position: when set, the simulation may not move the node. */
  fx?: number
  fy?: number
  fz?: number
}

export type ForceLink = {
  /** The edge key in the document, so a view can highlight the line a reader is pointing at. */
  key?: string
  source: string
  target: string
  label?: string
  power: number
  dir?: string
  /** An explicit width in px, when the document states one instead of a power. */
  width?: number
  color?: string
  /** The dash pattern, when the relation's style is a broken or dotted stroke. */
  dash?: number[]
  /** The shape word, when the document names one (see kg.edgeShape). */
  shape?: string
}

export type ForceGraphData = { nodes: ForceNode[]; links: ForceLink[] }

/**
 * graphology (what sigma renders) -> {nodes, links} (what 3d-force-graph eats).
 *
 * Returns freshly built objects on every call on purpose: 3d-force-graph swaps
 * `source`/`target` strings for node references and writes x/y/z back onto the
 * nodes, so handing it the live graph would corrupt the shared data layer.
 *
 * Depth is a property of the document before it is a property of this adapter:
 *
 *   1. `z` on the node — the author placed it in space, and nothing here second-guesses that;
 *   2. `level` — the hierarchy read as a tilt: the shallowest level nearest the camera, the
 *      deepest furthest, across a span that follows the picture's own width. A fixed number of
 *      units per level (60, once) made a map 2,238 units wide 60 deep — a flat disc with an
 *      invisible dent;
 *   3. `weight` — gravity, only when the document said neither. How much a thing counts,
 *      normalised to the same span.
 */
export function toForceGraph(
  kg: Kg,
  hidden?: Set<string>,
  muted?: Set<string>,
  /** Hold every node where the document put it: the 3D view becomes the 2D picture, with `level`
   *  as depth. Without this the simulation is free to rearrange the graph, which is why the two
   *  views used to look like two different maps. */
  pin = false,
): ForceGraphData {
  const nodes: ForceNode[] = []
  const skip = hidden ?? new Set<string>()

  // One pass for the three numbers the depth needs: does anything carry a level, how wide the
  // picture already is, and what range the weights span. A depth axis longer than the drawing
  // is what makes a 3D view look like a mistake.
  let anyLevel = false
  let lMin = Infinity
  let lMax = -Infinity
  let wMin = Infinity
  let wMax = -Infinity
  let xMin = Infinity
  let xMax = -Infinity
  let yMin = Infinity
  let yMax = -Infinity
  kg.graph.forEachNode((id, a) => {
    if (skip.has(id)) return
    if (typeof a.level === 'number') {
      anyLevel = true
      if (a.level < lMin) lMin = a.level
      if (a.level > lMax) lMax = a.level
    }
    const w = typeof a.weight === 'number' ? a.weight : 0
    if (w < wMin) wMin = w
    if (w > wMax) wMax = w
    if (typeof a.x === 'number') {
      xMin = Math.min(xMin, a.x)
      xMax = Math.max(xMax, a.x)
    }
    if (typeof a.y === 'number') {
      yMin = Math.min(yMin, a.y)
      yMax = Math.max(yMax, a.y)
    }
  })
  const span = Math.max(xMax - xMin, yMax - yMin)
  const depth = Number.isFinite(span) && span > 0 ? span * 0.35 : 0
  const byWeight = (w: number) =>
    wMax > wMin ? (w - wMin) / (wMax - wMin) : 0.5

  kg.graph.forEachNode((id, a) => {
    if (skip.has(id)) return
    const w = typeof a.weight === 'number' ? a.weight : 0
    const z =
      typeof a.z === 'number' && Number.isFinite(a.z)
        ? a.z
        : anyLevel && typeof a.level === 'number'
          ? -(lMax > lMin ? (a.level - lMin) / (lMax - lMin) : 0) * depth
          : anyLevel || depth === 0
            ? 0
            : -(byWeight(w) - 0.5) * depth
    const node: ForceNode = {
      id,
      label: typeof a.label === 'string' ? a.label : id,
      kind: typeof a.kind === 'string' ? a.kind : 'unknown',
      color: typeof a.color === 'string' ? a.color : '#7b9ecb',
      size: typeof a.px === 'number' ? a.px : typeof a.size === 'number' ? a.size : 2,
      z,
    }
    // Depth is a reading, not a simulation result: the force layout still arranges x and y,
    // but a node keeps the height the document (or its level, or its weight) gave it.
    if (!pin) node.fz = z
    if (typeof a.x === 'number') node.x = a.x
    if (typeof a.y === 'number') node.y = a.y
    if (pin && typeof node.x === 'number' && typeof node.y === 'number') {
      node.fx = node.x
      node.fy = node.y
      node.fz = node.z
    }
    nodes.push(node)
  })

  const links: ForceLink[] = []
  kg.graph.forEachEdge((_key, a, source, target) => {
    if (skip.has(source) || skip.has(target)) return
    // A muted relation is not drawn in either view: muting is one decision, read by both.
    if (muted?.size && muted.has(relationOf(a as Record<string, unknown>))) return
    const link: ForceLink = {
      key: _key,
      source,
      target,
      power: typeof a.power === 'number' ? a.power : 1,
    }
    if (typeof a.label === 'string') link.label = a.label
    if (typeof a.dir === 'string') link.dir = a.dir
    if (typeof a.width === 'number') link.width = a.width
    if (typeof a.color === 'string') link.color = a.color
    if (typeof a.style === 'string') link.shape = a.style
    links.push(link)
  })

  return { nodes, links }
}
