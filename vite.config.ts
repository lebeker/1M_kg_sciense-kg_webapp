import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

/**
 * Two builds, because the two targets want opposite things.
 *
 *   vite build              -> dist/       one self-contained index.html.
 *                              Everything is inlined (singlefile sets
 *                              codeSplitting:false), because the skill ships a
 *                              single file that must open from file://.
 *   KG_BUILD=multi vite build -> dist-multi/  normal code-split output for the
 *                              hosted app. 3d-force-graph + three land in their
 *                              own chunk and are only fetched when 3D is used.
 *
 * Lazy loading and single-file output are mutually exclusive in one build; this
 * is the smallest honest way to keep both.
 */
export default defineConfig(() => {
  const multi = process.env.KG_BUILD === 'multi'

  return {
    // relative base so the built file works from file:// and from any subpath
    base: './',
    plugins: multi ? [react()] : [react(), viteSingleFile()],
    build: {
      outDir: multi ? 'dist-multi' : 'dist',
      emptyOutDir: true,
      target: 'es2020',
      modulePreload: { polyfill: false },
      ...(multi ? {} : { cssCodeSplit: false, assetsInlineLimit: Number.MAX_SAFE_INTEGER }),
    },
  }
})
