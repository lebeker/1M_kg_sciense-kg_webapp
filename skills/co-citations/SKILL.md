---
name: co-citations
description: Use when two works keep appearing side by side in the same reference lists and the map should say so — a weak, temporal signal, free to compute, never a substitute for a citation.
---

# Co-citations

Two papers are **co-cited** when a third paper cites both. Nothing about that says one built on
the other: it says the field reads them together. That is exactly why it is useful — it surfaces
a tangent the citation tree cannot, because the two works may never cite each other at all.

It is also the weakest relation on the map, and the only one that changes while nobody edits the
graph: as the literature grows, old pairs fade and new ones appear.

## Where they come from — and where they do not

There is no co-citation endpoint worth calling. Co-citation is **computed** from reference lists
you already have:

1. For the papers on the map, fetch their references (`referenced_works` from an OpenAlex record,
   or `/references/<doi>` from OpenCitations).
2. Drop references that are not already nodes — a co-citation to something off the map is a
   number, not an edge.
3. For every pair of on-map works appearing in the same reference list, count the citers.
   Two is a real signal; one is a coincidence.
4. Write one edge per pair:

   ```
   kg.py add-edge --graph <id> --from <a> --to <b> --rel co-cited --power 0.05 --set cocited=<n>
   ```

`co-cited` is declared `dir: none` (it has no direction), both ends `publication`, `style:
dotted`, and it is **muted by default** in the viewer. Keep it that way: nineteen hairlines on a
map read for its structure is noise, and one click in the legend brings them back when the
question is "what does this field read together".

## Strength, honestly

`cocited: n` is the number of works in the graph that cite both. Do not turn it into a percentage
of anything: there is no denominator that means the same thing across fields. `power` stays low
(0.05 by default) because co-citation must never out-shout a citation in width or in layout.

## When to use it

- **Finding a tangent**: two clusters that never cite each other but are constantly co-cited are
  either two schools of one field, or one field about to merge. Worth a look, worth a sentence in
  the report, not worth a claim.
- **Checking a grouping**: if the user says "these are two separate areas" and every paper in one
  is co-cited with papers in the other, the grouping is wrong.
- **Never**: as evidence that a paper influenced another, as a ranking of importance, or as a
  layout force. Citation edges are the skeleton; co-citation is a cloud around it.

## The gap to report

Reference lists are deposited by publishers unevenly. A missing co-citation is therefore *not*
evidence that the field does not read those two together — it may be a reference list nobody
deposited. Say that when the answer matters, and say how many of the graph's papers had reference
data at all ("co-citation computed from 14 of 22 papers; 8 have no deposited references").
