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
  /** The nodes folded inside, by id: what two hosts can share. */
  items: Set<string>
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

/**
 * Relations that are an **attribute of a node, not a container of it**. An employer is not
 * inside an employee: folding a person must never hide the lab they work at. These relations are
 * never walked, and whatever hangs on them survives the fold, re-attached to the parents at its
 * share. A document can add to the list with `meta.visuals.attributes`.
 */
const ATTRIBUTE_RELATIONS = new Set([
  'works at',
  'works for',
  'worked at',
  'affiliated with',
  'affiliation',
  'employed by',
  'member of',
  'funder',
  'funded by',
])

type Adj = { tree: Map<string, Map<string, Rel>>; attr: Map<string, Map<string, Rel>> }

/** Edges as the fold sees them: the document's, minus what the reader has switched off. */
function buildAdj(kg: Kg, muted: Set<string>, attributes: Set<string>): Adj {
  const tree: Adj['tree'] = new Map()
  const attr: Adj['attr'] = new Map()
  kg.graph.forEachNode((id) => {
    tree.set(id, new Map())
    attr.set(id, new Map())
  })
  kg.graph.forEachEdge((_k, a, s, t) => {
    const attrs = a as Record<string, unknown>
    if (attrs.agg) return
    const rel = relationOf(attrs)
    if (muted.has(rel)) return
    const power = typeof attrs.power === 'number' ? attrs.power : 1
    // The relation keeps its own word when a fold re-attaches it: a company linked to a person
    // still says "works at" when it is re-hung on the concept above them. Renaming it to
    // "through what is folded" makes a surviving link look like a vanished one.
    const label = String(attrs.label ?? rel ?? 'related')
    if (attributes.has(rel.toLowerCase()) || attributes.has(label.toLowerCase())) {
      attr.get(s)?.set(t, { power, label })
      attr.get(t)?.set(s, { power, label })
      return
    }
    tree.get(s)?.set(t, { power, label })
    tree.get(t)?.set(s, { power, label })
  })
  return { tree, attr }
}

/** Everything under a node: reachable through neighbours of a deeper level. */
export function subtreeOf(kg: Kg, root: string, muted: Set<string>, attributes = new Set<string>()): string[] {
  const adj = buildAdj(kg, muted, attributes).tree
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
  opts: { muted: Set<string>; ops: string[]; kinds: Set<string>; foldAll?: boolean },
): FoldState {
  const { muted, ops, kinds, foldAll } = opts
  const attributes = new Set<string>([...ATTRIBUTE_RELATIONS])
  for (const w of kg.meta?.visuals?.attributes ?? []) attributes.add(String(w).toLowerCase())
  const { tree: adj, attr } = buildAdj(kg, muted, attributes)
  const hidden = new Set<string>()
  const absorbed = new Map<string, Absorbed>()
  const virtualBy = new Map<string, VirtualEdge>()
  /** Lines this fold invented, so the next step can move them up just like a real relation. */
  const peers = new Map<string, Map<string, Rel>>()
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
    // The tree decides first. A node the tree does not hold anywhere — an institution, which hangs
    // on its people by an attribute — is carried by those people instead, so switching its kind off
    // still does something.
    let parents = parentsOf(id)
    if (!parents.length) parents = [...(attr.get(id)?.keys() ?? [])].filter(visible)
    if (!parents.length) {
      stuck.add(id)
      return false
    }
    const k = parents.length
    const mine = absorbed.get(id)
    const mass = weightOf(kg, id) + (mine?.mass ?? 0)
    const byKind = new Map(mine?.byKind ?? [])
    byKind.set(kindOf(kg, id), (byKind.get(kindOf(kg, id)) ?? 0) + 1)
    // What the node was *attached to* rather than in charge of — its lab, its company, its funder.
    // Those stay on the map; the fold moves them up with it, at the node's share. A tree child
    // that is still visible (a fold started in the middle of a branch) is treated the same way:
    // it re-hangs on the parents instead of being orphaned.
    const survivors = [
      ...(attr.get(id)?.keys() ?? []),
      ...(peers.get(id)?.keys() ?? []),
      ...childrenOf(id),
    ]
      .filter(visible)
      .filter((c) => !parents.includes(c))
      .map((c) => ({
        c,
        power: attr.get(id)?.get(c)?.power ?? peers.get(id)?.get(c)?.power ?? adj.get(id)?.get(c)?.power ?? 1,
        label: attr.get(id)?.get(c)?.label ?? peers.get(id)?.get(c)?.label ?? adj.get(id)?.get(c)?.label ?? 'related',
      }))

    const below = childrenOf(id)
    hidden.add(id)
    adj.delete(id)
    attr.delete(id)
    peers.delete(id)
    for (const n of [...below]) adj.get(n)?.delete(id)
    for (const p of parents) {
      adj.get(p)?.delete(id)
      const at = absorbed.get(p) ?? { mass: 0, items: new Set<string>(), byKind: new Map<string, number>() }
      at.mass += mass / k
      byKind.forEach((n, kd) => at.byKind.set(kd, (at.byKind.get(kd) ?? 0) + n / k))
      at.items.add(id)
      mine?.items.forEach((it) => at.items.add(it))
      absorbed.set(p, at)
    }
    for (const { c, power, label } of survivors) {
      for (const p of parents) {
        // Two papers by the same person at the same lab are one line to the concept, not two
        // parallel ones: the share is summed per pair.
        const [a, b] = c < p ? [c, p] : [p, c]
        const key = `${a}|${b}|${label}`
        const share = Math.round((power / k) * 100) / 100
        const at = virtualBy.get(key)
        if (at) at.power = Math.round((at.power + share) * 100) / 100
        else virtualBy.set(key, { a, b, power: share, label })
        const link = (x: string, y: string) => {
          const m = peers.get(x) ?? new Map()
          m.set(y, { power: share, label })
          peers.set(x, m)
        }
        link(a, b)
        link(b, a)
        // And it joins the simulation, so a later fold in the same pass sees it: folding a paper
        // after its scientist must carry the scientist's institution up again, not drop it.
        if (attr.has(c) && attr.has(p)) {
          const seen = attr.get(c)?.get(p)?.power ?? 0
          attr.get(c)?.set(p, { power: seen + share, label })
          attr.get(p)?.set(c, { power: seen + share, label })
        }
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
    const sub = subtreeOf(kg, root, muted, attributes).sort(
      (a, b) => levelOf(kg, b) - levelOf(kg, a) || a.localeCompare(b),
    )
    for (const id of sub) if (visible(id)) foldOne(id)
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

  // What two surviving nodes have in common, counted once per item: two categories that share three
  // people are joined by `shares scientist ×3`. Derived from the item sets, never from the number of
  // paths between them — a shared lab is one shared lab, however many people it took to say so.
  const hostsOf = new Map<string, Set<string>>()
  absorbed.forEach((a, host) => {
    a.items.forEach((item) => {
      if (hidden.has(item)) {
        const at = hostsOf.get(item) ?? new Set<string>()
        at.add(host)
        hostsOf.set(item, at)
      }
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
