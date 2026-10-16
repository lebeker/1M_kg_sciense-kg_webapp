/**
 * The node budget: how many nodes this host was measured to hold.
 *
 * It lives here, in the reader's own browser, and not in the document, because it is a fact
 * about a machine — the document is shared between machines that are not equally fast. The
 * measurement itself happens in the 2D view (SigmaView), which is the only thing that knows
 * what a frame actually costs; this module only keeps the answer and the note about it.
 *
 * Two ways the answer is allowed to move:
 *   - a new measurement replaces it (a different graph, a different day);
 *   - work replaces it: if someone actually uses the page for ten minutes' worth of pointing
 *     and clicking *while it is over budget* and nothing fights them, the measurement was
 *     pessimistic and the budget goes up by a quarter.
 */

const KEY = (app: string) => `kg.budget.1:${app}`

type Stored = { nodes: number; note: string; at: string; worked_ms: number }

/** The note the banner shows: what was measured, and when. Module-level so the header can read
 * it without threading the storage key through the UI. */
let lastNote = ''

export function measureNote(): string {
  return lastNote
}

function read(app: string): Stored | null {
  try {
    const raw = localStorage.getItem(KEY(app))
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<Stored>
    if (typeof v?.nodes !== 'number' || v.nodes <= 0) return null
    return {
      nodes: v.nodes,
      note: typeof v.note === 'string' ? v.note : '',
      at: typeof v.at === 'string' ? v.at : '',
      worked_ms: typeof v.worked_ms === 'number' ? v.worked_ms : 0,
    }
  } catch {
    return null
  }
}

function store(app: string, v: Stored) {
  lastNote = v.note
  try {
    localStorage.setItem(KEY(app), JSON.stringify(v))
  } catch {
    // A browser with storage switched off still draws a graph; it just forgets the budget.
  }
}

/** The stored budget for this app on this host, or null if this host has never measured one. */
export function readBudget(app: string): number | null {
  const v = read(app)
  if (!v) return null
  if (v.note) lastNote = v.note
  return v.nodes
}

/** Record a measurement, saying what it was. */
export function writeBudget(app: string, nodes: number, note = ''): number {
  const was = read(app)
  const when = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const text = note || (was?.note ?? '') || `measured on this browser ${when}`
  store(app, { nodes, note: text, at: when, worked_ms: was?.worked_ms ?? 0 })
  return nodes
}

/**
 * Count the time the reader spends actually working in an over-budget view, and let that
 * evidence raise the budget. Pointing counts as working; a page left open with nobody there
 * does not, which is why this watches input rather than wall time.
 */
export function watchWork(app: string, overBudget: boolean, onRaise: (nodes: number) => void): () => void {
  let busyUntil = 0
  let accrued = 0
  const busy = () => {
    busyUntil = Date.now() + 2000
  }
  const events = ['mousemove', 'wheel', 'keydown', 'pointerdown'] as const
  events.forEach((e) => window.addEventListener(e, busy, { passive: true }))
  const timer = window.setInterval(() => {
    if (!overBudget || Date.now() > busyUntil) return
    const v = read(app)
    if (!v) return
    accrued += 1000
    if (accrued < 600_000) return
    // Ten minutes of real use at a size the machine was not supposed to hold: raise it, and say
    // so, because a graph that silently grows past what a reader was told is worse than a slow one.
    accrued = 0
    const nodes = Math.round(v.nodes * 1.25)
    store(app, { ...v, nodes, note: `${v.note} · raised after 10 min of use` })
    onRaise(nodes)
  }, 1000)
  return () => {
    events.forEach((e) => window.removeEventListener(e, busy))
    window.clearInterval(timer)
  }
}
