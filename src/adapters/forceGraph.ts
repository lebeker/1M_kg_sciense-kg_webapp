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
 * `z` carries hierarchy when the document has `level` (top level nearest the camera).
 * A graph with no levels at all still has a vertical reading: `weight` — how much a thing
 * counts on this map — normalised to the span the picture already has, so depth is a tilt of
 * the same map and not a spike beside it. That is gravity, without inventing a hierarchy.
 */
export function toForceGraph(
  kg: Kg,
  hidden?: Set<string>,
  muted?: Set<string>,
  zScale = 60,
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
  let wMin = Infinity
  let wMax = -Infinity
  let xMin = Infinity
  let xMax = -Infinity
  let yMin = Infinity
  let yMax = -Infinity
  kg.graph.forEachNode((id, a) => {
    if (skip.has(id)) return
    if (typeof a.level === 'number') anyLevel = true
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
    const z = typeof a.level === 'number'
      ? -a.level * zScale
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
    // Weight fixes the depth only where there is no hierarchy to read: the force layout keeps
    // arranging x and y, and the node keeps its own height instead of drifting in z.
    if (!anyLevel && depth > 0) node.fz = z
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
