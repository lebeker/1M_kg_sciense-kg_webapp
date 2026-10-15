import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { type Kg, kindsOf, loadKg } from './kg'
import SigmaView from './SigmaView'
import './styles.css'

// Separate chunk: three + 3d-force-graph are only fetched when 3D is chosen.
const ThreeView = lazy(() => import('./ThreeView'))

type Hit = { id: string; label: string; kind: string }

/** The rows the panel lays out in its own order. Everything else a node carries is data. */
const LAID_OUT = new Set([
  'id', 'label', 'kind', 'level', 'size', 'parent', 'tags', 'link', 'desc', 'color',
  'style', 'x', 'y',
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
  const [mode, setMode] = useState<'2d' | '3d'>('2d')
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [fit, setFit] = useState(0)

  useEffect(() => {
    loadKg().then(setKg)
  }, [])

  const onSelect = useCallback((id: string | null) => setSelected(id), [])

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

  // What the panel does not lay out itself, in a stable order — derived from the node, so a
  // graph carrying a field this app has never heard of still shows it.
  const extraFields = useMemo<[string, unknown][]>(() => {
    if (!nodeAttrs) return []
    return Object.entries(nodeAttrs)
      .filter(([k, v]) => !LAID_OUT.has(k) && v != null && String(v).length > 0)
      .sort(([a], [b]) => a.localeCompare(b))
  }, [nodeAttrs])

  if (!kg) return <div className="app" />

  return (
    <div className="app">
      <header className="bar">
        <span className="title">{kg.meta.title ?? 'knowledge graph'}</span>
        <span className="count">
          {kg.graph.order} nodes · {kg.graph.size} edges
          {kg.layout === 'computed' ? ' · layout computed here' : ''}
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
          <SigmaView kg={kg} selected={selected} onSelect={onSelect} fitSignal={fit} />
        ) : (
          <Suspense fallback={<p className="empty">loading 3D…</p>}>
            <ThreeView kg={kg} onSelect={onSelect} />
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
            <dt>level</dt>
            <dd>{nodeAttrs.level != null ? String(nodeAttrs.level) : '—'}</dd>
            <dt>size</dt>
            <dd>{nodeAttrs.size != null ? String(nodeAttrs.size) : '—'}</dd>
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
    </div>
  )
}
