/**
 * The fold is the one part of this app that changes what the reader sees, and it had no tests.
 * These are the invariants the bug reports kept breaking — written as properties over a tiny
 * graph, because a fold's failure is always the same shape: something that was connected comes
 * out of the fold looking disconnected, or something that was not connected acquires a line.
 *
 *   bun test src/fold.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { foldState } from './fold'
import { toKg, type KgJson } from './kg'

/** A two-branch map: A and B are categories, each with one child, and the children are related. */
function map(opts: { childEdge?: boolean } = {}): ReturnType<typeof toKg> {
  const doc: KgJson = {
    nodes: [
      { id: 'a', label: 'A', kind: 'subject', level: 2 },
      { id: 'b', label: 'B', kind: 'subject', level: 2 },
      { id: 'a1', label: 'a1', kind: 'subject', level: 2.2 },
      { id: 'b1', label: 'b1', kind: 'subject', level: 2.2 },
    ],
    edges: [
      { from: 'a1', to: 'a', label: 'subset of' },
      { from: 'b1', to: 'b', label: 'subset of' },
    ],
  }
  if (opts.childEdge !== false) doc.edges!.push({ from: 'a1', to: 'b1', label: 'overlaps', power: 0.3 })
  return toKg(doc)
}

const fold = (kg: ReturnType<typeof toKg>, open?: string[]) =>
  foldState(kg, {
    muted: new Set(),
    steps: [],
    kinds: new Set(),
    foldAll: true,
    open: new Set(open ?? []),
  })

describe('folding to categories', () => {
  test('a relation between two children survives as a relation between their hosts', () => {
    const kg = map()
    const state = fold(kg)
    expect([...state.hidden].sort()).toEqual(['a1', 'b1'])
    const lifted = state.virtual.find(
      (v) => (v.a === 'a' && v.b === 'b') || (v.a === 'b' && v.b === 'a'),
    )
    expect(lifted?.label).toBe('overlaps')
  })

  test('it does not invent a relation between categories that had none', () => {
    const kg = map({ childEdge: false })
    const state = fold(kg)
    const between = state.virtual.filter(
      (v) => (v.a === 'a' && v.b === 'b') || (v.a === 'b' && v.b === 'a'),
    )
    expect(between).toEqual([])
  })

  test('opening a branch keeps its next layer and folds nothing else out', () => {
    const kg = map()
    const closed = fold(kg)
    const opened = fold(kg, ['a'])
    expect(opened.hidden.has('a1')).toBe(false)
    expect(opened.hidden.has('b1')).toBe(true)
    // opening one branch never hides something the closed fold had kept
    for (const id of ['a', 'b']) expect(opened.hidden.has(id)).toBe(false)
    expect(opened.hidden.size).toBeLessThanOrEqual(closed.hidden.size)
  })

  test('every visible node is one the document has', () => {
    const kg = map()
    const state = fold(kg)
    for (const id of state.hidden) expect(kg.graph.hasNode(id)).toBe(true)
    for (const v of state.virtual) {
      expect(kg.graph.hasNode(v.a)).toBe(true)
      expect(kg.graph.hasNode(v.b)).toBe(true)
      expect(state.hidden.has(v.a)).toBe(false)
      expect(state.hidden.has(v.b)).toBe(false)
    }
  })

  test('the same document and the same decisions give the same picture', () => {
    const one = fold(map(), ['a'])
    const two = fold(map(), ['a'])
    expect([...one.hidden].sort()).toEqual([...two.hidden].sort())
    expect(one.virtual.map((v) => `${v.a}|${v.b}|${v.label}`).sort()).toEqual(
      two.virtual.map((v) => `${v.a}|${v.b}|${v.label}`).sort(),
    )
  })
})
