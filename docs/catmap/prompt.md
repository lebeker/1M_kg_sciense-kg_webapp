# The brief, and the queries behind the map

## What was asked

> Draw a category map of longevity research for engineers, researchers and investors, so they can
> decide which zones are promising, undervalued or underexplored. Longevity research means the work
> that aims to bend the lifespan curve and reach longevity escape velocity: not only biology and
> medicine, but the things that would speed the research itself up (modelling, trial machinery),
> the screens and diagnostics that find points of no return, and the tech that would let a person
> leave the substrate — cryopreservation, brain interfaces.

Three clauses carry the whole result:

- **"category map", not "review"** — the deliverable is a partition of the field, not a
  bibliography. Every node is a shelf somebody could put a paper on.
- **"so they can decide"** — the reader and the decision are named. That is what turns 110 shelves
  into 110 judgements about where to spend attention. Without it you get an outline.
- **the boundary** — it says what is inside the field *besides* biology. Drop that sentence and the
  map becomes a geroscience map with five empty shelves; keep it and translation, accelerants and
  preservation become first-class functions.

## How the ask became a corpus

Six functions (`mechanism`, `measurement`, `interventions`, `translation`, `accelerants`,
`escape`) → 26 groups → 78 classes. **Each class is one OpenAlex request, and the class's own
vocabulary is the query.** That is the whole reproduction recipe — there is nothing else to a
rebuild but the class list:

```
filter = title.search:(<the class's own terms>)
       & title_and_abstract.search:(aging OR ageing OR longevity OR geroscience OR healthspan OR lifespan)
       & publication_year:2018-2026
       & type:article|review|preprint
sort   = cited_by_count:desc, per_page 40, top 20 kept
```

Title search, not abstract: an abstract search for "exercise" returns COVID papers. The aging
context in the abstract stops a class's vocabulary being spent by the neighbouring field — without
it `motor-prosthetics` returned *Attention Is All You Need*.

## Eight of the 78 shelves, as queries

The corpus kept each class's terms, not the request strings; a class sends its own vocabulary.

| shelf | the title terms | works carrying them |
|---|---|---|
| `diet` | diet OR nutrition OR "caloric restriction" | 52,800 |
| `sleep` | sleep | 41,200 |
| `exercise` | exercise OR "physical activity" | 32,500 |
| `senolytics` | senolytic OR senolytics OR "senescent cell clearance" | 1,200 |
| `rapamycin-mtor` | rapamycin OR sirolimus OR mTOR | 900 |
| `methylation-clocks` | "epigenetic clock" OR "DNA methylation age" | 600 |
| `xenotransplant` | xenotransplant OR xenotransplantation | 0 |
| `self-driving-labs` | "self-driving laboratory" OR "automated laboratory" | 0 |

Those eight lines are the map's thesis in one table: the three lifestyle shelves are three orders
of magnitude bigger than the molecular ones, and the two frontier shelves have no literature at
all in 2018–2026.

## What not to ask

- **"Make me a graph of longevity."** You get a bibliography: `publication` nodes outnumbering
  categories ten to one, and no shelves to judge.
- **"Include everything."** The roots stop being a partition and start being a list; a reader can
  no longer say where a new paper belongs.
- **"Use the twelve hallmarks of aging as the shelves."** That is one mechanism frame, and this map
  cuts by function. The hallmarks land as classes inside `mechanism` — 0 of 12 at shelf level, 7
  buried, 5 absent; `coverage` measures exactly that, and it is a finding, not a defect.

## Where the answer lives

`meta.brief` holds the question in one sentence. The report answers it and cites a node per claim.
`method.md` carries the machinery, `sources.md` every request and its cost, `coverage.md` the
shelves measured against an outside frame, and the last section of the report prices the four gaps
rather than apologising for them.
