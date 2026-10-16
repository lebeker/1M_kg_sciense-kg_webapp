#!/usr/bin/env node
/**
 * Publish the built single-file viewer, so anyone can download it without node or bun.
 *
 *   bun run build:local && bun run release
 *
 * It goes to two places, for two different readers:
 *
 *   the tag     https://raw.githubusercontent.com/<repo>/viewer-v<version>/viewer.html
 *               immutable, readable with one `curl`, no auth — this is the URL the skill
 *               documents and `kg.py fetch-viewer` uses
 *   the release the same file as a release asset, with a page a human can find
 *
 * The release needs `gh` to be authenticated (`gh auth login`). The tag does not, so a
 * machine without gh still ships a downloadable viewer.
 *
 * The `dist` branch is written with git plumbing, never by checking it out: switching a
 * worktree to an orphan branch drops every untracked file on the way back, which is a
 * stupid way to lose a node_modules.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const built = join(root, 'dist', 'index.html')

const fail = (msg) => {
  console.error(msg)
  process.exit(1)
}

if (!existsSync(built)) fail('dist/index.html is missing — run `bun run build:local` first')
const manifest = join(root, 'app.json')
if (!existsSync(manifest)) fail('app.json is missing — it is the app\'s own declaration')

const git = (args, opts = {}) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', ...opts }).trim()

if (spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root }).status !== 0) {
  fail('not a git repository')
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const tag = `viewer-v${pkg.version}`
const sourceSha = git(['rev-parse', '--short', 'HEAD'])
const branch = git(['branch', '--show-current'])
// Provenance travels with the artifact: `kg.py apps` reads this and prints it.
const origin = git(['remote', 'get-url', 'origin'])
  .replace(/^git@([^:]+):/, 'https://$1/')
  .replace(/\.git$/, '')
// owner/repo — what raw.githubusercontent and the release URLs want
const slug = origin.replace(/^https:\/\/github\.com\//, '')
const stamp = {
  name: pkg.name,
  version: pkg.version,
  built_at: new Date().toISOString(),
  origin,
  commit: sourceSha,
  bytes: statSync(built).size,
  fetch_url: `https://raw.githubusercontent.com/${slug}/${tag}/viewer.html`,
}

const stampFile = join(tmpdir(), `kg-viewer-${process.pid}.version`)
writeFileSync(stampFile, JSON.stringify(stamp, null, 2) + '\n')

// --- build the dist commit without touching this worktree -------------------
const index = join(tmpdir(), `kg-dist-index-${process.pid}`)
rmSync(index, { force: true })
const env = { ...process.env, GIT_INDEX_FILE: index }
const blobFor = (file) => git(['hash-object', '-w', file], { env })
git(['update-index', '--add', '--cacheinfo', `100644,${blobFor(built)},viewer.html`], { env })
git(['update-index', '--add', '--cacheinfo', `100644,${blobFor(stampFile)},viewer.version`], { env })
// The declaration is published beside the artifact, so `kg.py fetch-app` can install the
// viewer and what-it-needs in one step.
git(['update-index', '--add', '--cacheinfo', `100644,${blobFor(manifest)},app.json`], { env })
const tree = git(['write-tree'], { env })
rmSync(index, { force: true })

let parent = ''
try {
  parent = git(['rev-parse', '--verify', `refs/heads/dist`])
} catch {
  parent = ''
}
// A tag names a version, and a published version is a thing people have already downloaded.
// If this one exists at a different commit, the version in package.json was not bumped, and
// saying so out loud is the difference between a release and an overwrite.
let moved = ''
try {
  const old = git(['rev-parse', '--verify', `refs/tags/${tag}`])
  moved = git(['rev-parse', '--short', old])
} catch {
  moved = ''
}
const message = `viewer v${pkg.version} — the built single-file viewer, no node needed to use it

Built from ${sourceSha} on ${branch}. The source lives there; this branch carries only
the artifact, so it can be downloaded as a plain file.`
const commit = git(
  ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message],
)
git(['update-ref', 'refs/heads/dist', commit])
git(['tag', '-f', tag, commit])
rmSync(stampFile, { force: true })

console.log(`dist branch -> ${commit.slice(0, 7)}  (viewer.html, viewer.version, app.json)`)
console.log(`tag         -> ${tag}  (built from ${sourceSha})`)
if (moved) {
  console.log(
    `\nwarning: ${tag} already existed at ${moved} and is being moved to ${commit.slice(0, 7)}.\n` +
      '         A tag is meant to be a version nobody changes underneath them: bump the\n' +
      '         version in package.json when publishing again.',
  )
}

const push = (what) => {
  const r = spawnSync('git', ['push', '-f', 'origin', what], { cwd: root, encoding: 'utf8' })
  if (r.status !== 0) fail(`push of ${what} failed:\n${r.stderr || r.stdout}`)
}
push('dist')
push(tag)
const raw = `https://raw.githubusercontent.com/${slug}/${tag}/viewer.html`
console.log(`\npublished:\n  ${raw}\n  https://raw.githubusercontent.com/${slug}/${tag}/app.json`)

// --- the release, if gh can do it -----------------------------------------
const authed = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' }).status === 0
if (!authed) {
  console.log(
    '\nno GitHub release: `gh` is not authenticated. The tag above is already ' +
      'downloadable.\nRun `gh auth login`, then `bun run release` again for a release ' +
      'with the file attached.',
  )
  process.exit(0)
}

const existing = spawnSync('gh', ['release', 'view', tag], { cwd: root, encoding: 'utf8' })
const asset = `${built}#viewer.html`
const ghArgs = existing.status === 0
  ? ['release', 'upload', tag, asset, '--clobber']
  : ['release', 'create', tag, asset, '--title', `Viewer v${pkg.version}`,
    '--notes', `Single-file kg viewer, built from ${sourceSha} on ${branch}.\n\n` +
      'Download `viewer.html` and drop it in the skill\'s `assets/`, or:\n\n' +
      '```\nkg.py fetch-viewer --url ' +
      `https://github.com/${slug}/releases/download/${tag}/viewer.html\n\`\`\``]
const r = spawnSync('gh', ghArgs, { cwd: root, stdio: 'inherit' })
if (r.status !== 0) fail('gh failed — the tag is still downloadable')
console.log(
  `\nrelease asset:\n  https://github.com/${slug}/releases/download/${tag}/viewer.html`,
)
