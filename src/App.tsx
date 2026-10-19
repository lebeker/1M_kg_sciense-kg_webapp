import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type Halo,
  type Kg,
  kindColor,
  kindsOf,
  loadDocs,
  loadKg,
  mutedOf,
  relationOf,
  relationsOf,
  weightOf,
} from './kg'
import { type Absorbed, foldState } from './fold'
import SigmaView from './SigmaView'
import DocPanel from './DocPanel'
import { measureNote, readBudget, watchWork, writeBudget } from './capacity'
import './styles.css'

/** An eye and a crossed eye, drawn small: the switch for a relation or a kind. */
const eyeOn = (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.3">
    <path d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4S1.5 8 1.5 8Z" />
    <circle cx="8" cy="8" r="1.9" />
  </svg>
)
const eyeOff = (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.3">
    <path d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4S1.5 8 1.5 8Z" />
    <path d="M2.5 2.5 13.5 13.5" />
  </svg>
)

// Separate chunk: three + 3d-force-graph are only fetched when 3D is chosen.
const ThreeView = lazy(() => import('./ThreeView'))

type Hit = { id: string; label: string; kind: string }

/** One edge as the panel shows it: the relation, its power, and the node at the other end. */
type Conn = {
  /** A line this view invented by folding, not a relation in the document. */
  agg?: boolean
  key: string
  other: string
  label: string
  kind: string
  color: string
  rel: string
  power: number
  arrow: string
  extra: [string, unknown][]
}

/** A relation word and the connections that carry it: one foldable block in the panel. */
type Group = { rel: string; conns: Conn[]; hideable: boolean }

/** The width `.panel` covers on the right (styles.css), so the renderer can fit beside it. */
const PANEL_PX = 341

/** Above this many nodes the viewer calibrates this host before drawing, which is what the
 * loading screen is for: a number measured here, not guessed for a machine it never saw. */
const CALIBRATE_OVER = 600

/** The rows the panel lays out in its own order. Everything else a node carries is data. */
const LAID_OUT = new Set([
  'id', 'label', 'kind', 'level', 'size', 'parent', 'tags', 'link', 'desc', 'color',
  'style', 'x', 'y', 'doc', 'md',
  // Resolved by the data layer from the edges around the node, and shown in their own rows:
  // `weight` is what the node is worth, `px` is how big that turned out on screen.
  'weight', 'weight_from', 'px',
])

/** Edge rows the panel has its own place for; anything else an edge carries is a property. */
const EDGE_LAID_OUT = new Set([
  'from', 'to', 'label', 'dir', 'power', 'size', 'color', 'type', 'weight', 'time',
  'style', 'dash', 'width', 'authored_from', 'authored_to',
  // `agg` says the view invented this line; it is not a property of the relation.
  'agg',
])

const DOI = /^10\.\d{4,9}\/\S+$/
const URLISH = /^https?:\/\/\S+$/

/** A value as a cell: identifiers and URLs resolve, lists join, everything else is text. */
function renderValue(v: unknown) {
  if (Array.isArray(v)) return v.join(' · ')
  const s = String(v)
  if (DOI.test(s)) {
    return (
      <a className="doi" href={`https://doi.org/${s}`} target="_blank" rel="noreferrer">
        {s}
      </a>
    )
  }
  if (URLISH.test(s)) {
    return (
      <a href={s} target="_blank" rel="noreferrer">
        {s}
      </a>
    )
  }
  return s
}

