import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type Kg, kindsOf, loadDocs, loadKg, weightOf } from './kg'
import SigmaView from './SigmaView'
import DocPanel from './DocPanel'
import { measureNote, readBudget, watchWork, writeBudget } from './capacity'
import './styles.css'

// Separate chunk: three + 3d-force-graph are only fetched when 3D is chosen.
const ThreeView = lazy(() => import('./ThreeView'))

type Hit = { id: string; label: string; kind: string }

/** One edge as the panel shows it: the relation, its power, and the node at the other end. */
type Conn = {
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
type Group = { rel: string; conns: Conn[] }

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
  /** Nodes collapsed away: not drawn, and the node they were collapsed into wears a ring whose
   * thickness is the mass that went into hiding. */
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [hosts, setHosts] = useState<Map<string, Set<string>>>(new Map())
  const [folded, setFolded] = useState<Set<string>>(new Set())
  /** The node budget measured on this host, and whether the reader has insisted on more. */
  const [budget, setBudget] = useState<number | null>(null)
  const [overridden, setOverridden] = useState(false)
  const [doc, setDoc] = useState<string | null>(null)
  const asked = useRef(false)

  useEffect(() => {
    loadKg().then(setKg)
    loadDocs().then(setDocs)
  }, [])

  const onSelect = useCallback((id: string | null) => setSelected(id), [])
  const onFollow = useCallback((id: string) => {
    setSelected(id)
    setFocus((prev) => ({ id, n: (prev?.n ?? 0) + 1 }))
  }, [])

  const kinds = useMemo(() => (kg ? kindsOf(kg) : []), [kg])

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

  /** Everything the selected node is joined to, strongest first — the graph read as a list. */
  const connections = useMemo<Conn[]>(() => {
    if (!kg || !selected || !kg.graph.hasNode(selected)) return []
    const out: Conn[] = []
    kg.graph.forEachEdge(selected, (key, a, source, target) => {
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
        extra: Object.entries(a as Record<string, unknown>).filter(
          ([k, v]) => !EDGE_LAID_OUT.has(k) && v !== undefined && v !== null,
        ) as [string, unknown][],
      })
    })
    return out.sort((x, y) => y.power - x.power)
  }, [kg, selected])

  /** The same list, folded by relation word: what the panel shows a block at a time. */
  const groups = useMemo<Group[]>(() => {
    const by = new Map<string, Conn[]>()
    for (const c of connections) {
      const key = c.rel || 'related'
      const at = by.get(key)
      if (at) at.push(c)
      else by.set(key, [c])
    }
    return [...by.entries()].map(([rel, conns]) => ({ rel, conns }))
  }, [connections])

  /** What the numbers in `weight` measure, as the document itself states it. */
  const weightMetric = kg?.meta?.weight?.metric ?? 'connections'

  /** This graph is bigger than what this host was measured to draw: draw a part of it. */
  const declared = kg?.meta?.visuals?.max_nodes ?? null
  const budgetNow = budget ?? declared
  const overBudget = !!kg && budgetNow !== null && kg.graph.order > budgetNow && !overridden
  const calibrating = !!kg && kg.graph.order > CALIBRATE_OVER && budget === null

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
    for (const k of ['overview', 'index', 'overview.md', 'index.md']) if (docs[k] !== undefined) return k
    return null
  }, [docs])

  /** The mass hidden inside each node that has something collapsed into it. */
  const halos = useMemo(() => {
    const out = new Map<string, number>()
    hosts.forEach((kids, host) => {
      let mass = 0
      kids.forEach((k) => kg && (mass += weightOf(kg, k)))
      out.set(host, mass)
    })
    return out
  }, [hosts, kg])

  /**
   * Hide neighbours of this node, keeping the mass they carried visible as a ring. A node is
   * only hidden when the relation to this node is its only visible structure — collapsing one
   * that is wired to the rest of the map would take that wiring with it.
   */
  const collapse = useCallback(
    (ids: string[]) => {
      if (!kg || !selected) return
      const keep = new Set(hidden)
      const taken: string[] = []
      for (const id of ids) {
        if (keep.has(id) || id === selected) continue
        let elsewhere = 0
        kg.graph.forEachEdge(id, (_k, _a, s, t) => {
          const other = s === id ? t : s
          if (other === selected || keep.has(other)) return
          elsewhere += 1
        })
        if (elsewhere === 0) {
          keep.add(id)
          taken.push(id)
        }
      }
      if (!taken.length) return
      setHidden(keep)
      setHosts((prev) => {
        const next = new Map(prev)
        const at = new Set(next.get(selected) ?? [])
        taken.forEach((id) => at.add(id))
        next.set(selected, at)
        return next
      })
    },
    [kg, selected, hidden],
  )

  const reveal = useCallback((host: string) => {
    const kids = hosts.get(host)
    if (kids) {
      setHidden((h) => {
        const out = new Set(h)
        kids.forEach((k) => out.delete(k))
        return out
      })
    }
    setHosts((prev) => {
      const next = new Map(prev)
      next.delete(host)
      return next
    })
  }, [hosts])

  const revealAll = useCallback(() => {
    setHidden(new Set())
    setHosts(new Map())
    setOverridden(true)
  }, [])

  // Selecting something collapsed away brings it back: a search result you cannot see is not a
  // result.
  useEffect(() => {
    if (!selected || !hidden.has(selected)) return
    setHidden((h) => {
      const out = new Set(h)
      out.delete(selected)
      return out
    })
    setHosts((prev) => {
      const next = new Map(prev)
      next.forEach((kids, host) => {
        if (!kids.has(selected)) return
        const at = new Set(kids)
        at.delete(selected)
        if (at.size) next.set(host, at)
        else next.delete(host)
      })
      return next
    })
  }, [selected, hidden])

  // The budget: measured on this host, remembered here, raised by use. A number written into a
  // document would be a guess about a machine it never saw.
  useEffect(() => {
    if (!kg || asked.current || kg.graph.order <= CALIBRATE_OVER) return
    asked.current = true
    const stored = readBudget(kg.meta.app ?? 'kg')
    if (stored !== null) setBudget(stored)
  }, [kg])

  useEffect(() => {
    if (!kg || budget === null) return
    writeBudget(kg.meta.app ?? 'kg', budget)
  }, [kg, budget])

  // A measurement is a claim, and claims can be wrong in both directions: ten minutes of real
  // use at a size this host was not supposed to hold is evidence the claim was pessimistic, and
  // capacity.ts says what counts as use. A page left open with nobody there does not.
  useEffect(() => {
    if (!kg) return
    return watchWork(kg.meta.app ?? 'kg', overBudget, setBudget)
  }, [kg, overBudget])

  if (!kg) return <div className="app" />

  return (
    <div className="app">
      <header className="bar">
        <span className="title">{kg.meta.title ?? 'knowledge graph'}</span>
        <span className="count">
          {hidden.size > 0 ? `${kg.graph.order - hidden.size} of ${kg.graph.order} nodes · ` : null}
          {kg.graph.order} nodes · {kg.graph.size} edges
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

        {overview ? (
          <button onClick={() => setDoc(overview)} title="the notes written beside this graph">
            notes
          </button>
        ) : null}
        {hosts.size > 0 ? <button onClick={revealAll}>show all</button> : null}
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
              ? `${hidden.size} nodes are collapsed`
              : 'this graph is larger than this host was measured to draw'}
          </b>
          <span>
            budget {budgetNow} nodes{measureNote() ? ` · measured ${measureNote()}` : ''} — the
            rest is here, it is just not drawn
          </span>
          <button onClick={() => setOverridden(true)}>expand anyway</button>
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
            hidden={hidden}
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
              insetRight={selected ? PANEL_PX : 0}
              focus={focus}
              hidden={hidden}
              arrows={kg.meta?.visuals?.arrows ?? false}
              edgeScale={kg.meta?.visuals?.edge_width ?? 1}
            />
          </Suspense>
        )}
      </div>

      {kinds.length > 0 && (
        <ul className="legend">
          {kinds.slice(0, 12).map((k) => (
            <li key={k.kind}>
              <span className="dot" style={{ background: k.color }} />
              {k.kind} <i>{k.count}</i>
            </li>
          ))}
        </ul>
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

          {/* What this node has hidden inside it, said out loud: a collapsed map that does not
              say what it is hiding is a lie about the map. */}
          {selected && hosts.get(selected)?.size ? (
            <p className="collapsed">
              <b>{hosts.get(selected)?.size}</b> nodes are collapsed here —{' '}
              <button className="link" onClick={() => reveal(selected)}>
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
                    <button
                      className="tiny"
                      title="hide these nodes; they stay accounted for in the ring"
                      onClick={() => collapse(g.conns.map((c) => c.other))}
                    >
                      collapse
                    </button>
                  </div>
                  {folded.has(g.rel) ? null : (
                    <ul className="conns">
                      {g.conns.map((c) => (
                        <li key={c.key}>
                          <button
                            className="conn"
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
