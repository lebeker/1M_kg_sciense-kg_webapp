import { useEffect, useRef } from 'react'
import { toForceGraph } from './adapters/forceGraph'
import type { Kg } from './kg'

// Minimal shape of the 3d-force-graph instance we actually use. The published
// typings describe `new ForceGraph3D(el)`, but the runtime export is a kapsule
// component whose documented form is `ForceGraph3D()(el)` — so the module is
// cast once, here, instead of typing every chainable setter.
type ForceNode = { id?: string; label?: string; color?: string; size?: number }

type FgInstance = {
  width: (w: number) => FgInstance
  height: (h: number) => FgInstance
  backgroundColor: (c: string) => FgInstance
  nodeRelSize: (v: number) => FgInstance
  nodeLabel: (f: (n: ForceNode) => string) => FgInstance
  nodeColor: (f: (n: ForceNode) => string) => FgInstance
  nodeVal: (f: (n: ForceNode) => number) => FgInstance
  onNodeClick: (f: (n: ForceNode) => void) => FgInstance
  onEngineStop: (f: () => void) => FgInstance
  zoomToFit: (ms?: number, padding?: number) => FgInstance
  graphData: (d: unknown) => FgInstance
  _destructor: () => void
}

type Factory = (el: HTMLElement) => FgInstance
type Component = (options?: Record<string, unknown>) => Factory

type Props = { kg: Kg; onSelect: (id: string | null) => void; insetRight?: number }

/**
 * 3D view. `3d-force-graph` (and three with it) is imported dynamically, so the
 * bundler puts it in its own chunk and it is only fetched when this component
 * is first rendered.
 */
export default function ThreeView({ kg, onSelect, insetRight }: Props) {
  const host = useRef<HTMLDivElement | null>(null)
  const inst = useRef<FgInstance | null>(null)
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
        g.width(el.clientWidth)
          .height(el.clientHeight)
          .backgroundColor('#14161a')
          .nodeRelSize(3)
          .nodeLabel((n) => n.label ?? n.id ?? '')
          .nodeColor((n) => n.color ?? '#7b9ecb')
          .nodeVal((n) => n.size ?? 2)
          .onNodeClick((n) => selectRef.current(n.id ?? null))
          .onEngineStop(() => g.zoomToFit(600, 40))
          .graphData(toForceGraph(kg))
        inst.current = g
      })
      .catch((err: unknown) => {
        console.error('3d-force-graph failed to load:', err)
      })

    return () => {
      dead = true
      inst.current?._destructor?.()
      inst.current = null
    }
  }, [kg])

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
