---
name: citations
description: Use when a graph needs to show who cites whom — adds citation edges between papers, from a free source first, and says what it could not get.
---

# Citations

A citation edge is a claim that one work built on another. It is the firmest relation a research
graph can carry, so it deserves a source that actually holds the pair, not an inference from two
titles looking related.

Read the `kg` skill first: this skill only decides **where the edges come from**. Writing them is
`add-edge`.

## Sources, in this order

| order | source | costs | gives | fails like |
|---|---|---|---|---|
| 1 | **OpenCitations** — `https://opencitations.net/index/api/v1/citations/<doi>` and `/references/<doi>` | free, no key | citing and cited DOIs, with a creation date per link | 404 for a DOI it has never indexed; follow redirects (`curl -L`) |
| 2 | **OpenAlex** — `works?filter=doi:<doi>` (`referenced_works`, `cited_by_api_url`) | 1 credit per record, 10 per search (~$0.0001 / $0.001) | the same links plus full metadata | a paid call that drops mid-flight may already be billed |
| 3 | **Semantic Scholar** — `graph/v1/paper/DOI:<doi>/citations?fields=title,year,externalIds&limit=100` | free, shared pool | citations with titles, so no second fetch | **429 without a key** — back off, do not hammer |
| 4 | **Crossref** | free | metadata; citing lists only where a publisher deposited references | often empty of links |

Use 1, fall to 2 when 1 has no record, and use 3 only when you need titles cheaply. A count is not
a link: `cited_by_count: 412` from Crossref or OpenAlex must never become 412 edges.

## The procedure

1. **Resolve the target to a DOI.** An OpenAlex work id, an arXiv id, or a bare title is not one.
   No DOI → say so and stop for that paper; do not guess a match by title.
2. **Fetch both directions** for each paper already in the graph:
   - who cites it (`/citations/<doi>`),
   - what it cites (`/references/<doi>`).
3. **Keep only what belongs on the map**: a citing work is usually off-topic. Add it as a node
   only when the user asked for the citation neighbourhood, or when it is already a node. A
   citation edge with a dangling end is not written.
4. **Dedupe by DOI** before writing. Two spellings of the same paper are one node; `10.1038/…`
   and `https://doi.org/10.1038/…` are the same DOI.
5. **Write**:

   ```
   kg.py add-node  --graph <id> --id <slug> --label "<title>" --kind publication \
                   --desc "<one sentence: what it showed>" --set doi=<doi> --set year=<year>
   kg.py add-edge  --graph <id> --from <citing> --to <cited> --rel cites
   kg.py validate  --graph <id>
   ```

   `cites` is declared with `dir: in` (the arrow points at the cited work) and both ends
   `publication`; if it is not declared in this graph, declare it before the first edge.
6. **Report the shape**, not the effort: "added 34 citations for 6 papers, 12 citing works were
   out of scope and were not added, 2 DOIs had no record and are missing".

## Money and failure

- Price a batch before running it: N papers × (citations + references). Say the number out loud
  if the user is on a metered source.
- **A disconnected paid call is not a failed call.** Do not retry it: the request may have been
  served and billed. Switch source and note the switch.
- On 429 (Semantic Scholar) wait, or use another source; never loop.
- Whatever you could not fetch goes into the report by name. "The graph has 34 of ~70 citations
  because OpenCitations does not index this journal" is a useful answer; a silent half-graph is
  not.

## Cap

Default: at most 200 citing works per paper, and only papers already on the map by default. More
is a decision the user makes, not a default an agent takes.
