import { useMemo, useState } from 'react'

type Props = {
  /** The path of the note as the folder has it, e.g. `docs/aging.md`. */
  name: string
  md: string
  onClose: () => void
}

/**
 * The notes beside the graph, in a panel of their own.
 *
 * A graph says what is connected to what; it does not say what any of it means, and for a field
 * being surveyed the meaning is most of the work. So the long form of a node's description is a
 * markdown file in the graph's own `docs/` folder, and this is where it is read.
 *
 * Reading works anywhere the page opens. **Writing** cannot work the same way, and it is worth
 * being plain about why: this page is opened as a file, and a browser refuses to write to the
 * reader's disk from a `file://` page. So the editor edits a copy, and the ways back to disk are
 * explicit — download it, copy it, or hand it to the agent that owns the folder and let it
 * write. That last one is the honest path for an agent-built graph: the file has an owner, and
 * the owner is not the browser.
 */
export default function DocPanel({ name, md, onClose }: Props) {
  const text = md
  const [saved, setSaved] = useState<string | null>(null)
  const path = name.startsWith('docs/') ? name : `docs/${name.endsWith('.md') ? name : `${name}.md`}`
  const html = useMemo(() => mdToHtml(md), [md])

  const download = () => {
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = path.split('/').pop() ?? 'note.md'
    a.click()
    URL.revokeObjectURL(url)
    setSaved('downloaded — put it back in the graph folder to keep it')
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setSaved('copied')
    } catch {
      setSaved('the browser refused to copy — select the text instead')
    }
  }

  return (
    <aside className="doc">
      <header>
        <code className="path">{path}</code>
        <div className="spacer" />
        <button
          className="off"
          disabled
          title="a page opened from a file cannot write to your disk. The agent holds the file: hand the note over and it edits docs/ itself. Copy or download it from here if you want it in hand."
        >
          edit
        </button>
        <button onClick={onClose}>×</button>
      </header>

      <>
          <div className="doc-body" dangerouslySetInnerHTML={{ __html: html }} />
          <footer>
            <span className="note">{saved ?? 'the file is the source of truth — this is a copy'}</span>
            <button onClick={copy}>copy</button>
            <button onClick={download}>download</button>
            {/* In the Hermes pane this arrives as a prompt; in a plain browser it is inert,
                which is why the other two buttons exist. */}
            <button
              className="agent"
              data-hermes-send={`Revise the note ${path} in this graph with what you have learned: keep it accurate, keep it short, and say where each claim comes from.`}
            >
              hand it to the agent
            </button>
          </footer>
      </>
    </aside>
  )
}

/**
 * Enough markdown to read a note: headings, lists, quotes, code, links and emphasis. Deliberately
 * not a library — the bundle is one file the user opens offline, and a full CommonMark parser is
 * more code than the viewer it lives in. Unknown syntax stays visible as text, which is the right
 * failure for a note: you can see what it says.
 */
function mdToHtml(md: string): string {
  const esc = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const blocks: string[] = []
  let rest = esc.replace(/```([\s\S]*?)```/g, (_m, code: string) => {
    blocks.push(`<pre><code>${code.replace(/^\n/, '').replace(/\n$/, '')}</code></pre>`)
    return `\u0000${blocks.length - 1}\u0000`
  })

  rest = rest
    .replace(/^######\s+(.*)$/gm, '<h6>$1</h6>')
    .replace(/^#####\s+(.*)$/gm, '<h5>$1</h5>')
    .replace(/^####\s+(.*)$/gm, '<h4>$1</h4>')
    .replace(/^###\s+(.*)$/gm, '<h3>$1</h3>')
    .replace(/^##\s+(.*)$/gm, '<h2>$1</h2>')
    .replace(/^#\s+(.*)$/gm, '<h1>$1</h1>')
    .replace(/^\s*---+\s*$/gm, '<hr/>')
    .replace(/^>\s?(.*)$/gm, '<blockquote>$1</blockquote>')
    // Ordered before unordered so `1. ` is not read as a bullet.
    .replace(/^\s*\d+\.\s+(.*)$/gm, '<li class="num">$1</li>')
    .replace(/^\s*[-*]\s+(.*)$/gm, '<li>$1</li>')
  rest = rest.replace(/(?:<li[^>]*>[\s\S]*?<\/li>\s*)+/g, (m) => `<ul>${m}</ul>`)

  rest = rest
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')

  const out = rest
    .split(/\n{2,}/)
    .map((chunk) => {
      const t = chunk.trim()
      if (!t) return ''
      if (/^<(h\d|ul|pre|blockquote|hr|li)/.test(t)) return t
      if (/^\u0000\d+\u0000$/.test(t)) return blocks[Number(t.slice(1, -1))]
      return `<p>${t.replace(/\n/g, ' ')}</p>`
    })
    .join('\n')
  return out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => blocks[Number(i)] ?? '')
}
