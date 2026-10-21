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
 * `z` carries hierarchy when the document has `level` (top level nearest the
 * camera); otherwise it is 0 and the force layout arranges depth itself.
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
  kg.graph.forEachNode((id, a) => {
    if (skip.has(id)) return
    const node: ForceNode = {
      id,
      label: typeof a.label === 'string' ? a.label : id,
      kind: typeof a.kind === 'string' ? a.kind : 'unknown',
      color: typeof a.color === 'string' ? a.color : '#7b9ecb',
      size: typeof a.px === 'number' ? a.px : typeof a.size === 'number' ? a.size : 2,
      z: typeof a.level === 'number' ? -a.level * zScale : 0,
    }
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
