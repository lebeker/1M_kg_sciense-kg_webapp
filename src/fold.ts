import { type Kg, relationOf, weightOf } from './kg'

/**
 * Folding, as a pure function of the document and a list of decisions.
 *
 * **One rule, no exceptions.** A node's children are its neighbours at a *deeper* `level`.
 * Folding a node hides everything below it, leaves first — papers, people, and the labs and
 * companies those people work at. If the node has nothing below it, the node itself goes up into
 * the node above it. There is no per-kind and no per-relation exception: an exception is exactly
 * what made this look random before, and this file used to carry two of them.
 *
 * Two properties matter more than anything clever:
 *
 * - **Deterministic.** Same document, same decisions, same picture. Work is ordered by depth and
 *   then by id, so the order clicks arrived in cannot change the result.
 * - **Nothing invented.** A node's mass is split evenly between the parents it goes into (`+0.5`
 *   of a scientist each, when two papers share him). Two nodes still on the map are joined only by
 *   what they genuinely share, counted once per shared thing.
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
  opts: { muted: Set<string>; ops: string[]; kinds: Set<string>; foldAll?: boolean },
): FoldState {
  const { muted, ops, kinds, foldAll } = opts
  const adj = buildAdj(kg, muted)
  const hidden = new Set<string>()
  const absorbed = new Map<string, Absorbed>()
  const virtualBy = new Map<string, VirtualEdge>()
  const stuck = new Set<string>()

  const visible = (id: string) => adj.has(id) && !hidden.has(id)
  const neighbours = (id: string) => [...(adj.get(id)?.keys() ?? [])].filter(visible)
  const parentsOf = (id: string) => neighbours(id).filter((n) => levelOf(kg, n) < levelOf(kg, id))

  /**
   * Fold one node away, into the nodes above it. Its weight and everything it already absorbed
   * split evenly between them: a scientist shared by two papers is half in each of their orbits,
   * and the two labs he works at are half a lab on each paper too. Nothing is re-attached behind
   * his back — whatever is below him is folded into him first, so what leaves the map is exactly
   * what he contained.
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

    hidden.add(id)
    for (const n of [...(adj.get(id)?.keys() ?? [])]) adj.get(n)?.delete(id)
    adj.delete(id)
    for (const p of parents) {
      const at =
        absorbed.get(p) ?? { mass: 0, items: new Set<string>(), byKind: new Map<string, number>() }
      at.mass += mass / k
      byKind.forEach((n, kd) => at.byKind.set(kd, (at.byKind.get(kd) ?? 0) + n))
      at.items.add(id)
      mine?.items.forEach((it) => at.items.add(it))
      absorbed.set(p, at)
    }
    absorbed.delete(id)
    return true
  }

  /**
   * Folding a node means folding **what it holds first, then itself if it can go up**. Skipping
   * the first half is what made the map inconsistent: a scientist with a parent folded alone and
   * left her company standing, while a concept with no parent swept its whole branch. Same click,
   * two different results, and no way for a reader to know which one they were about to get.
   */
  const foldInto = (root: string) => {
    const sub = subtreeOf(kg, root, muted).sort(
      (a, b) => levelOf(kg, b) - levelOf(kg, a) || a.localeCompare(b),
    )
    for (const id of sub) if (visible(id)) foldOne(id)
    if (parentsOf(root).length) foldOne(root)
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

  for (const root of ops) {
    if (!kg.graph.hasNode(root) || !visible(root)) continue
    foldInto(root)
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
