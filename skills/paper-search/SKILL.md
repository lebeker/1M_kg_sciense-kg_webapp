---
name: paper-search
description: Use when someone names a topic, a person or a lab and wants the literature around it — finds real papers with real identifiers, at the cheapest source that has them.
---

# Paper search

The job is not "return ten links". It is: put papers on the map with an identifier that survives
being copied into another tool, attached to the person or the subject they belong to.

Read `kg` first. This skill chooses the source and the shape; `add-node` and `add-edge` do the rest.

## Which source, for which question

| the question | source | why | cost |
|---|---|---|---|
| "what has this person published" | OpenAlex `authors?search=` then `works?filter=author.id:` | authors are entities with an id, not name strings | 1 credit/record |
| "the newest work on X" | **arXiv** `export.arxiv.org/api/query?search_query=…` | free, preprints, days-old | free |
| "the established literature on X" | **Crossref** `works?query.bibliographic=…` | free, publisher metadata, real venues | free |
| "what matters most on X", "who leads it" | OpenAlex `group_by` + top records | counts across the field, not a page of results | cheap counts, then a few records |
| "grey literature, standards, lab pages, company claims" | web search | the only place it exists | free |

A name is not an identity. Two people called J. Smith are two authors; resolve through OpenAlex
`authors?search=` and check the ORCID or the affiliation before attaching a paper to a person.

## What goes into the graph

- one `publication` node per paper — **always** with `doi` or `arxiv` in a property, and `year`.
  A node without an identifier is a rumour; if it came from a web page, mark it
  `--set unverified=true`.
- `about` from the paper to the subject it addresses, `authored` from the paper to the person —
  both declared relations, both checked by `validate`.
- the subject itself as a `subject` node, described in one sentence. If the user's words name
  three different things ("longevity" as a field, as a lifespan, as a market), that is three
  nodes or one node with a description that says which one this map means.

## Do not

- do not invent a citation count; if a number came from a source, keep the source in the property
  name (`openalex_cited_by: 412`), not a bare `citations: 412`.
- do not paste an abstract into `desc`. `desc` is one sentence saying what the work showed, in
  the user's language — the abstract is in the source and can be re-fetched.
- do not add fifty papers when the question was "what is this field". Ten papers that define the
  field, twenty that show its edges, and a count for the rest (`works: 8,412`) is a better map.

## Reporting

State the source per group of papers, and the identifier you resolved for the person. If the
search returned nothing, say which query and which source — an empty result from arXiv is a fact
about arXiv, not about the field.
