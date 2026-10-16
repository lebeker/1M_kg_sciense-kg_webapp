import { useEffect, useRef } from 'react'
import { type ForceGraphData, type ForceLink, type ForceNode, toForceGraph } from './adapters/forceGraph'
import type { Kg } from './kg'

// Minimal shape of the 3d-force-graph instance we actually use. The published
// typings describe `new ForceGraph3D(el)`, but the runtime export is a kapsule
// component whose documented form is `ForceGraph3D()(el)` — so the module is
// cast once, here, instead of typing every chainable setter.
type FgInstance = {
  width: (w: number) => FgInstance
  height: (h: number) => FgInstance
  backgroundColor: (c: string) => FgInstance
  nodeRelSize: (v: number) => FgInstance
  nodeLabel: (f: (n: ForceNode) => string) => FgInstance
  nodeColor: (f: (n: ForceNode) => string) => FgInstance
  nodeVal: (f: (n: ForceNode) => number) => FgInstance
  linkWidth: (f: (l: ForceLink) => number) => FgInstance
  linkDirectionalArrowLength: (f: (l: ForceLink) => number) => FgInstance
  cameraPosition: (
    pos: { x: number; y: number; z: number },
    lookAt?: { x: number; y: number; z: number },
    ms?: number,
  ) => FgInstance
  onNodeClick: (f: (n: ForceNode) => void) => FgInstance
  onEngineStop: (f: () => void) => FgInstance
  zoomToFit: (ms?: number, padding?: number) => FgInstance
  graphData: (d: unknown) => FgInstance
  _destructor: () => void
}

type Factory = (el: HTMLElement) => FgInstance
type Component = (options?: Record<string, unknown>) => Factory

type Props = {
  kg: Kg
  onSelect: (id: string | null) => void
  insetRight?: number
  /** Put this node in the middle of the view (see SigmaView). */
  focus?: { id: string; n: number } | null
}

/**
 * 3D view. `3d-force-graph` (and three with it) is imported dynamically, so the
 * bundler puts it in its own chunk and it is only fetched when this component
 * is first rendered.
 */
export default function ThreeView({ kg, onSelect, insetRight, focus }: Props) {
  const host = useRef<HTMLDivElement | null>(null)
  const inst = useRef<FgInstance | null>(null)
  /** The objects handed to the 3D engine; it writes x/y/z back onto them in place. */
  const data = useRef<ForceGraphData | null>(null)
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect

  useEffect(() => {
    const el = host.current
    if (!el) return
    let dead = false

    import('3d-force-graph')
      .then((mod) => {
        if (dead) return
        const ForceGraph3D = mod.default as unknown as Component
        const g = ForceGraph3D()(el)
        // Fresh objects, kept in a ref: the engine writes x/y/z back onto them in place, and
        // that is how "fly to this node" finds where it ended up.
        const fresh = toForceGraph(kg)
        data.current = fresh
        g.width(el.clientWidth)
          .height(el.clientHeight)
          .backgroundColor('#14161a')
          .nodeRelSize(3)
          .nodeLabel((n) => n.label ?? n.id ?? '')
          .nodeColor((n) => n.color ?? '#7b9ecb')
          .nodeVal((n) => n.size ?? 2)
          // Power as line width, and an arrowhead only where the relation has a direction.
          .linkWidth((l) => Math.min(6, Math.max(0.35, 1.4 * (l.power ?? 1))))
          .linkDirectionalArrowLength((l) => (l.dir ? 3 : 0))
          .onNodeClick((n) => selectRef.current(n.id ?? null))
          .onEngineStop(() => g.zoomToFit(600, 40))
          .graphData(fresh)
        inst.current = g
      })
      .catch((err: unknown) => {
        console.error('3d-force-graph failed to load:', err)
      })

    return () => {
      dead = true
      inst.current?._destructor?.()
      inst.current = null
      data.current = null
    }
  }, [kg])

  // Follow a connection in 3D: park the camera along the line from the origin to the node, the
  // standard way to look at one thing without losing where it is.
  useEffect(() => {
    const g = inst.current
    const d = data.current
    if (!g || !d || !focus) return
    const n = d.nodes.find((x) => x.id === focus.id)
    if (!n || n.x === undefined || n.y === undefined) return
    const pos = { x: n.x, y: n.y, z: n.z ?? 0 }
    const len = Math.hypot(pos.x, pos.y, pos.z) || 1
    const k = 1 + 220 / len
    g.cameraPosition({ x: pos.x * k, y: pos.y * k, z: pos.z * k }, pos, 700)
  }, [focus])

  // The panel narrows the renderer while this view is up, and 3d-force-graph only measures
  // itself once — so it is told the new size, the same way the 2D view is refitted.
  useEffect(() => {
    const el = host.current
    const g = inst.current
    if (!el || !g) return
    g.width(el.clientWidth).height(el.clientHeight)
  }, [insetRight])

  return (
    <div
      className="canvas"
      ref={host}
      style={insetRight ? { width: `calc(100% - ${insetRight}px)` } : undefined}
    />
  )
}
