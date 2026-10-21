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

// The app's own declaration travels with it. This is the file that says what the app is
// for, what it needs in order to be useful, and which node kinds and edges a graph for it
// should be made of — so a skill can match a user's ask to an app, and then build the
// graph to the app's conventions instead of inventing its own.
const manifest = join(root, 'app.json')
if (existsSync(manifest)) copyFileSync(manifest, join(assets, 'viewer.app.json'))
else console.warn('app.json is missing — the skill will fall back to its own catalogue')

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
  // this into `meta.app_url`, so a graph carries the way to render itself. The declaration
  // (`app.json`) is deliberately not tag-pinned: it says what the app is for, which does
  // not change when the build does, and it stays readable at `main`.
  fetch_url: `https://raw.githubusercontent.com/${origin.replace('https://github.com/', '')}` +
    `/viewer-v${pkg.version}/viewer.html`,
  manifest_url: `https://raw.githubusercontent.com/${origin.replace('https://github.com/', '')}` +
    `/main/app.json`,
}
// The app catalogue names the tag the skill will fetch. It is written here, next to the viewer,
// because a catalogue that points at last week's tag is an app that silently does not match.
const appsPath = join(target, 'scripts', 'apps.json')
if (existsSync(appsPath)) {
  const apps = JSON.parse(readFileSync(appsPath, 'utf8'))
  const repo = (origin || 'https://github.com/lebeker/1M_kg_sciense-kg_webapp')
    .replace('https://github.com/', 'https://raw.githubusercontent.com/')
  const fresh = `${repo}/viewer-v${pkg.version}/viewer.html`
  // The declaration travels with the catalogue: what the app requires, what it suggests and
  // where its skills live. A graph asks `check` what it needs, and `check` reads the catalogue
  // — so a catalogue that drifted from app.json is a check that answers for an app that no
  // longer exists.
  const decl = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'))
  let touched = 0
  for (const app of Object.values(apps.apps ?? {})) {
    if (app?.id !== decl.id) continue
    for (const k of ['requires', 'recommends', 'tool_notes', 'levels', 'level_note']) {
      if (decl[k] !== undefined) app[k] = decl[k]
    }
    app.skills_url = `${repo}/main/skills`
    touched++
  }
  for (const app of Object.values(apps.apps ?? {})) {
    if (typeof app?.url === 'string' && app.url.includes('/viewer-v')) {
      app.url = fresh
      touched++
    }
  }
  if (touched) writeFileSync(appsPath, JSON.stringify(apps, null, 2) + '\n')
}

writeFileSync(join(assets, 'viewer.version'), JSON.stringify(stamp, null, 2) + '\n')

console.log(`viewer.html (${stamp.bytes} bytes) -> ${join(assets, 'viewer.html')}`)
console.log(`viewer.app.json -> ${join(assets, 'viewer.app.json')}`)
console.log(`  ${stamp.name} ${stamp.version} ${stamp.commit} from ${origin || '(no origin remote)'}`)
