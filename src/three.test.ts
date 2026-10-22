import { readFileSync } from 'node:fs'
import { test, expect } from 'bun:test'

/** The source, not the bundle: inside the bundle the word also belongs to 3d-force-graph itself. */
const source = readFileSync(new URL('./ThreeView.tsx', import.meta.url), 'utf8')

// 0.0.49 drew a 1,817-node map and showed no visible node: a per-node `nodeOpacity` leaves the
// library's spheres transparent with no alpha, and the only thing left on screen was the halos.
test('the 3D view dims by colour, never by node opacity', () => {
  expect(/nodeOpacity\s*[(,]/.test(source)).toBe(false)
})

// A sphere is a world-space object: the camera frames the whole picture, so a fixed radius is a
// blob on a small map and three pixels on a big one.
test('node bodies are sized against the map, not by a constant', () => {
  const line = source.split('\n').find((l) => l.includes("set(g, 'nodeRelSize'"))
  expect(line).toBeTruthy()
  expect(line).toContain('spanOf')
})
