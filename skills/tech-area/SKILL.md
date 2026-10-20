---
name: tech-area
description: Use when someone asks what a research area looks like, who leads it, or whether it is real — turns a field into a map of subjects, people, institutions and counts, not a list of links.
---

# Tech area

"Overview a tech area" is three different questions wearing one coat, and each has a shape:

| what was asked | what the graph answers with |
|---|---|
| *what is this field made of?* | 5–8 `subject` nodes, each with a one-sentence description, connected by what the papers share |
| *who is doing it?* | 10–20 `researcher` nodes, their `institution` nodes, `authored` and `works at` edges |
| *is it real, or is it a press release?* | a count with a filter and a date window, written as a property, plus the papers that carry it |

## Start with counts, not with records

A field is a shape before it is a reading list. Counts are the cheap way to see the shape:

- OpenAlex `group_by=publication_year` — is it growing, flat, or a spike from one lab?
- `group_by=authorships.institutions.id` — five institutions doing 80% of the work is a
  different field from one where nobody dominates.
- `group_by=primary_topic.id` — what the works are actually about, in the database's words, which
  is a useful check on the user's words.
- `filter=from_publication_date:2021-01-01` — a field with no recent work is history, not a
  technology.

Counts cost a fraction of a record search. Read them before buying anything.

## Then buy a few records

Fetch the top 10–20 by citations in the window, and the 5 newest. Those two sets are the field:
what it stands on, and where it is going. Anything else is coverage for its own sake.

## The honesty rules

- **A count is not a trend.** Say the window: "812 works since 2021, 61% from 2023–2025" is a
  trend; "812 works" is a number.
- **A big number is not importance.** Citations in a young field are low because the field is
  young; say the age rather than ranking against an older one.
- **Name the gap.** Funding, patents and company claims are not in OpenAlex. If the question was
  commercial viability, say plainly that the graph shows the science and not the market.
- **Never let a node carry a claim in its `desc` that its edges do not support.** "Leading lab"
  belongs on the edge counts, not in a sentence.

## When it becomes a company question

A `company` node is not a paper. It earns a place when it has a product, a trial, or a hiring
page, and the edge to a `subject` says what it is doing there. If the evidence is a press release,
the node carries `unverified=true` and the user can see that.
