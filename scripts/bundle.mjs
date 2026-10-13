#!/usr/bin/env node
/**
 * Copy the built single-file viewer into a skill repo.
 *
 *   npm run build
 *   node scripts/bundle.mjs ../some-skill-repo
 *
 * The viewer is copied, never symlinked: the skill has to work on its own,
 * from a clone, with no build step and no access to this repo.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const target = process.argv[2]
if (!target) {
  console.error('usage: node scripts/bundle.mjs <skill-repo-dir>')
  process.exit(2)
}

const root = resolve(import.meta.dirname, '..')
const built = join(root, 'dist', 'index.html')
if (!existsSync(built)) {
  console.error('dist/index.html missing — run the build first')
  process.exit(2)
}

const dest = resolve(target)
if (!existsSync(dest) || !statSync(dest).isDirectory()) {
  console.error(`not a directory: ${dest}`)
  process.exit(2)
}

const assets = join(dest, 'assets')
mkdirSync(assets, { recursive: true })
copyFileSync(built, join(assets, 'viewer.html'))

// Record where this viewer came from. The skill ships no viewer of its own, so the copy
// in `assets/` has to be able to say which app it is, which build, and where to fetch a
// newer one — `kg.py apps` reads this sidecar and prints it.
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const git = (args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}
const origin = git(['remote', 'get-url', 'origin'])
  .replace(/^git@([^:]+):/, 'https://$1/')
  .replace(/\.git$/, '')
const stamp = {
  name: pkg.name,
  version: pkg.version,
  built_at: new Date().toISOString(),
  origin,
  commit: git(['rev-parse', '--short', 'HEAD']),
  bytes: statSync(built).size,
  // Where a graph can get this viewer from without building anything. `kg.py new` copies
  // this into `meta.app_url`, so a graph carries the way to render itself.
  fetch_url: `https://raw.githubusercontent.com/${origin.replace('https://github.com/', '')}` +
    `/viewer-v${pkg.version}/viewer.html`,
}
writeFileSync(join(assets, 'viewer.version'), JSON.stringify(stamp, null, 2) + '\n')

console.log(`viewer.html (${stamp.bytes} bytes) -> ${join(assets, 'viewer.html')}`)
console.log(`  ${stamp.name} ${stamp.version} ${stamp.commit} from ${origin || '(no origin remote)'}`)
