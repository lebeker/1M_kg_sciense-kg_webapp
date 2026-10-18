import { type Kg, relationOf, weightOf } from './kg'

/**
 * Folding, as a pure function of the document and the decisions taken on it.
 *
 * **One click, one layer.** Folding a category puts away the papers directly under it; the next
 * click puts away the people under those papers; then the labs. Not the whole branch at once — a
 * reader watching a branch shrink can follow what happened, and a reader who wants the whole map
 * flat has "only categories".
 *
 * **The axis is `level`.** A node's children are its neighbours at a *deeper* level. A folded
 * node's children are re-hung on the node's parents, counted, so the next layer is reachable and
 * the branch keeps shrinking in the same place.
 *
 * Two properties matter more than anything clever:
 *
 * - **Deterministic.** Same document, same decisions, same picture: work is ordered by depth and
 *   then by id, so the order clicks arrived in cannot change the result.
 * - **Nothing invented.** A node's mass is split evenly between the parents it goes into. Two nodes
 *   still on the map are joined only by what they actually share, counted once per shared thing.
 */

export type Absorbed = {
  /** The weight that came in — what the ring around the node is made of. */
  mass: number
  /** The nodes folded inside, by id: what two hosts can share. */
  items: Set<string>
  /** How much of each kind is folded inside — a count of nodes, never a fraction. */
  byKind: Map<string, number>
}

export type VirtualEdge = { a: string; b: string; power: number; label: string }

/** How many layers the reader has folded away at one node. */
export type FoldStep = { id: string; n: number }

export type FoldState = {
  hidden: Set<string>
  absorbed: Map<string, Absorbed>
  virtual: VirtualEdge[]
  /** Nodes a fold was asked for and could not do: nothing above them to fold into. */
  stuck: Set<string>
}

type Rel = { power: number; label: string }

/**
 * A document that never wrote `level` still has a shape: a paper sits under its subject, a person
 * under their paper, a lab under their person. Without this fallback a graph imported from a
 * provider — no levels anywhere — had a fold button that did nothing at all, on every node.
 */
const DEFAULT_LEVEL: Record<string, number> = {
  subject: 2,
  topic: 2,
  field: 2,
  concept: 2,
  idea: 2,
  paper: 2.5,
  publication: 2.5,
  article: 2.5,
  work: 2.5,
  preprint: 2.5,
  study: 2.5,
  scientist: 3,
  researcher: 3,
  author: 3,
  person: 3,
  people: 3,
  lab: 3.5,
  laboratory: 3.5,
  institution: 4,
  university: 4,
  company: 4,
  funder: 4,
}

const levelOf = (kg: Kg, id: string): number => {
  const a = kg.graph.hasNode(id) ? (kg.graph.getNodeAttribute(id, 'level') as unknown) : undefined
  if (typeof a === 'number') return a
  const kind = String(kg.graph.getNodeAttribute(id, 'kind') ?? '').toLowerCase()
  return DEFAULT_LEVEL[kind] ?? 2.5
}

const kindOf = (kg: Kg, id: string): string =>
  String(kg.graph.getNodeAttribute(id, 'kind') ?? 'node')

/** Edges as the fold sees them: the document's, minus what the reader has switched off. */
function buildAdj(kg: Kg, muted: Set<string>): Map<string, Map<string, Rel>> {
  const adj = new Map<string, Map<string, Rel>>()
  kg.graph.forEachNode((id) => adj.set(id, new Map()))
  kg.graph.forEachEdge((_k, a, s, t) => {
    const attrs = a as Record<string, unknown>
    if (attrs.agg) return
    const rel = relationOf(attrs)
    if (muted.has(rel)) return
    const power = typeof attrs.power === 'number' ? attrs.power : 1
    const label = String(attrs.label ?? rel ?? 'related')
    adj.get(s)?.set(t, { power, label })
    adj.get(t)?.set(s, { power, label })
  })
  return adj
}

