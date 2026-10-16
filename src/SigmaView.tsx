import { useEffect, useRef } from 'react'
import Sigma from 'sigma'
import { createEdgeArrowProgram } from 'sigma/rendering'
import { type Kg, pxSize } from './kg'

type Props = {
  kg: Kg
  selected: string | null
  onSelect: (id: string | null) => void
  fitSignal: number
  /** How much of the right-hand side the panel covers, in px. The graph is fitted into what is
   * left of it, which is the whole point: opening a node must not hide the other nodes. */
  insetRight?: number
  /** Put this node in the middle of the view. `n` changes on every request, so following the
   * same node twice still moves the camera. */
  focus?: { id: string; n: number } | null
}

/**
 * Sigma works in a [0,1]² space: before rendering it maps every node through
 * `0.5 + (x - centre) / span`, where span is the longer side of the graph's extent (see
 * createNormalizationFunction in sigma/dist/normalization-*.js). The camera lives in that same
 * space, which is why setting it to a node's own coordinates sends the view into empty space.
 */
function normalizer(g: { forEachNode: (cb: (id: string, a: Record<string, unknown>) => void) => void }) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  g.forEachNode((_id, a) => {
    const x = a.x as number, y = a.y as number
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  })
  const span = Math.max(maxX - minX, maxY - minY) || 1
  const cx = (maxX + minX) / 2
  const cy = (maxY + minY) / 2
  return (x: number, y: number) => ({ x: 0.5 + (x - cx) / span, y: 0.5 + (y - cy) / span })
}

export default function SigmaView({ kg, selected, onSelect, fitSignal, insetRight, focus }: Props) {
  const host = useRef<HTMLDivElement | null>(null)
  const sigma = useRef<Sigma | null>(null)
  const selRef = useRef<string | null>(selected)
  const selectRef = useRef(onSelect)
  selRef.current = selected
  selectRef.current = onSelect

  // Fit, then back off a little: sigma's reset fits node centres, so a big circle or a
  // label at the edge of the frame ends up half outside it.
  const fitCamera = (cam: ReturnType<Sigma['getCamera']>) => {
    cam
      .animatedReset()
      .then(() => {
        const state = cam.getState()
        cam.setState({ ...state, ratio: state.ratio * 1.15 })
      })
      .catch(() => {})
  }

  useEffect(() => {
    const el = host.current
    if (!el) return
    // A five-node graph should show its five labels; a thousand-node one cannot. The
    // threshold is a property of the graph, not a taste, so it is derived from it: up to
    // about a hundred nodes every label fits and every label is the point; past that,
    // weight decides which ones earn the space.
    const small = kg.graph.order <= 100
    const instance = new Sigma(kg.graph, el, {
      renderEdgeLabels: false,
      // #2b3038 on a #14161a page is 1.1:1 — the relations were there but unreadable. A
      // field map whose lines cannot be seen is a scatter of dots.
      defaultEdgeColor: '#525c6b',
      labelColor: { color: '#c7ccd6' },
      labelSize: 12,
      labelRenderedSizeThreshold: small ? 0 : 7,
      labelDensity: small ? 1 : 0.5,
      minCameraRatio: 0.01,
      maxCameraRatio: 20,
      nodeReducer: (node, data) => {
        // Already in pixels: the data layer resolved `weight`/`size` once, for every renderer.
        data.size = typeof data.px === 'number' ? data.px : pxSize(data.size)
        const sel = selRef.current
        if (!sel || node === sel) return data
        // Dimmed, not shrunk: relative size is the reading, and hiding it while something is
        // selected throws away the thing the map is for.
        return { ...data, color: '#333842', label: '', size: Math.min(data.size, 24) }
      },
    })

    instance.on('clickNode', ({ node }) => selectRef.current(node))
    instance.on('clickStage', () => selectRef.current(null))
    // sigma's arrowhead is 2.5x the thickness of the line, so on an ordinary 1.4px relation it
    // is a triangle four pixels long: drawn, and invisible. A citation pointing the wrong way
    // is worse than no arrow at all, so this viewer registers a head worth seeing.
    ;(instance as unknown as { registerEdgeProgram: (t: string, p: unknown) => void })
      .registerEdgeProgram('arrow',
        createEdgeArrowProgram({ lengthToThicknessRatio: 4.5, widenessToThicknessRatio: 3.4 }))
    fitCamera(instance.getCamera())

    sigma.current = instance
    return () => {
      sigma.current = null
      instance.kill()
    }
  }, [kg])

  // selection only changes how nodes are drawn: refresh, never rebuild
  useEffect(() => {
    sigma.current?.refresh()
  }, [selected])

  // Re-fit when asked, and when the panel opens or closes — the renderer is narrower then, so
  // the graph must be fitted again rather than left half-hidden behind the panel.
  useEffect(() => {
    const s = sigma.current
    if (!s) return
    s.resize()
    fitCamera(s.getCamera())
  }, [fitSignal, insetRight])

  // Follow a connection: put that node in the middle. The canvas is already narrower than the
  // window while the panel is open, so centring on the canvas is centring in what can be seen.
  useEffect(() => {
    const s = sigma.current
    if (!s || !focus || !kg.graph.hasNode(focus.id)) return
    const attrs = kg.graph.getNodeAttributes(focus.id) as { x?: number; y?: number }
    if (typeof attrs.x !== 'number' || typeof attrs.y !== 'number') return
    const at = normalizer(kg.graph)(attrs.x, attrs.y)
    const cam = s.getCamera()
    const state = cam.getState()
    // Zoomed far out a single node is a dot: come in far enough to see what was clicked, but
    // never push the camera back out of a view the reader already chose.
    const ratio = Math.min(state.ratio, 0.45)
    cam.animate({ ...state, x: at.x, y: at.y, ratio }, { duration: 450 })
  }, [focus, kg])

  return (
    <div
      className="canvas"
      ref={host}
      style={insetRight ? { width: `calc(100% - ${insetRight}px)` } : undefined}
    />
  )
}
