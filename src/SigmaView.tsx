import { useEffect, useMemo, useRef, useState } from 'react'
import Sigma from 'sigma'
import type Graph from 'graphology'
import {
  EdgeClampedProgram,
  EdgeDoubleArrowProgram,
  EdgeRectangleProgram,
  EdgeTriangleProgram,
  createEdgeArrowProgram,
} from 'sigma/rendering'
import { type Halo, type Kg, edgeDash, edgePx, edgeShape, pxSize, relationOf } from './kg'

type Props = {
  kg: Kg
  /** The whole document: nodes the reader collapsed are hidden here, not removed, so collapsing
   * never moves anything and expanding puts it back exactly where it was. */
  graph: Graph
  selected: string | null
  onSelect: (id: string | null) => void
  fitSignal: number
  /** How much of the right-hand side the panel covers, in px. The graph is fitted into what is
   * left of it, which is the whole point: opening a node must not hide the other nodes. */
  insetRight?: number
  /** Put this node in the middle of the view. `n` changes on every request, so following the
   * same node twice still moves the camera. */
  focus?: { id: string; n: number } | null
  /** A relation the reader is pointing at in the panel: drawn emphasised, over the top. */
  hoverEdge?: string | null
  /** What is hidden around a node -> one entry per kind, for one ring each. */
  halos?: Map<string, Halo[]>
  /** Whether those rings are drawn at all. A reader who does not care about them can turn them off. */
  halosOn?: boolean
  /** Bumped when edges were invented or withdrawn without the document changing. */
  graphVersion?: number
  /** Relation words this view is asked not to draw. */
  muted?: Set<string>
  /** Nodes the reader (or the measured budget) has collapsed away. */
  hidden?: Set<string>
  /** Does a directed relation get a head by default? The graph decides; this is that decision. */
  arrows?: boolean
  /** Multiplies every relation's width. The graph decides; this is that decision. */
  edgeScale?: number
  /** Measure this host before drawing: how many nodes it can hold at 30fps. */
  calibrating?: boolean
  onMeasured?: (nodes: number) => void
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

/** The shapes a document can name, so a new word is a data edit rather than a code change. */
const SHAPES: Record<string, unknown> = {
  arrow: createEdgeArrowProgram({ lengthToThicknessRatio: 4.5, widenessToThicknessRatio: 3.4 }),
  double: EdgeDoubleArrowProgram,
  clamped: EdgeClampedProgram,
  rectangle: EdgeRectangleProgram,
  triangle: EdgeTriangleProgram,
}

/** The ramp the calibration walks: node counts it shows, and holds, for a few frames each. */
const RAMP = [200, 400, 800, 1500, 2500, 4000, 6000, 9000, 13000, 18000, 25000]

export default function SigmaView({
  kg,
  graph,
  selected,
  onSelect,
  fitSignal,
  insetRight,
  focus,
  hoverEdge,
  halos,
  halosOn = true,
  graphVersion,
  hidden,
  muted,
  arrows = false,
  edgeScale = 1,
  calibrating = false,
  onMeasured,
}: Props) {
  const host = useRef<HTMLDivElement | null>(null)
  const sigma = useRef<Sigma | null>(null)
  const selRef = useRef<string | null>(selected)
  const selectRef = useRef(onSelect)
  const hoverRef = useRef<string | null>(null)
  const mutedRef = useRef<Set<string>>(new Set())
  const halosRef = useRef<Map<string, Halo[]>>(new Map())
  const halosOnRef = useRef<boolean>(true)
  const hiddenRef = useRef<Set<string>>(new Set())
  const calRef = useRef<Set<string>>(new Set())
  const drawRef = useRef<() => void>(() => {})
  const [progress, setProgress] = useState<string | null>(null)
  selRef.current = selected
  selectRef.current = onSelect
  hoverRef.current = hoverEdge ?? null
  mutedRef.current = muted ?? new Set()
  halosRef.current = halos ?? new Map()
  halosOnRef.current = halosOn !== false
  hiddenRef.current = hidden ?? new Set()

  // Fit, then back off a little: sigma's reset fits node centres, so a big circle or a
  // label at the edge of the frame ends up half outside it.
  // The first frame is the final one: an animated reset means every reload passes through a
  // different in-between state, and a reader refreshing the page sees the map rotate and some
  // labels and hairlines come and go. A fit someone presses stays animated; a fit on load is
  // instant.
  const fitCamera = (cam: ReturnType<Sigma['getCamera']>, animate = false) => {
    const back = () => {
      const state = cam.getState()
      cam.setState({ ...state, ratio: state.ratio * 1.15 })
    }
    // Duration 0 on load: the same end state, reached without a visible zoom that a refresh can
    // catch halfway. A press of "fit" keeps the ease because the reader asked to watch it.
    cam.animatedReset({ duration: animate ? 320 : 0 }).then(back).catch(() => {})
  }

  useEffect(() => {
    const el = host.current
    if (!el) return
    // A five-node graph should show its five labels; a thousand-node one cannot. The
    // threshold is a property of the graph, not a taste, so it is derived from it: up to
    // about a hundred nodes every label fits and every label is the point; past that,
    // weight decides which ones earn the space.
    const small = graph.order <= 100
    const instance = new Sigma(graph, el, {
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
      edgeReducer: (edge, data) => {
        const a = kg.graph.hasEdge(edge)
          ? (kg.graph.getEdgeAttributes(edge) as Record<string, unknown>)
          : {}
        // Muted globaly, from the legend: a texture relation like a co-citation is a fact about
        // the corpus, and left in it makes every paper it touches look central.
        if (mutedRef.current.has(relationOf(a))) return { ...data, hidden: true }
        // What a relation *looks* like is a property of the relation, said in the document:
        // `style: "dotted arrow"` gives both, and nothing here changes for a new word.
        const type = edgeShape(a, arrows)
        // Dashes cannot be drawn by the GL programs sigma ships, so a dashed relation is drawn
        // by the overlay instead and must not also be drawn solid underneath it.
        if (edgeDash(a) && hoverRef.current !== edge) return { ...data, hidden: true }
        return { ...data, type, size: edgePx(a, edgeScale) }
      },
      nodeReducer: (node, data) => {
        // Collapsed away: still in the graph, not drawn, and not labelable either.
        if (hiddenRef.current.has(node) || calRef.current.has(node)) {
          return { ...data, hidden: true, label: '' }
        }
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
    // is worse than no arrow at all, so this viewer registers a head worth seeing — along with
    // the other shapes a document may name by hand, which sigma does not register at all.
    const reg = instance as unknown as { registerEdgeProgram: (t: string, p: unknown) => void }
    for (const [name, program] of Object.entries(SHAPES)) reg.registerEdgeProgram(name, program)
    fitCamera(instance.getCamera())

    // ── the overlay ────────────────────────────────────────────────────────────────────────
    // What the GL pipeline cannot do, drawn in 2D on top of it: dashes and dots (any pattern,
    // any colour), a ring around a node whose neighbours are collapsed inside it, and the
    // relation the reader is pointing at.
    const canvas = document.createElement('canvas')
    canvas.className = 'overlay'
    el.appendChild(canvas)
    const ctx = canvas.getContext('2d')

    const sizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1
      const w = el.clientWidth
      const h = el.clientHeight
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }

    const draw = () => {
      if (!ctx) return
      const dpr = window.devicePixelRatio || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr)
      const at = (x: number, y: number) => instance.graphToViewport({ x, y })
      const ratio = instance.getCamera().getState().ratio || 1
      // sigma's node shader draws `a_size / u_sizeRatio`, so a ring measured in the unscaled
      // space ends up inside the circle as soon as the reader zooms in.
      // The radius sigma actually paints. Its node shader sets gl_PointSize = a_size / u_sizeRatio,
      // which is a *diameter* in device pixels, so the radius is half that — the ring used to be
      // drawn at four times the node's radius and read as a second, bigger circle.
      const radius = (id: string) => {
        const d = instance.getNodeDisplayData(id) as { size?: number } | undefined
        return (d?.size ?? 4) / (2 * ratio)
      }
      // `hasNode` before anything else: a caller can hand over an id that is not on the map
      // (a collapse with no host, a stale selection), and asking the graph for its position
      // throws — inside an effect, which takes the whole page down with it.
      const visible = (id: string) =>
        !!id && kg.graph.hasNode(id) && !hiddenRef.current.has(id) && !calRef.current.has(id)
      const point = (id: string) => {
        const n = kg.graph.getNodeAttributes(id) as { x: number; y: number }
        return at(n.x, n.y)
      }

      // Relations the GL path is not drawing: dashed and dotted ones.
      kg.graph.forEachEdge((edge, a, source, target) => {
        const dash = edgeDash(a as Record<string, unknown>)
        if (!dash) return
        // Muted in the legend: the overlay draws what the GL pass does not, so it has to agree
        // with it about what is left out.
        if (mutedRef.current.has(relationOf(a as Record<string, unknown>))) return
        if (!visible(source) || !visible(target)) return
        const s = point(source)
        const t = point(target)
        const hovered = hoverRef.current === edge
        ctx.save()
        ctx.setLineDash(dash)
        ctx.lineCap = 'round'
        ctx.strokeStyle = hovered
          ? '#9dc0ff'
          : ((a as Record<string, unknown>).color as string) || 'rgba(96,106,124,0.75)'
        ctx.lineWidth = (edgePx(a as Record<string, unknown>, edgeScale) || 1) * (hovered ? 3 : 1)
        if (hovered) {
          ctx.shadowColor = 'rgba(120,170,255,0.9)'
          ctx.shadowBlur = 8
        }
        ctx.beginPath()
        ctx.moveTo(s.x, s.y)
        ctx.lineTo(t.x, t.y)
        ctx.stroke()
        ctx.restore()
      })

      // A relation the reader is pointing at in the panel: solid ones are drawn by GL, so this
      // goes over them rather than instead of them.
      const h = hoverRef.current
      if (h && kg.graph.hasEdge(h)) {
        const a = kg.graph.getEdgeAttributes(h) as Record<string, unknown>
        const [source, target] = kg.graph.extremities(h)
        if (!edgeDash(a) && visible(source) && visible(target)) {
          const s = point(source)
          const t = point(target)
          ctx.save()
          ctx.strokeStyle = '#9dc0ff'
          ctx.shadowColor = 'rgba(120,170,255,0.9)'
          ctx.shadowBlur = 9
          ctx.lineWidth = edgePx(a, edgeScale) + 2.2
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.moveTo(s.x, s.y)
          ctx.lineTo(t.x, t.y)
          ctx.stroke()
          ctx.restore()
        }
      }

      // Rings: a node with nodes collapsed inside it says how much is hidden, and collapsing a
      // small weak thing and a large strong one should not look the same.
      if (halosRef.current.size && halosOnRef.current) {
        halosRef.current.forEach((kinds, id) => {
          if (!visible(id)) return
          const p = point(id)
          const r0 = radius(id)
          // One ring per kind, in that kind's own colour, the heaviest closest to the node — so a
          // collapsed company and a collapsed researcher are told apart without reading anything.
          // The ring sits *just* outside the node: two line widths of air, then one ring per kind
          // spaced by its own width, so a ring never reads as a second, larger circle.
          kinds.forEach((h, i) => {
            const lw = 1.5 + Math.min(4, Math.sqrt(Math.max(0, h.mass)) * 0.7)
            ctx.save()
            ctx.strokeStyle = h.color
            ctx.globalAlpha = 0.75
            ctx.lineWidth = lw
            ctx.beginPath()
            ctx.arc(p.x, p.y, r0 + 2 * lw + i * (lw + 2), 0, Math.PI * 2)
            ctx.stroke()
            ctx.restore()
          })
        })
      }
    }
    drawRef.current = draw

    sizeCanvas()
    instance.on('afterRender', draw)
    const ro = new ResizeObserver(() => {
      sizeCanvas()
      instance.resize()
      draw()
    })
    ro.observe(el)

    sigma.current = instance
    return () => {
      ro.disconnect()
      canvas.remove()
      sigma.current = null
      drawRef.current = () => {}
      instance.kill()
    }
  }, [graph, kg, arrows, edgeScale])

  // selection only changes how nodes are drawn: refresh, never rebuild
  useEffect(() => {
    sigma.current?.refresh()
  }, [selected])

  // Collapsing a node, or pointing at a relation: a repaint, not a rebuild.
  useEffect(() => {
    sigma.current?.refresh()
    drawRef.current()
  }, [hidden, hoverEdge, halos, halosOn, graphVersion])

  // ── measuring this host ────────────────────────────────────────────────────────────────
  // The budget is what this machine can draw, so it is measured on this machine: the graph is
  // revealed in growing steps and the frame time is watched. That is what the loading screen
  // is — not a decoration, the measurement. A number written into the document would be a
  // claim about a computer the document has never met.
  useEffect(() => {
    const s = sigma.current
    if (!calibrating || !s || !onMeasured) return
    // Biggest first: if the ramp can only show part of the graph, it should show the part that
    // matters, and the reader watches the map build itself while it measures.
    const order = [...kg.graph.nodes()]
      .map((id) => ({ id, w: kg.graph.getNodeAttribute(id, 'weight') ?? 0 }))
      .sort((a, b) => b.w - a.w)
      .map((d) => d.id)
    const steps = RAMP.filter((n) => n <= kg.graph.order)
    if (!steps.length || steps[steps.length - 1] < kg.graph.order) steps.push(kg.graph.order)
    let step = 0
    let frames: number[] = []
    let last = performance.now()
    let raf = 0
    let done = false
    let lastGood = 0

    const show = (n: number) => {
      const count = Math.min(n, order.length)
      calRef.current = new Set(order.slice(count))
      s.refresh()
      return count
    }

    const tick = () => {
      if (done) return
      const now = performance.now()
      const dt = now - last
      last = now
      if (dt < 1000) frames.push(dt)
      if (frames.length >= 14) {
        const sorted = [...frames].sort((a, b) => a - b)
        const median = sorted[Math.floor(sorted.length / 2)]
        const shown = Math.min(steps[step], order.length)
        const held = median <= 33
        if (!held || step >= steps.length - 1) {
          // The last count that held — or, if even the first step did not, a floor rather than
          // zero: a budget of zero hides everything, which is a broken page, not a measurement.
          done = true
          calRef.current = new Set()
          s.refresh()
          setProgress(null)
          onMeasured(held ? shown : Math.max(50, Math.round(lastGood / 2) || 200))
          return
        }
        lastGood = shown
        frames = []
        step += 1
        const next = show(steps[step])
        setProgress(`${next} nodes · ${Math.round(1000 / median)} fps`)
      }
      raf = requestAnimationFrame(tick)
    }

    setProgress('measuring this machine…')
    const start = window.setTimeout(() => {
      show(steps[0])
      last = performance.now()
      raf = requestAnimationFrame(tick)
    }, 150)

    return () => {
      done = true
      window.clearTimeout(start)
      cancelAnimationFrame(raf)
      calRef.current = new Set()
      setProgress(null)
      s.refresh()
    }
  }, [calibrating, kg, onMeasured])

  // Re-fit when asked, and when the panel opens or closes — the renderer is narrower then, so
  // the graph must be fitted again rather than left half-hidden behind the panel.
  useEffect(() => {
    const s = sigma.current
    if (!s) return
    s.resize()
    fitCamera(s.getCamera(), fitSignal > 0)
  }, [fitSignal, insetRight])

  // Follow a connection: put that node in the middle. The canvas is already narrower than the
  // window while the panel is open, so centring on the canvas is centring in what can be seen.
  useEffect(() => {
    const s = sigma.current
    if (!s || !focus || !graph.hasNode(focus.id)) return
    const attrs = graph.getNodeAttributes(focus.id) as { x?: number; y?: number }
    if (typeof attrs.x !== 'number' || typeof attrs.y !== 'number') return
    const at = normalizer(graph)(attrs.x, attrs.y)
    const cam = s.getCamera()
    const state = cam.getState()
    // Zoomed far out a single node is a dot: come in far enough to see what was clicked, but
    // never push the camera back out of a view the reader already chose.
    const ratio = Math.min(state.ratio, 0.45)
    cam.animate({ ...state, x: at.x, y: at.y, ratio }, { duration: 450 })
  }, [focus, graph])

  // The layout is the picture: if two loads of the same document disagree here, the document is
  // the same and the drawing is not — which is exactly what "it rotates on refresh" means.
  const posHash = useMemo(() => {
    let h = 2166136261
    kg.graph.forEachNode((id, a) => {
      const x = Math.round((Number(a.x) || 0) * 10)
      const y = Math.round((Number(a.y) || 0) * 10)
      const text = `${id}:${x},${y};`
      for (let i = 0; i < text.length; i += 1) {
        h ^= text.charCodeAt(i)
        h = Math.imul(h, 16777619)
      }
    })
    return (h >>> 0).toString(36)
  }, [kg])

  return (
    <div
      className="canvas"
      ref={host}
      data-pos-hash={posHash}
      // What was actually drawn, on the element: a page that draws something different from what
      // it was asked to draw is hard to see from the outside, and this is how a test sees it.
      data-drawn={kg.graph.order - (hidden?.size ?? 0)}
      data-collapsed={hidden?.size ?? 0}
      // how many rings are on screen, not how many nodes wear them
      // how many rings are on screen, not how many nodes wear them — and none when they are off
      data-rings={halosOn === false ? 0 : [...(halos?.values() ?? [])].reduce((n, k) => n + k.length, 0)}
      data-halos={halosOn === false ? 'off' : 'on'}
      style={insetRight ? { width: `calc(100% - ${insetRight}px)` } : undefined}
    >
      {progress ? (
        <div className="measuring">
          <b>measuring this machine</b>
          <span>{progress}</span>
          <i>the graph is revealed as fast as this host can hold it</i>
        </div>
      ) : null}
    </div>
  )
}
