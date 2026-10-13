import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { type Kg, kindsOf, loadKg } from './kg'
import SigmaView from './SigmaView'
import './styles.css'

// Separate chunk: three + 3d-force-graph are only fetched when 3D is chosen.
const ThreeView = lazy(() => import('./ThreeView'))

type Hit = { id: string; label: string; kind: string }

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
            <dt>parent</dt>
            <dd>{nodeAttrs.parent != null ? String(nodeAttrs.parent) : '—'}</dd>
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
