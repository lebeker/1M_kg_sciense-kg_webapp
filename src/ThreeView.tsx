import { useEffect, useRef, useState } from 'react'
import { type ForceGraphData, type ForceNode, toForceGraph } from './adapters/forceGraph'
import { type Halo, type Kg, edgeDash, edgePx, edgeShape } from './kg'

/**
 * The 3d-force-graph instance, as an open bag of chainable setters.
 *
 * It is typed this way on purpose: the library's surface differs between builds — 1.80 has no
 * `linkLineDash` at all — and calling a method that is not there threw away the whole view. Every
 * setter now goes through `set()`, which uses what this build has and says nothing about the rest.
 */
type Fg = {
  [method: string]: (...args: never[]) => unknown
}

/** Chainable, but only if this build has it. */
function set(api: Fg, method: string, value: unknown): Fg {
  const fn = api[method]
  if (typeof fn === 'function') (fn as unknown as (v: unknown) => void).call(api, value)
  return api
}

/** The minimum of three.js this file uses; the rest is the library's business. */
type ThreeMesh = { userData: Record<string, number> }
type ThreeApi = {
  Group: new () => { add: (o: unknown) => void; children: ThreeMesh[] }
  Mesh: new (geo: unknown, mat: unknown) => ThreeMesh
  SphereGeometry: new (r: number, a: number, b: number) => unknown
  MeshBasicMaterial: new (o: Record<string, unknown>) => unknown
  CanvasTexture: new (c: HTMLCanvasElement) => { anisotropy: number }
  Sprite: new (m: unknown) => { position: { set: (x: number, y: number, z: number) => void }; scale: { set: (x: number, y: number, z: number) => void } }
  SpriteMaterial: new (o: Record<string, unknown>) => unknown
}

type Props = {
  kg: Kg
  onSelect: (id: string | null) => void
  insetRight?: number
  /** Put this node in the middle of the view (see SigmaView). */
  focus?: { id: string; n: number } | null
  /** Nodes collapsed away in the 2D view stay collapsed here: one map, one reading. */
  hidden?: Set<string>
  /** What is collapsed inside a node, per kind — drawn here as a cloud with nodes in orbit. */
  halos?: Map<string, Halo[]>
  /** Whether those clouds are drawn at all — the same switch as the 2D rings. */
  halosOn?: boolean
  /** Relation words switched off in the legend: not drawn here either. */
  muted?: Set<string>
  /** Does a directed relation get a head by default? The graph decides. */
  arrows?: boolean
  /** Day or night: the scene is a canvas, and it does not inherit a stylesheet. */
  theme?: 'dark' | 'light'
  /** In 3D a name is a tooltip either way; `off` is the only state that changes anything. */
  labels?: 'on' | 'hover' | 'off'
  /** `xy` holds the document's placement (3D shows the 2D picture); `force` lets the simulation
   *  choose. The same switch the 2D view reads. */
  layout?: 'xy' | 'force'
  /** Multiplies every relation's width. The graph decides. */
  edgeScale?: number
}

/**
 * 3D view. `3d-force-graph` (and three with it) is imported dynamically, so the bundler puts it
 * in its own chunk and it is only fetched when this component is first rendered.
 */
