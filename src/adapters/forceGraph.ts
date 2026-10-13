import type { Kg } from '../kg'

/**
 * The 3d-force-graph shape. It is deliberately *not* graphology: 3d-force-graph
 * wants plain objects and mutates them in place.
 */
export type ForceNode = {
  id: string
  label: string
  kind: string
  color: string
  size: number
  x?: number
  y?: number
  z?: number
}

export type ForceLink = { source: string; target: string; label?: string }

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
export function toForceGraph(kg: Kg, zScale = 60): ForceGraphData {
  const nodes: ForceNode[] = []
  kg.graph.forEachNode((id, a) => {
    const node: ForceNode = {
      id,
      label: typeof a.label === 'string' ? a.label : id,
      kind: typeof a.kind === 'string' ? a.kind : 'unknown',
      color: typeof a.color === 'string' ? a.color : '#7b9ecb',
      size: typeof a.size === 'number' ? a.size : 2,
      z: typeof a.level === 'number' ? -a.level * zScale : 0,
    }
    if (typeof a.x === 'number') node.x = a.x
    if (typeof a.y === 'number') node.y = a.y
    nodes.push(node)
  })

  const links: ForceLink[] = []
  kg.graph.forEachEdge((_key, a, source, target) => {
    const link: ForceLink = { source, target }
    if (typeof a.label === 'string') link.label = a.label
    links.push(link)
  })

  return { nodes, links }
}