/** Everything under a node: reachable through neighbours of a deeper level. */
export function subtreeOf(kg: Kg, root: string, muted: Set<string>): string[] {
  const adj = buildAdj(kg, muted)
  const out = new Set<string>()
  // Monotone in `level`: every step goes strictly deeper than the node it leaves, so a paper's
  // co-citation peers (same level) are never part of its subject's subtree.
  const frontier: [string, number][] = [[root, levelOf(kg, root)]]
  while (frontier.length) {
    const [id, lvl] = frontier.pop() as [string, number]
    for (const n of adj.get(id)?.keys() ?? []) {
      if (out.has(n) || n === root) continue
      const ln = levelOf(kg, n)
      if (ln <= lvl) continue
      out.add(n)
      frontier.push([n, ln])
    }
  }
  return [...out]
}

export function foldState(
  kg: Kg,
  opts: { muted: Set<string>; steps: FoldStep[]; kinds: Set<string>; foldAll?: boolean },
): FoldState {
  const { muted, steps, kinds, foldAll } = opts
  const adj = buildAdj(kg, muted)
  const hidden = new Set<string>()
  const absorbed = new Map<string, Absorbed>()
  const virtualBy = new Map<string, VirtualEdge>()
  const stuck = new Set<string>()
  /** Lines this fold invented; a later layer has to be able to walk them. */
  const peers = new Map<string, Map<string, Rel>>()

  const visible = (id: string) => adj.has(id) && !hidden.has(id)
  const link = (a: string, b: string, r: Rel) => {
    const m = peers.get(a) ?? new Map<string, Rel>()
    m.set(b, r)
    peers.set(a, m)
  }
  const neighbours = (id: string): string[] => {
    const out = new Set<string>()
    adj.get(id)?.forEach((_r, n) => {
      if (visible(n)) out.add(n)
    })
    peers.get(id)?.forEach((_r, n) => {
      if (visible(n)) out.add(n)
    })
    return [...out]
  }
  const relBetween = (a: string, b: string): Rel =>
    peers.get(a)?.get(b) ?? adj.get(a)?.get(b) ?? { power: 1, label: 'related' }
  const parentsOf = (id: string) => neighbours(id).filter((n) => levelOf(kg, n) < levelOf(kg, id))
  const childrenOf = (id: string) => neighbours(id).filter((n) => levelOf(kg, n) > levelOf(kg, id))

  /**
   * Fold one node away, into the nodes above it.
   *
   * Its weight and whatever it already absorbed split evenly between the parents — a scientist
   * shared by two papers is half in each of their orbits. Its own children do not vanish with it:
   * they re-hang on the parents at that same share, so the layer below is still there to fold on
   * the next click and the branch keeps shrinking where the reader is looking.
   */
  const foldOne = (id: string): boolean => {
    const parents = parentsOf(id)
    if (!parents.length) {
      stuck.add(id)
      return false
    }
    const k = parents.length
    const mine = absorbed.get(id)
    const mass = weightOf(kg, id) + (mine?.mass ?? 0)
    const byKind = new Map(mine?.byKind ?? [])
    byKind.set(kindOf(kg, id), (byKind.get(kindOf(kg, id)) ?? 0) + 1)
    const kids = childrenOf(id)

    hidden.add(id)
    for (const n of [...(adj.get(id)?.keys() ?? [])]) adj.get(n)?.delete(id)
    adj.delete(id)
    peers.delete(id)

    for (const p of parents) {
      const at =
        absorbed.get(p) ?? { mass: 0, items: new Set<string>(), byKind: new Map<string, number>() }
      at.mass += mass / k
      byKind.forEach((n, kd) => at.byKind.set(kd, (at.byKind.get(kd) ?? 0) + n))
      at.items.add(id)
      mine?.items.forEach((it) => at.items.add(it))
      absorbed.set(p, at)
    }

    for (const c of kids) {
      const rel = relBetween(id, c)
      const share = Math.round((rel.power / k) * 100) / 100
      for (const p of parents) {
        const r = { power: share, label: rel.label }
        link(c, p, r)
        link(p, c, r)
        const [a, b] = c < p ? [c, p] : [p, c]
        const key = `${a}|${b}|${rel.label}`
        const at = virtualBy.get(key)
        if (at) at.power = Math.round((at.power + share) * 100) / 100
        else virtualBy.set(key, { a, b, power: share, label: rel.label })
      }
    }

    absorbed.delete(id)
    return true
  }

  /** The next single layer under a node — its shallowest visible descendants. */
  const nextLayer = (root: string): string[] => {
    const seen = new Set<string>([root])
    let frontier = [root]
    while (frontier.length) {
      const deeper: string[] = []
      for (const id of frontier) {
        for (const n of neighbours(id)) {
          if (seen.has(n)) continue
          if (levelOf(kg, n) <= levelOf(kg, id)) continue
          seen.add(n)
          deeper.push(n)
        }
      }
      if (deeper.length) return deeper.sort((a, b) => a.localeCompare(b))
      frontier = deeper
    }
    return []
  }

  /** One click at a node: the layer below it. With nothing below, the node itself goes up. */
  const foldStep = (root: string): boolean => {
    const layer = nextLayer(root)
    if (layer.length) {
      let any = false
      for (const id of layer) if (visible(id)) any = foldOne(id) || any
      return any
    }
    if (parentsOf(root).length) return foldOne(root)
    stuck.add(root)
    return false
  }

  if (foldAll) {
    // Fold the map up to its categories: every node that is not on the top layer goes into the
    // layer above it, deepest first. What is left is the category graph, each node carrying what
    // it absorbed.
    let top = Number.POSITIVE_INFINITY
    kg.graph.forEachNode((id) => {
      top = Math.min(top, levelOf(kg, id))
    })
    const ids: string[] = []
    kg.graph.forEachNode((id) => {
      if (levelOf(kg, id) > top) ids.push(id)
    })
    ids.sort((a, b) => levelOf(kg, b) - levelOf(kg, a) || a.localeCompare(b))
    for (const id of ids) if (visible(id)) foldOne(id)
  }

  for (const step of steps) {
    if (!kg.graph.hasNode(step.id) || !visible(step.id)) continue
    for (let i = 0; i < step.n; i += 1) if (!foldStep(step.id)) break
  }

  // A kind switched off in the legend is folded the same way: deepest first.
  const byKindIds = new Map<string, string[]>()
  kg.graph.forEachNode((id) => {
    if (!kinds.has(kindOf(kg, id))) return
    const at = byKindIds.get(kindOf(kg, id)) ?? []
    at.push(id)
    byKindIds.set(kindOf(kg, id), at)
  })
  for (const [, ids] of byKindIds) {
    ids.sort((a, b) => levelOf(kg, b) - levelOf(kg, a) || a.localeCompare(b))
    for (const id of ids) if (visible(id)) foldOne(id)
  }

  // What two surviving nodes have in common, counted once per shared thing: two categories that
  // share three people are joined by `shares scientist ×3`.
  const hostsOf = new Map<string, Set<string>>()
  absorbed.forEach((a, host) => {
    a.items.forEach((item) => {
      if (!hidden.has(item)) return
      const at = hostsOf.get(item) ?? new Set<string>()
      at.add(host)
      hostsOf.set(item, at)
    })
  })
  const shares = new Map<string, { a: string; b: string; n: number; kind: string }>()
  hostsOf.forEach((hosts, item) => {
    if (hosts.size < 2) return
    const list = [...hosts].sort()
    const kind = kindOf(kg, item)
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const key = `${list[i]}|${list[j]}|${kind}`
        const at = shares.get(key)
        if (at) at.n += 1
        else shares.set(key, { a: list[i], b: list[j], n: 1, kind })
      }
    }
  })
  for (const { a, b, n, kind } of shares.values()) {
    virtualBy.set(`share|${a}|${b}|${kind}`, { a, b, power: n, label: `shares ${kind}` })
  }

  return { hidden, absorbed, virtual: [...virtualBy.values()], stuck }
}