export default function ThreeView({
  kg,
  onSelect,
  insetRight,
  focus,
  hidden,
  halos,
  halosOn = true,
  muted,
  arrows = false,
  edgeScale = 1,
  theme = 'dark',
  labels = 'hover',
  layout = 'force',
}: Props) {
  const host = useRef<HTMLDivElement | null>(null)
  const inst = useRef<Fg | null>(null)
  /** The objects handed to the 3D engine; it writes x/y/z back onto them in place. */
  const data = useRef<ForceGraphData | null>(null)
  /** Every cloud currently in the scene, so the tick can turn its nodes. */
  const clouds = useRef<{ children: ThreeMesh[] }[]>([])
  /** Whether the engine came up: the element says so, so a test does not have to guess. */
  const [ready, setReady] = useState(false)
  const [drawn, setDrawn] = useState(0)
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect
  const observers = useRef<ResizeObserver | null>(null)
  const halosRef = useRef<Map<string, Halo[]>>(new Map())
  const halosOnRef = useRef<boolean>(true)
  halosRef.current = halos ?? new Map()
  halosOnRef.current = halosOn

  useEffect(() => {
    const el = host.current
    if (!el) return
    let dead = false

    Promise.all([import('3d-force-graph'), import('three')])
      .then(([mod, threeMod]) => {
        if (dead) return
        const THREE = threeMod as unknown as ThreeApi
/** A name, drawn once into a canvas and hung above the node as a sprite. */
const labelSprite = (text: string, color: string, dark: boolean) => {
  const dpr = 2
  const font = 26
  const pad = 6
  const measure = document.createElement('canvas').getContext('2d')
  if (measure) measure.font = `${font}px ui-sans-serif, system-ui, sans-serif`
  const width = Math.ceil(measure ? measure.measureText(text).width : text.length * font * 0.55) + pad * 2
  const height = font + pad * 2
  const canvas = document.createElement('canvas')
  canvas.width = width * dpr
  canvas.height = height * dpr
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.scale(dpr, dpr)
    ctx.font = `${font}px ui-sans-serif, system-ui, sans-serif`
    ctx.fillStyle = dark ? 'rgba(20, 22, 26, 0.62)' : 'rgba(250, 250, 248, 0.82)'
    ctx.beginPath()
    ctx.roundRect(0, 0, width, height, 8)
    ctx.fill()
    ctx.fillStyle = color
    ctx.textBaseline = 'middle'
    ctx.fillText(text, pad, height / 2)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.anisotropy = 2
  const sprite = new THREE.Sprite(
    // No attenuation: the name keeps the size it has in 2D, whatever the camera does. A label
    // that shrinks with distance is a label you cannot read at the zoom you actually use.
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, sizeAttenuation: false }),
  )
  // Unattenuated sprites are sized as a fraction of the viewport, not in graph units.
  const scale = 0.021
  sprite.scale.set((width / height) * scale, scale, 1)
  return sprite
}

        const ForceGraph3D = mod.default as unknown as (opts?: Record<string, unknown>) => (el: HTMLElement) => Fg
        const g = ForceGraph3D()(el)
        // Fresh objects, kept in a ref: the engine writes x/y/z back onto them in place, and
        // that is how "fly to this node" finds where it ended up.
        const fresh = toForceGraph(kg, hidden, muted, 60, layout === 'xy')
        data.current = fresh
        clouds.current = []

        /**
         * A node that has something collapsed inside it wears a cloud: one translucent sphere per
         * hidden kind in that kind's own colour, and a few small nodes turning on their own orbit
         * — each at its own radius and level, so the cloud reads as a place rather than a sticker.
         */
        const cloud = (node: ForceNode) => {
          const kinds = halosOnRef.current ? halosRef.current.get(node.id ?? '') : undefined
          // `labels: on` names the nodes here too: a 2D map with names and a 3D map without is
          // two different readings of the same document.
          if (labels !== 'on' && !kinds?.length) return undefined
          const group = new THREE.Group()
          if (labels === 'on') {
            const sprite = labelSprite(
              node.label ?? node.id ?? '',
              theme === 'light' ? '#1b1f27' : '#e6e8ec',
              theme !== 'light',
            )
            sprite.position.set(0, Math.max(4, Number(node.size) || 4) + 6, 0)
            group.add(sprite)
          }
          if (!kinds?.length) return group
          kinds.forEach((h, i) => {
            const r = 7 + i * 3.5 + Math.min(10, Math.sqrt(Math.max(0, h.mass)) * 1.6)
            group.add(
              new THREE.Mesh(
                new THREE.SphereGeometry(r, 16, 12),
                new THREE.MeshBasicMaterial({
                  color: h.color,
                  transparent: true,
                  opacity: 0.16,
                  depthWrite: false,
                }),
              ),
            )
            const dots = Math.min(6, Math.max(2, h.n))
            for (let d = 0; d < dots; d += 1) {
              const dot = new THREE.Mesh(
                new THREE.SphereGeometry(1.1, 8, 6),
                new THREE.MeshBasicMaterial({ color: h.color, transparent: true, opacity: 0.85 }),
              )
              dot.userData = {
                orbit: r + 2.5 + Math.random() * 3,
                phase: Math.random() * Math.PI * 2,
                speed: 0.004 + Math.random() * 0.006,
                lift: (Math.random() - 0.5) * r * 0.6,
              }
              group.add(dot)
            }
          })
          clouds.current.push(group)
          return group
        }

        set(g, 'width', el.clientWidth)
        set(g, 'height', el.clientHeight)
        set(g, 'backgroundColor', theme === 'light' ? '#f7f8fa' : '#14161a')
        set(g, 'nodeRelSize', 3)
        set(g, 'nodeLabel', (n: ForceNode) =>
          labels === 'off' ? '' : (n.label ?? n.id ?? ''),
        )
        set(g, 'nodeColor', (n: ForceNode) => n.color ?? (theme === 'light' ? '#4a7bc4' : '#7b9ecb'))
        // 3D sizes follow the same claim 2D draws, not the raw number: `px` is the radius the
        // document resolved to, and volume grows as a compressed power of it, so a hub reads as
        // bigger without a small node vanishing next to it.
        set(g, 'nodeVal', (n: ForceNode) => {
          // `size` arrives already resolved to a radius in pixels (from `weight`, or from the
          // document's own `size`). Volume grows as a compressed power of it, so the ordering is
          // the same as 2D and the extremes do not collapse into one blob.
          const v = Math.pow(Math.max(1, Number(n.size) || 4) / 3, 2.2)
          return Math.min(30, Math.max(0.5, v))
        })
        // The same reading as 2D, from the same document: width from `power`, colour from the
        // edge, a head only where a direction was asked for.
        set(g, 'linkWidth', (l: Record<string, unknown>) => edgePx(l, edgeScale))
        set(g, 'linkColor', (l: Record<string, unknown>) =>
          (l.color as string) ?? (theme === 'light' ? '#aab3c2' : '#525c6b'),
        )
        set(g, 'linkDirectionalArrowLength', (l: Record<string, unknown>) =>
          edgeShape(l, arrows) === 'line' ? 0 : 3,
        )
        // This build has no dashed line, so a weak relation is drawn the way a hairline reads
        // best in 3D: a couple of slow particles travelling along it.
        set(g, 'linkDirectionalParticles', (l: Record<string, unknown>) => (edgeDash(l) ? 3 : 0))
        set(g, 'linkDirectionalParticleWidth', () => 1.2)
        set(g, 'linkDirectionalParticleSpeed', () => 0.004)
        set(g, 'linkDirectionalParticleColor', (l: Record<string, unknown>) => (l.color as string) ?? '#8b96a8')
        set(g, 'nodeThreeObject', cloud)
        set(g, 'nodeThreeObjectExtend', true)
        set(g, 'onEngineTick', () => {
          clouds.current.forEach((group) => {
            group.children.forEach((child) => {
              const u = child.userData
              if (!u || typeof u.orbit !== 'number') return
              u.phase += u.speed
              const mesh = child as unknown as { position: { set: (x: number, y: number, z: number) => void } }
              mesh.position.set(Math.cos(u.phase) * u.orbit, u.lift, Math.sin(u.phase) * u.orbit)
            })
          })
        })
        set(g, 'onNodeClick', (n: ForceNode) => selectRef.current(n.id ?? null))
        set(g, 'onEngineStop', () => {
          // In x/y mode the camera is framed by hand below; letting the library fit a graph whose
          // positions have not been applied yet puts the camera inside the first node.
          if (layout !== 'xy') set(g, 'zoomToFit', undefined)
        })
        // Held in place, the simulation has nothing to do: stop it after the first frame, so the
        // picture stays the document's and the camera can go straight to it.
        set(g, 'cooldownTicks', layout === 'xy' ? 0 : Infinity)
        set(g, 'graphData', fresh)
        if (layout === 'xy') {
          // No simulation means no `onEngineStop`, so nothing would frame the picture: put the
          // camera in front of the plane at the distance the graph is wide, which is how 2D
          // draws it. Two frames in, because the renderer applies positions on its first pass
          // and a camera placed before that is a camera placed at the origin.
          const xs = fresh.nodes.map((n) => n.x ?? 0)
          const ys = fresh.nodes.map((n) => n.y ?? 0)
          const cx = (Math.min(...xs) + Math.max(...xs)) / 2
          const cy = (Math.min(...ys) + Math.max(...ys)) / 2
          const span = Math.max(
            Math.max(...xs) - Math.min(...xs),
            Math.max(...ys) - Math.min(...ys),
            80,
          )
          const place = () => {
            ;(g as unknown as {
              cameraPosition: (
                p: { x: number; y: number; z: number },
                look?: { x: number; y: number; z: number },
                ms?: number,
              ) => void
            }).cameraPosition({ x: cx, y: cy, z: span * 1.25 }, { x: cx, y: cy, z: 0 }, 0)
          }
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              // In front of the plane first, then let the library measure what is actually on
              // screen: a hand-computed distance guesses at the camera's field of view and the
              // canvas aspect, and guesses wrong on a wide window.
              place()
              window.setTimeout(() => set(g, 'zoomToFit', undefined), 60)
            }),
          )
        }
        inst.current = g
        // Debug handle, the same deal as `__sigma__`: a viewer that cannot be inspected cannot be
        // tested from the outside.
        ;(window as unknown as { __kgThree?: unknown }).__kgThree = g

        // 3d-force-graph measures itself when it is told to, once — and at mount this element has
        // not been laid out yet, so it starts at zero size and draws nothing. The same observer
        // the 2D view uses keeps it honest, and the first real size is the moment to fit.
        const ro = new ResizeObserver(() => {
          if (dead || !host.current) return
          set(g, 'width', host.current.clientWidth)
          set(g, 'height', host.current.clientHeight)
        })
        ro.observe(el)
        observers.current = ro
        setReady(true)
        setDrawn(fresh.nodes.length)
      })
      .catch((err: unknown) => {
        console.error('3d-force-graph failed to load:', err)
      })

    return () => {
      dead = true
      observers.current?.disconnect()
      observers.current = null
      const api = inst.current
      if (api && typeof api._destructor === 'function') (api._destructor as () => void).call(api)
      inst.current = null
      data.current = null
      clouds.current = []
    }
  }, [kg, hidden, halos, halosOn, muted, arrows, edgeScale, theme, labels, layout])

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
    const camera = g.cameraPosition as unknown as (a: typeof pos, b: typeof pos, ms: number) => void
    camera.call(g, { x: pos.x * k, y: pos.y * k, z: pos.z * k }, pos, 700)
  }, [focus])

  // The panel narrows the renderer while this view is up, and 3d-force-graph only measures
  // itself once — so it is told the new size, the same way the 2D view is refitted.
  useEffect(() => {
    const el = host.current
    const g = inst.current
    if (!el || !g) return
    set(g, 'width', el.clientWidth)
    set(g, 'height', el.clientHeight)
  }, [insetRight])

  return (
    <div
      className="canvas"
      ref={host}
      data-3d={ready ? 'up' : 'loading'}
      data-3d-nodes={drawn}
      style={insetRight ? { width: `calc(100% - ${insetRight}px)` } : undefined}
    />
  )
}
