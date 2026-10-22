/**
 * Depth is a fact about the document before it is a fact about the 3D view.
 *
 * The rule these tests hold: an author who writes `z` gets `z`; an author who writes `level`
 * gets a tilt scaled to the picture; an author who writes neither gets gravity by `weight`.
 * The bug that made this a test file: a fixed 60 units per level against a 2,238-unit wide map.
 *
 *   bun test src/depth.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { toForceGraph } from './adapters/forceGraph'
import { toKg } from './kg'

const depthOf = (kg: ReturnType<typeof toKg>) =>
  Object.fromEntries(
    toForceGraph(kg).nodes.map((n) => [n.id, Math.round((n.z ?? 0) * 100) / 100]),
  )

describe('z', () => {
  test('a node that states z keeps it, whatever its level says', () => {
    const kg = toKg({
      nodes: [
        { id: 'a', kind: 'subject', level: 2, z: -12 },
        { id: 'b', kind: 'publication', level: 3 },
      ],
      edges: [{ from: 'b', to: 'a', label: 'about' }],
    })
    expect(depthOf(kg).a).toBe(-12)
  })

  test('without z, levels are spread across the picture, not 60 units each', () => {
    const kg = toKg({
      nodes: [
        { id: 'a', kind: 'subject', level: 2, x: 0, y: 0 },
        { id: 'b', kind: 'subject', level: 2.5, x: 1000, y: 0 },
        { id: 'c', kind: 'publication', level: 3, x: 2000, y: 500 },
      ],
      edges: [
        { from: 'b', to: 'a', label: 'subset of' },
        { from: 'c', to: 'b', label: 'about' },
      ],
    })
    const z = depthOf(kg)
    // The picture spans 2000 in x; depth follows it (35%) instead of a constant per level.
    expect(Math.abs(z.a)).toBe(0)
    expect(z.c).toBeCloseTo(-700, 0)
    expect(z.b).toBeCloseTo(-350, 0)
  })

  test('with neither z nor level, weight tilts the same map — inside its own span', () => {
    const kg = toKg({
      nodes: [
        { id: 'a', kind: 'x', weight: 1, x: 0, y: 0 },
        { id: 'b', kind: 'x', weight: 9, x: 1000, y: 0 },
      ],
      edges: [{ from: 'b', to: 'a', label: 'related' }],
    })
    const z = depthOf(kg)
    expect(Math.abs(z.a)).toBeLessThanOrEqual(350)
    expect(Math.abs(z.b)).toBeLessThanOrEqual(350)
    expect(z.a).toBeGreaterThan(z.b)
  })
})
