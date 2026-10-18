import { type Kg, relationOf, weightOf } from './kg'

/**
 * Folding, as a pure function of the document and a list of decisions.
 *
 * The axis is `level`, not weight. A node's *children* are its neighbours at a **deeper** level,
 * and folding walks **upwards**: leaves first, each leaf into its parents (the neighbours above
 * it). A fold therefore never climbs: the subtree below a node is consumed bottom-up, so a paper
 * folds into its concept only after its scientists and their institutions are gone.
 *
 * Two properties matter more than anything clever:
 *
 * - **Deterministic.** Same document, same decisions, same picture. Nothing depends on the order
 *   clicks arrived in, because the work list is sorted by depth and then by id.
 * - **Nothing is invented.** A folded node's mass is split evenly between its parents (`+0.5` of a
 *   scientist each, when two papers share him), and every relation it still had to something that
 *   stays visible is re-attached to each parent at the same share (`institution --0.5--> paper A`
 *   and `--0.5--> paper B`). No line is ever drawn between two nodes that were not already
 *   connected through the node being folded.
 */

export type Absorbed = {
  /** The weight that came in — what the ring around the node is made of. */
  mass: number
  /** How much of each kind is folded inside it. Fractional, because a split node is half here. */
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

type Rel = { power: number }

const levelOf = (kg: Kg, id: string): number => {
  const a = kg.graph.hasNode(id) ? (kg.graph.getNodeAttribute(id, 'level') as unknown) : undefined
  // A node with no level cannot be placed in the tree; treating it as the deepest makes it a leaf,
  // which is the safe reading — it can be folded away, never fold something else.
  return typeof a === 'number' ? a : Number.MAX_SAFE_INTEGER
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
    if (muted.has(relationOf(attrs))) return
    const power = typeof attrs.power === 'number' ? attrs.power : 1
    adj.get(s)?.set(t, { power })
    adj.get(t)?.set(s, { power })
  })
  return adj
}

/** Everything under a node: reachable through neighbours of a deeper level. */
export function subtreeOf(kg: Kg, root: string, muted: Set<string>): string[] {
  const adj = buildAdj(kg, muted)
  const out = new Set<string>()
  // Monotone in `level`: every step goes strictly deeper than the node it leaves. Comparing
  // against the *root's* level instead would make a paper's co-citation peers (same level as the
  // paper, deeper than the concept above it) part of the concept's subtree — and one fold then
  // walks the whole hairball through 0.05 hairlines.
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
  opts: { muted: Set<string>; ops: string[]; kinds: Set<string> },
): FoldState {
  const { muted, ops, kinds } = opts
  const adj = buildAdj(kg, muted)
  const hidden = new Set<string>()
  const absorbed = new Map<string, Absorbed>()
  const virtual: VirtualEdge[] = []
  const stuck = new Set<string>()

  const visible = (id: string) => adj.has(id) && !hidden.has(id)
  const neighbours = (id: string) => [...(adj.get(id)?.keys() ?? [])].filter(visible)
  const parentsOf = (id: string) => neighbours(id).filter((n) => levelOf(kg, n) < levelOf(kg, id))
  const childrenOf = (id: string) => neighbours(id).filter((n) => levelOf(kg, n) > levelOf(kg, id))

  /**
   * Fold one node away, into the nodes above it.
   *
   * Its own weight *and whatever it had already absorbed* are split evenly between the parents —
   * a scientist shared by two papers is half in each of their orbits, and an institution he
   * brought with him is half a house on each paper too. Anything still hanging below him is
   * re-attached to each parent at the same share: his two institutions become
   * `institution --0.5--> paper A` and `--0.5--> paper B`, never a brand-new line invented out of
   * thin air.
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
    const below = childrenOf(id)
    const belowPower = below.map((c) => ({ c, power: adj.get(id)?.get(c)?.power ?? 1 }))

    hidden.add(id)
    adj.delete(id)
    for (const n of [...below]) adj.get(n)?.delete(id)
    for (const p of parents) {
      adj.get(p)?.delete(id)
      const at = absorbed.get(p) ?? { mass: 0, byKind: new Map<string, number>() }
      at.mass += mass / k
      byKind.forEach((n, kd) => at.byKind.set(kd, (at.byKind.get(kd) ?? 0) + n / k))
      absorbed.set(p, at)
    }
    for (const { c, power } of belowPower) {
      for (const p of parents) {
        virtual.push({ a: c, b: p, power: power / k, label: 'through what is folded' })
      }
    }
    absorbed.delete(id)
    return true
  }

  /** A node with nothing above it cannot go up: what it holds is folded into it instead. */
  const foldInto = (root: string) => {
    if (parentsOf(root).length) {
      foldOne(root)
      return
    }
    const sub = subtreeOf(kg, root, muted).sort(
      (a, b) => levelOf(kg, b) - levelOf(kg, a) || a.localeCompare(b),
    )
    for (const id of sub) if (visible(id)) foldOne(id)
  }

  for (const root of ops) {
    if (!kg.graph.hasNode(root) || !visible(root)) continue
    foldInto(root)
  }

  // A kind switched off in the legend is folded the same way: deepest first, so an institution
  // goes into its people before a person goes into a paper.
  const byKind = new Map<string, string[]>()
  kg.graph.forEachNode((id) => {
    if (!kinds.has(kindOf(kg, id))) return
    const at = byKind.get(kindOf(kg, id)) ?? []
    at.push(id)
    byKind.set(kindOf(kg, id), at)
  })
  for (const [, ids] of byKind) {
    ids.sort((a, b) => levelOf(kg, b) - levelOf(kg, a) || a.localeCompare(b))
    for (const id of ids) if (visible(id)) foldOne(id)
  }

  return { hidden, absorbed, virtual, stuck }
}