export default function App() {
  const [kg, setKg] = useState<Kg | null>(null)
  const [docs, setDocs] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<'2d' | '3d'>('2d')
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [fit, setFit] = useState(0)
  /** Following a connection: which node to put in the middle of the view, and a counter so a
   * second click on the same node still moves the camera. */
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null)
  /** A relation the reader is pointing at in the panel — drawn emphasised on the canvas. */
  const [hoverEdge, setHoverEdge] = useState<string | null>(null)
  /** What the reader asked to fold away, in order. The picture is derived from this list and the
   * document, never stored: same list, same picture, every time. */
  /** How many layers are folded away at each node. A fold is a walk, one layer per click. */
  const [foldSteps, setFoldSteps] = useState<Map<string, number>>(new Map())
  /** Node kinds the reader switched off in the legend. They are folded, not filtered: their mass
   * has to go somewhere, and their relations are re-attached at their share. */
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set())
  /** Fold the whole map up to its top layer: the categories and nothing else. */
  const [foldAll, setFoldAll] = useState(false)
  /** Rings around a node that has nodes folded inside it. A map read for its shape does not need
   * them; a map read for what was put away does. The reader decides, in the top bar. */
  const [halosOn, setHalosOn] = useState(true)
  /** Nodes the *host budget* put away — a different mechanism with a different promise. */
  const [calHidden, setCalHidden] = useState<Set<string>>(new Set())
  const [calHosts, setCalHosts] = useState<Map<string, Set<string>>>(new Map())
  /** Edges this view invented by folding; taken away and rebuilt whenever a decision changes. */
  const aggRef = useRef<Set<string>>(new Set())
  /** Bumped whenever the drawn graph changes without the document changing. */
  const [graphVersion, setGraphVersion] = useState(0)
  /** Relation groups the panel has folded shut. */
  const [folded, setFolded] = useState<Set<string>>(new Set())
  /** Relation words the reader has switched off; the document may state a starting set. */
  const [muted, setMuted] = useState<Set<string>>(new Set())
  /** The node budget measured on this host, and whether the reader has insisted on more. */
  const [budget, setBudget] = useState<number | null>(null)
  const [overridden, setOverridden] = useState(false)
  const [doc, setDoc] = useState<string | null>(null)
  /** Whether this host's own record has been consulted yet. Measuring before checking would
   * throw away a number measured a minute ago in favour of measuring it again. */
  const [checked, setChecked] = useState(false)
  const asked = useRef(false)

  useEffect(() => {
    loadKg().then((k) => {
      setKg(k)
      // The graph may say what it wants drawn without; the legend starts there and the reader
      // may change it for the session.
      setMuted(mutedOf(k))
    })
    loadDocs().then(setDocs)
  }, [])

  const onSelect = useCallback((id: string | null) => setSelected(id), [])
  const onFollow = useCallback((id: string) => {
    setSelected(id)
    setFocus((prev) => ({ id, n: (prev?.n ?? 0) + 1 }))
  }, [])

  const kinds = useMemo(() => (kg ? kindsOf(kg) : []), [kg])
  /** Every relation word with its count, for the legend's switches. */
  const relations = useMemo(() => (kg ? relationsOf(kg) : []), [kg])

  const hits = useMemo<Hit[]>(() => {
    const needle = query.trim().toLowerCase()
    if (!kg || needle.length < 2) return []
    const out: Hit[] = []
    kg.graph.forEachNode((id, a) => {
      if (out.length >= 8) return
      const label = typeof a.label === 'string' ? a.label : id
      const kind = typeof a.kind === 'string' ? a.kind : ''
      if (`${label} ${id} ${kind}`.toLowerCase().includes(needle)) out.push({ id, label, kind })
    })
    return out
  }, [kg, query])

  const nodeAttrs = useMemo(() => {
    if (!kg || !selected || !kg.graph.hasNode(selected)) return null
    return kg.graph.getNodeAttributes(selected) as Record<string, unknown>
  }, [kg, selected])

  const stepList = useMemo(
    () =>
      [...foldSteps.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([id, n]) => ({ id, n })),
    [foldSteps],
  )
  /** The same decisions with one node's count replaced — a node with none is added, a zero removed. */
  const withStep = useCallback((list: { id: string; n: number }[], id: string, n: number) => {
    const rest = list.filter((s) => s.id !== id)
    return n > 0 ? [...rest, { id, n }].sort((a, b) => a.id.localeCompare(b.id)) : rest
  }, [])

  const sim = useMemo(
    () =>
      kg
        ? foldState(kg, { muted, steps: stepList, kinds: hiddenKinds, foldAll })
        : { hidden: new Set<string>(), absorbed: new Map(), virtual: [], stuck: new Set<string>() },
    [kg, muted, stepList, hiddenKinds, foldAll],
  )
  const hidden = useMemo(() => new Set<string>([...sim.hidden, ...calHidden]), [sim, calHidden])

  /** Everything the selected node is joined to, strongest first — the graph read as a list. */
  const connections = useMemo<Conn[]>(() => {
    if (!kg || !selected || !kg.graph.hasNode(selected)) return []
    const out: Conn[] = []
    kg.graph.forEachEdge(selected, (key, a, source, target) => {
      // A muted relation is not in the drawing, so it is not in the list either: the panel and
      // the picture have to be the same view of the graph, or one of them is lying.
      if (muted.has(relationOf(a as Record<string, unknown>))) return
      // A relation authored as `dir: out` is stored reversed so its arrow can point at what it
      // names; what the reader wrote is what the panel reads.
      const from = (a.authored_from as string) ?? source
      const to = (a.authored_to as string) ?? target
      const other = from === selected ? to : from
      const otherAttrs = kg.graph.getNodeAttributes(other) as Record<string, unknown>
      out.push({
        key,
        other,
        label: typeof otherAttrs.label === 'string' ? otherAttrs.label : other,
        kind: typeof otherAttrs.kind === 'string' ? otherAttrs.kind : '',
        color: typeof otherAttrs.color === 'string' ? otherAttrs.color : '#7b9ecb',
        rel: typeof a.label === 'string' ? a.label : '',
        power: typeof a.power === 'number' ? a.power : 1,
        arrow: to === selected ? '←' : '→',
        agg: !!(a as Record<string, unknown>).agg,
        extra: Object.entries(a as Record<string, unknown>).filter(
          ([k, v]) => !EDGE_LAID_OUT.has(k) && v !== undefined && v !== null,
        ) as [string, unknown][],
      })
    })
    // A row pointing at something folded away is not a connection the reader can act on: the
    // folded block above the list already accounts for it, by kind and in half-counts.
    return out.filter((c) => !hidden.has(c.other)).sort((x, y) => y.power - x.power)
    // graphVersion: a fold adds and withdraws lines without the document changing, and the panel
    // has to read the drawing, not the file.
  }, [kg, selected, graphVersion, muted, hidden])

  /** The same list, folded by relation word: what the panel shows a block at a time. */
  const groups = useMemo<Group[]>(() => {
    const by = new Map<string, Conn[]>()
    for (const c of connections) {
      const key = c.rel || 'related'
      const at = by.get(key)
      if (at) at.push(c)
      else by.set(key, [c])
    }
    return [...by.entries()].map(([rel, conns]) => ({ rel, conns, hideable: false }))
  }, [connections])

  /** What the numbers in `weight` measure, as the document itself states it. */
  const weightMetric = kg?.meta?.weight?.metric ?? 'connections'

  /** This graph is bigger than what this host was measured to draw: draw a part of it. */
  const declared = kg?.meta?.visuals?.max_nodes ?? null
  const budgetNow = budget ?? declared
  const overBudget = !!kg && budgetNow !== null && kg.graph.order > budgetNow && !overridden
  const calibrating = !!kg && kg.graph.order > CALIBRATE_OVER && budget === null && checked

  // What the panel does not lay out itself, in a stable order — derived from the node, so a
  // graph carrying a field this app has never heard of still shows it.
  const extraFields = useMemo<[string, unknown][]>(() => {
    if (!nodeAttrs) return []
    return Object.entries(nodeAttrs)
      .filter(([k, v]) => !LAID_OUT.has(k) && v != null && String(v).length > 0)
      .sort(([a], [b]) => a.localeCompare(b))
  }, [nodeAttrs])

  /** The document written beside a node, if there is one. */
  const nodeDocKey = useMemo(() => {
    const named = nodeAttrs?.doc ?? nodeAttrs?.md
    if (typeof named !== 'string') return null
    const bare = named.replace(/^docs\//, '').replace(/\.md$/, '')
    if (docs[named] !== undefined) return named
    if (docs[bare] !== undefined) return bare
    if (docs[`${bare}.md`] !== undefined) return `${bare}.md`
    return null
  }, [nodeAttrs, docs])

  const overview = useMemo(() => {
    // Keyed by their path in the graph's docs/ folder, so the subject's note is found by its
    // name rather than by a key the folder happened to choose.
    const keys = Object.keys(docs)
    const byName = (name: string) => keys.find((k) => k.split('/').pop() === name) ?? null
    return byName('overview.md') ?? byName('index.md')
  }, [docs])

  /**
   * The view the fold decisions produce. Recomputed from the document every time a decision
   * changes — nothing about the picture is stored, so it cannot drift from the decision.
   */
  /**
   * What is folded inside each node, broken down by kind: a ring per kind, in that kind's own
   * colour, so a folded company reads differently from a folded researcher without a legend.
   * Biggest mass first, because that is the ring drawn closest to the node.
   */
  const halos = useMemo(() => {
    const out = new Map<string, Halo[]>()
    const add = (host: string, kind: string, n: number, mass: number) => {
      const list = out.get(host) ?? []
      const at = list.find((h) => h.kind === kind)
      if (at) {
        at.n += n
        at.mass += mass
      } else list.push({ kind, n, mass, color: kg ? kindColor(kg, kind) : '#888' })
      out.set(host, list)
    }
    // Two mechanisms meet here: the reader's folds carry their own ledger, and the host budget
    // carries a set of nodes it put away. Both end up as a ring in a kind's colour.
    sim.absorbed.forEach((a: Absorbed, host: string) => {
      if (!kg) return
      // The *count* is a count of nodes, always an integer: half a scientist is how the mass is
      // shared, not a number of people. Mass still sizes the ring.
      const per = new Map<string, number>()
      a.items.forEach((item) => {
        if (!kg.graph.hasNode(item)) return
        const kind = (kg.graph.getNodeAttribute(item, 'kind') as string | undefined) ?? 'other'
        per.set(kind, (per.get(kind) ?? 0) + 1)
      })
      const total = [...per.values()].reduce((x, y) => x + y, 0) || 1
      per.forEach((n, kind) => add(host, kind, n, (a.mass * n) / total))
    })
    calHosts.forEach((kids, host) => {
      kids.forEach((k) => {
        if (!kg || !kg.graph.hasNode(k)) return
        const kind = (kg.graph.getNodeAttribute(k, 'kind') as string | undefined) ?? 'other'
        add(host, kind, 1, weightOf(kg, k))
      })
    })
    out.forEach((list, host) => out.set(host, [...list].sort((a, b) => b.mass - a.mass)))
    return out
  }, [sim, calHosts, kg])

  /**
   * What the button would do, before it is pressed. A fold that puts nothing away is not an
   * action, and a button that silently does nothing is a bug report waiting to happen.
   */
  const stepsOf = useCallback((id: string) => foldSteps.get(id) ?? 0, [foldSteps])

  const diffKinds = useCallback(
    (after: { hidden: Set<string> }, before: { hidden: Set<string> }) => {
      const byKind = new Map<string, number>()
      after.hidden.forEach((id) => {
        if (before.hidden.has(id)) return
        const kind = (kg?.graph.getNodeAttribute(id, 'kind') as string | undefined) ?? 'node'
        byKind.set(kind, (byKind.get(kind) ?? 0) + 1)
      })
      return byKind
    },
    [kg],
  )

  /** The next layer, as it would be if the fold button were pressed once. */
  const foldPreview = useMemo(() => {
    if (!kg || !selected || sim.hidden.has(selected)) return null
    const n = stepsOf(selected)
    const after = foldState(kg, {
      muted,
      steps: withStep(stepList, selected, n + 1),
      kinds: hiddenKinds,
      foldAll,
    })
    return { n: after.hidden.size - sim.hidden.size, byKind: diffKinds(after, sim) }
  }, [kg, muted, stepList, stepsOf, hiddenKinds, foldAll, selected, sim, diffKinds])

  /** The last layer folded at this node, as it would be if unfold were pressed once. */
  const unfoldPreview = useMemo(() => {
    if (!kg || !selected) return null
    const n = stepsOf(selected)
    if (n === 0) return null
    const before = foldState(kg, {
      muted,
      steps: withStep(stepList, selected, n - 1),
      kinds: hiddenKinds,
      foldAll,
    })
    return { n: sim.hidden.size - before.hidden.size, byKind: diffKinds(sim, before) }
  }, [kg, muted, stepList, stepsOf, hiddenKinds, foldAll, selected, sim, diffKinds])

  /** "2 nodes (1 paper, 1 scientist)" — the count alone made the second one look like a bug. */
  const say = useCallback((p: { n: number; byKind: Map<string, number> } | null) => {
    if (!p) return ''
    const parts = [...p.byKind.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([kind, n]) => `${n} ${kind}${n === 1 ? '' : 's'}`)
    return `${p.n} node${p.n === 1 ? '' : 's'}${parts.length ? ` (${parts.join(', ')})` : ''}`
  }, [])

  const fold = useCallback((id: string) => {
    setFoldSteps((prev) => {
      const next = new Map(prev)
      next.set(id, (next.get(id) ?? 0) + 1)
      return next
    })
    setSelected(id)
  }, [])

  /** One layer back, not the whole branch. */
  const unfold = useCallback((id: string) => {
    setFoldSteps((prev) => {
      const n = prev.get(id) ?? 0
      const next = new Map(prev)
      if (n <= 1) next.delete(id)
      else next.set(id, n - 1)
      return next
    })
  }, [])

  /** Bring back what is folded inside one node, without touching the rest of the map. */
  const showInside = useCallback((id: string) => {
    setFoldSteps((prev) => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.delete(id)
      return next
    })
    setCalHosts((prev) => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      const kids = next.get(id)
      if (kids) {
        setCalHidden((h) => {
          const out = new Set(h)
          kids.forEach((k) => out.delete(k))
          return out
        })
      }
      next.delete(id)
      return next
    })
  }, [])

  const revealAll = useCallback(() => {
    setFoldSteps(new Map())
    setFoldAll(false)
    setHiddenKinds(new Set())
    setCalHidden(new Set())
    setCalHosts(new Map())
  }, [])

  /** The edges a fold invents: rebuilt from scratch whenever a decision changes. */
  useEffect(() => {
    if (!kg) return
    aggRef.current.forEach((k) => {
      if (kg.graph.hasEdge(k)) kg.graph.dropEdge(k)
    })
    aggRef.current = new Set()
    sim.virtual.forEach((v, i) => {
      if (!kg.graph.hasNode(v.a) || !kg.graph.hasNode(v.b)) return
      const key = `fold:${i}:${v.a}--${v.b}`
      if (!kg.graph.hasEdge(key)) kg.graph.addEdgeWithKey(key, v.a, v.b, { agg: true, power: v.power, label: v.label })
      aggRef.current.add(key)
    })
    setGraphVersion((v) => v + 1)
  }, [kg, sim])

  // Selecting something folded away brings it back: a search result you cannot see is not a
  // result. Only on a *new* selection — folding the node that happens to be open must not undo
  // itself the instant it works.
  const lastSelected = useRef<string | null>(null)
  useEffect(() => {
    if (!selected || lastSelected.current === selected) return
    lastSelected.current = selected
    if (!hidden.has(selected)) return
    setFoldSteps(new Map())
    setCalHidden((h) => {
      if (!h.has(selected)) return h
      const out = new Set(h)
      out.delete(selected)
      return out
    })
  }, [selected, hidden])

  // The budget: measured on this host, remembered here, raised by use. A number written into a
  // document would be a guess about a machine it never saw.
  useEffect(() => {
    if (!kg || asked.current || kg.graph.order <= CALIBRATE_OVER) return
    asked.current = true
    const stored = readBudget(kg.meta.app ?? 'kg')
    if (stored !== null) setBudget(stored)
    setChecked(true)
  }, [kg])

  useEffect(() => {
    if (!kg || budget === null) return
    writeBudget(kg.meta.app ?? 'kg', budget)
  }, [kg, budget])

  // Collapsed by concept, before the reader ever sees it: a graph bigger than the budget is not
  // refused, it is drawn in part. The parts that go first are the members of a concept cluster —
  // nodes that exist on this map only because of one subject — smallest and weakest first, and
  // the concept they hang off wears a ring sized by the mass it is hiding. That is the difference
  // between a big graph and a broken one.
  const autoDone = useRef(false)
  useEffect(() => {
    if (!kg || !overBudget || autoDone.current) return
    autoDone.current = true
    const target = budgetNow ?? 0
    const concepts = new Set<string>()
    kg.graph.forEachNode((id, a) => {
      if (a.kind === 'subject' || a.kind === 'concept') concepts.add(id)
    })
    const weight = (id: string) => (kg.graph.getNodeAttribute(id, 'weight') as number) ?? 0
    // A member: not a concept itself, and nothing but concepts hold it on the map.
    const members: { id: string; host: string; w: number }[] = []
    kg.graph.forEachNode((id) => {
      if (concepts.has(id)) return
      const hosts: string[] = []
      let other = 0
      kg.graph.forEachNeighbor(id, (n) => {
        if (concepts.has(n)) hosts.push(n)
        else other += 1
      })
      if (hosts.length && other === 0) members.push({ id, host: hosts[0], w: weight(id) })
    })
    members.sort((a, b) => a.w - b.w)
    const hiddenNow = new Set<string>()
    const hosts = new Map<string, Set<string>>()
    // A node that is wearing a ring stays: it is the only thing left on the map that still
    // accounts for what it hides, and hiding it too would throw that away.
    const protectedNodes = new Set<string>()
    const put = (id: string, host: string | null) => {
      hiddenNow.add(id)
      if (host) protectedNodes.add(host)
      // A node can be hidden without a host: a whole concept cluster has nothing left on the
      // map to hang off, and inventing one would mean a ring around a node that is not there.
      if (!host) return
      const at = hosts.get(host) ?? new Set<string>()
      at.add(id)
      hosts.set(host, at)
    }
    // Pass one: members of concepts, weakest first, until the map fits.
    for (const m of members) {
      if (kg.graph.order - hiddenNow.size <= target) break
      if (protectedNodes.has(m.id)) continue
      put(m.id, m.host)
    }
    // Pass two: if that was not enough, whole concept clusters go — the concept with everything
    // that is only there because of it — and the count is what the banner is for.
    if (kg.graph.order - hiddenNow.size > target) {
      for (const c of concepts) {
        if (kg.graph.order - hiddenNow.size <= target) break
        if (hiddenNow.has(c) || protectedNodes.has(c)) continue
        put(c, null)
      }
    }
    // Pass three: the rest of the weakest. A node held by a single relation can go without the
    // map losing its shape — and on a big map that is most of what there is to hide.
    if (kg.graph.order - hiddenNow.size > target) {
      const loose: { id: string; w: number }[] = []
      kg.graph.forEachNode((id) => {
        if (hiddenNow.has(id) || concepts.has(id)) return
        if (kg.graph.degree(id) <= 1) loose.push({ id, w: weight(id) })
      })
      loose.sort((a, b) => a.w - b.w)
      for (const l of loose) {
        if (kg.graph.order - hiddenNow.size <= target) break
        if (hiddenNow.has(l.id) || protectedNodes.has(l.id)) continue
        // Asked now, not when the list was built: what holds a node is whoever is still on the
        // map at the moment it goes — otherwise the ring ends up on a node that is gone too.
        let hold: string | null = null
        kg.graph.forEachNeighbor(l.id, (n) => {
          if (!hiddenNow.has(n)) hold = n
        })
        put(l.id, hold)
      }
    }

    // A host that went away itself cannot wear a ring; its hidden mass belongs to the banner.
    for (const h of [...hosts.keys()]) if (hiddenNow.has(h)) hosts.delete(h)
    if (hiddenNow.size) {
      setCalHidden(hiddenNow)
      setCalHosts(hosts)
    }
    // The banner then says what happened, and 'show all' brings it back.
  }, [kg, overBudget, budgetNow, autoDone])

  // Selecting something collapsed away brings it back: a search result you cannot see is not a
  // result. (Kept above: the reveal is what makes the collapse safe to use.)

  // A measurement is a claim, and claims can be wrong in both directions: ten minutes of real
  // use at a size this host was not supposed to hold is evidence the claim was pessimistic, and
  // capacity.ts says what counts as use. A page left open with nobody there does not.
  useEffect(() => {
    if (!kg) return
    return watchWork(kg.meta.app ?? 'kg', overBudget, setBudget)
  }, [kg, overBudget])

  /** The document's edges. Lines a fold invented are a property of the view, not of the graph. */
  const docEdges = useMemo(() => {
    if (!kg) return 0
    let n = 0
    kg.graph.forEachEdge((_k, a) => {
      if (!(a as Record<string, unknown>).agg) n += 1
    })
    return n
  }, [kg, graphVersion])

  if (!kg) return <div className="app" />

  return (
    <div
      className="app"
      data-fold-ops={stepList.map((s) => `${s.id}:${s.n}`).join(",")}
      data-hidden={hidden.size}
      data-halos={halosOn ? 'on' : 'off'}
    >
      <header className="bar">
        <span className="title">{kg.meta.title ?? 'knowledge graph'}</span>
        <span className="count">
          {hidden.size > 0
            ? `${kg.graph.order - hidden.size} of ${kg.graph.order} nodes drawn · ${docEdges} edges`
            : `${kg.graph.order} nodes · ${docEdges} edges`}
          {kg.layout === 'computed'
            ? ' · layout computed here'
            : kg.layout === 'rings'
              ? ' · arranged by ring'
              : ''}
        </span>

        <input
          className="search"
          placeholder="search  /"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('')
          }}
        />

        <div className="spacer" />

        <button
          className={`icon${halosOn ? '' : ' off'}`}
          data-halos-toggle={halosOn ? 'on' : 'off'}
          aria-pressed={halosOn}
          title={
            halosOn
              ? 'rings: what is folded inside a node is drawn as an orbit around it'
              : 'rings off: a folded node is just a node'
          }
          onClick={() => setHalosOn((v) => !v)}
        >
          {/* an orbit: one body, one ring, one moon */}
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <circle cx="12" cy="12" r="3.2" fill="currentColor" />
            <ellipse
              cx="12"
              cy="12"
              rx="9"
              ry="4.4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              transform="rotate(-24 12 12)"
            />
            <circle cx="19.4" cy="8.2" r="1.5" fill="currentColor" />
          </svg>
        </button>

        {overview ? (
          <button onClick={() => setDoc(overview)} title="the notes written beside this graph">
            notes
          </button>
        ) : null}
        {foldSteps.size > 0 || hiddenKinds.size > 0 || calHosts.size > 0 || foldAll ? (
          <button onClick={revealAll}>show all</button>
        ) : null}
        <button onClick={() => setFit((n) => n + 1)}>fit</button>
        <div className="switch">
          <button className={mode === '2d' ? 'on' : ''} onClick={() => setMode('2d')}>
            2D
          </button>
          <button className={mode === '3d' ? 'on' : ''} onClick={() => setMode('3d')}>
            3D
          </button>
        </div>
      </header>

      {overBudget ? (
        <div className="banner">
          <b>
            {hidden.size > 0
              ? `${hidden.size} nodes are folded away`
              : 'this graph is larger than this host was measured to draw'}
          </b>
          <span>
            budget {budgetNow} nodes{measureNote() ? ` · measured ${measureNote()}` : ''} — the
            rest is here, it is just not drawn
          </span>
          {hidden.size > 0 ? (
            <button onClick={revealAll}>show all</button>
          ) : (
            <button onClick={() => setOverridden(true)}>expand anyway</button>
          )}
        </div>
      ) : null}

      {hits.length > 0 && (
        <ul className="hits">
          {hits.map((h) => (
            <li
              key={h.id}
              onClick={() => {
                setSelected(h.id)
                setQuery('')
              }}
            >
              <b>{h.label}</b> <i>{h.kind}</i>
            </li>
          ))}
        </ul>
      )}

      <div className="view">
        {kg.graph.order === 0 ? (
          <p className="empty">no graph in this page</p>
        ) : mode === '2d' ? (
          <SigmaView
            kg={kg}
            graph={kg.graph}
            selected={selected}
            onSelect={onSelect}
            fitSignal={fit}
            insetRight={selected ? PANEL_PX : 0}
            focus={focus}
            hoverEdge={hoverEdge}
            halos={halos}
            halosOn={halosOn}
            graphVersion={graphVersion}
            hidden={hidden}
            muted={muted}
            arrows={kg.meta?.visuals?.arrows ?? false}
            edgeScale={kg.meta?.visuals?.edge_width ?? 1}
            calibrating={calibrating}
            onMeasured={setBudget}
          />
        ) : (
          <Suspense fallback={<p className="empty">loading 3D…</p>}>
            <ThreeView
              kg={kg}
              onSelect={onSelect}
              halos={halos}
              halosOn={halosOn}
              muted={muted}
              insetRight={selected ? PANEL_PX : 0}
              focus={focus}
              hidden={hidden}
              arrows={kg.meta?.visuals?.arrows ?? false}
              edgeScale={kg.meta?.visuals?.edge_width ?? 1}
            />
          </Suspense>
        )}
      </div>

      {(kinds.length > 0 || relations.length > 0) && (
        <div
          className="legend"
          data-muted={[...muted].join(',')}
          data-kinds-off={[...hiddenKinds].join(',')}
        >
          {/* The eye is the control. A row that is off keeps its word and its count — the map is
              smaller, the document is not — and the icon is what says so. */}
          {kinds.length > 0 && (
            <>
              <h4>
                nodes
                <button
                  className="link"
                  data-fold-all={foldAll ? 'on' : 'off'}
                  title="put away everything that is not a category — people, papers, labs — and keep what each category absorbed"
                  onClick={() => setFoldAll((v) => !v)}
                >
                  {foldAll ? 'unfold' : 'only categories'}
                </button>
              </h4>
              <ul className="rels">
                {kinds.slice(0, 12).map((k) => {
                  const off = hiddenKinds.has(k.kind)
                  return (
                    <li key={k.kind}>
                      <button
                        className={off ? 'rel off' : 'rel'}
                        title={
                          off
                            ? `fold every ${k.kind} away — their mass goes to what holds them`
                            : `fold the ${k.kind} kind away, keeping what it connects`
                        }
                        onClick={() =>
                          setHiddenKinds((prev) => {
                            const next = new Set(prev)
                            if (next.has(k.kind)) next.delete(k.kind)
                            else next.add(k.kind)
                            return next
                          })
                        }
                      >
                        <span className="dot" style={{ background: k.color }} />
                        <span className="word">{k.kind}</span>
                        <span className="eye" aria-hidden="true">
                          {off ? eyeOff : eyeOn}
                        </span>
                        <i>{k.count}</i>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          {relations.length > 0 && (
            <>
              <h4>relations</h4>
              <ul className="rels">
                {relations.map((r) => {
                  const off = muted.has(r.rel)
                  return (
                    <li key={r.rel}>
                      <button
                        className={off ? 'rel off' : 'rel'}
                        title={
                          off
                            ? 'off everywhere: not drawn, not listed in the panel, and not folded'
                            : 'drawn — switch a relation off when it says more about the corpus than about the field'
                        }
                        onClick={() =>
                          setMuted((prev) => {
                            const next = new Set(prev)
                            if (next.has(r.rel)) next.delete(r.rel)
                            else next.add(r.rel)
                            return next
                          })
                        }
                      >
                        <span className="mark" />
                        <span className="word">{r.rel}</span>
                        <span className="eye" aria-hidden="true">
                          {off ? eyeOff : eyeOn}
                        </span>
                        <i>{r.n}</i>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      )}

      {nodeAttrs && (
        <aside className="panel">
          <button className="close" onClick={() => setSelected(null)}>
            ×
          </button>
          <h2>{String(nodeAttrs.label ?? selected)}</h2>
          <dl>
            <dt>kind</dt>
            <dd>{nodeAttrs.kind != null ? String(nodeAttrs.kind) : '—'}</dd>
            <dt>weight</dt>
            <dd>
              {nodeAttrs.weight != null ? String(nodeAttrs.weight) : '—'}
              {nodeAttrs.weight != null ? (
                <span className="from">
                  {nodeAttrs.weight_from === 'document'
                    ? 'as this document states'
                    : `by ${weightMetric}`}
                </span>
              ) : null}
            </dd>
            {nodeAttrs.size != null ? (
              <>
                <dt>size</dt>
                <dd>
                  {String(nodeAttrs.size)} <span className="from">set by hand</span>
                </dd>
              </>
            ) : null}
            <dt>level</dt>
            <dd>{nodeAttrs.level != null ? String(nodeAttrs.level) : '—'}</dd>
            <dt>parent</dt>
            <dd>{nodeAttrs.parent != null ? String(nodeAttrs.parent) : '—'}</dd>
            {/* Every other property the document carried gets its own row. This panel has no
                list of fields and never needs one: the graph says what it has, and adding a
                property to a node is a data edit, not a change to this app. */}
            {extraFields.map(([k, v]) => (
              <Fragment key={k}>
                <dt>{k}</dt>
                <dd>{renderValue(v)}</dd>
              </Fragment>
            ))}
          </dl>

          {nodeDocKey !== null ? (
            <button className="doc-open" onClick={() => setDoc(nodeDocKey)}>
              read the note
            </button>
          ) : null}

          {/* What this node has hidden inside it, said out loud: a folded map that does not say
              what it is hiding is a lie about the map. Counts can be fractional: a scientist
              shared by two papers is half in each orbit. */}
          {/* Two rows, each one only when it has something to do: a button that cannot act is not
              a control, it is furniture. Each row says what it would move. */}
          {selected ? (
            <div className="foldbars" data-fold-preview={foldPreview?.n ?? ''} data-unfold-preview={unfoldPreview?.n ?? ''}>
              {(foldPreview?.n ?? 0) > 0 ? (
                <p className="foldbar">
                  <button className="tiny" data-fold-action="fold" onClick={() => fold(selected)}>
                    fold
                  </button>
                  <span>{`put away ${say(foldPreview)}`}</span>
                </p>
              ) : null}
              {unfoldPreview ? (
                <p className="foldbar">
                  <button className="tiny" data-fold-action="unfold" onClick={() => unfold(selected)}>
                    unfold
                  </button>
                  <span>{`bring back ${say(unfoldPreview)}`}</span>
                </p>
              ) : null}
              {(foldPreview?.n ?? 0) === 0 && !unfoldPreview ? (
                <p className="foldbar">
                  <span>nothing below this node and nothing folded here</span>
                </p>
              ) : null}
            </div>
          ) : null}

          {selected && (halos.get(selected)?.length ?? 0) > 0 ? (
            <p className="collapsed">
              <b>{halos.get(selected)?.reduce((n, h) => n + h.n, 0) ?? 0}</b>{' '}
              {(halos.get(selected)?.reduce((n, h) => n + h.n, 0) ?? 0) === 1 ? 'node is' : 'nodes are'}{' '}
              folded here
              {halos.get(selected)?.map((h) => (
                <span className="halo-kind" key={h.kind} style={{ color: h.color }}>
                  {' '}
                  {h.n} {h.kind}
                </span>
              ))}{' '}
              —{' '}
              <button className="link" onClick={() => showInside(selected)}>
                show them
              </button>
            </p>
          ) : null}

          {/* The graph read as a list: every relation this node has, folded by the relation's
              own word, with the node at the other end clickable — the panel is a way to walk
              the graph, not a dead end. */}
          {groups.length > 0 ? (
            <>
              <h3>
                connections <i>{connections.length}</i>
              </h3>
              {groups.map((g) => (
                <div className="group" key={g.rel}>
                  <div className="group-head">
                    <button
                      className="link"
                      onClick={() =>
                        setFolded((prev) => {
                          const next = new Set(prev)
                          if (next.has(g.rel)) next.delete(g.rel)
                          else next.add(g.rel)
                          return next
                        })
                      }
                    >
                      {folded.has(g.rel) ? '▸' : '▾'} {g.rel}
                    </button>
                    <i>{g.conns.length}</i>
                  </div>
                  {folded.has(g.rel) ? null : (
                    <ul className="conns">
                      {g.conns.map((c) => (
                        <li key={c.key}>
                          <button
                            className={hidden.has(c.other) ? 'conn hidden-conn' : 'conn'}
                            title={hidden.has(c.other) ? 'this is inside the collapse — show it to see it in the map' : undefined}
                            onMouseEnter={() => setHoverEdge(c.key)}
                            onMouseLeave={() => setHoverEdge(null)}
                            onClick={() => onFollow(c.other)}
                          >
                            <span className="head">
                              <span className="dot" style={{ background: c.color }} />
                              <span className="rel">
                                {c.arrow} {c.rel || 'related'}
                              </span>
                              <span className="power">×{c.power}</span>
                              {c.agg ? <span className="tag">counted</span> : null}
                            </span>
                            <span className="other">{c.label}</span>
                            {c.extra.length > 0 ? (
                              <span className="props">
                                {c.extra.map(([k, v]) => `${k} ${String(v)}`).join(' · ')}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </>
          ) : null}
          {Array.isArray(nodeAttrs.tags) && nodeAttrs.tags.length > 0 ? (
            <p className="tags">{nodeAttrs.tags.join(' · ')}</p>
          ) : null}
          {typeof nodeAttrs.link === 'string' ? (
            <a href={nodeAttrs.link} target="_blank" rel="noreferrer">
              {nodeAttrs.link}
            </a>
          ) : null}
          {typeof nodeAttrs.desc === 'string' ? <p className="desc">{nodeAttrs.desc}</p> : null}
          <code className="id">{selected}</code>
        </aside>
      )}

      {doc !== null ? (
        <DocPanel name={doc} md={docs[doc] ?? ''} onClose={() => setDoc(null)} />
      ) : null}
    </div>
  )
}
