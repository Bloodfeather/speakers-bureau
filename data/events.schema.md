# data/events.schema - how to add an event

`data/events.json` is the file you edit to change the events calendar. This
document is the written contract for it.

**There is no script that writes this file.** That is what separates it from
`data/articles.json`, which `scripts/fetch-feeds.mjs` regenerates on a schedule.
Events are entered by a person, or by an AI assistant working from this
document. Everything below exists because a hand- or model-written field can be
wrong in a way that still renders a page that looks finished.

---

## 1. THE ONE COMMAND

```
npm run events:check
```

Run it after every edit, before you build. It prints every problem in the file at
once, with the path of the offending row.

| Exit | Meaning |
| --- | --- |
| 0 | valid |
| 1 | invalid data, or an image the data references does not exist |
| 2 | bad arguments, or the file is missing / unreadable / not JSON |

`npm run build` applies **the same rules** and fails the build if any of them are
broken. There is no path by which a broken file produces a page.

### Save the file as UTF-8 WITHOUT a byte order mark

This one is worth stating on its own, because it is invisible and it is the
default on this machine.

Windows PowerShell 5.1's `Out-File -Encoding utf8` **and** Notepad both write a
BOM. `JSON.parse` rejects a leading one, and the resulting error points at the
opening brace with a message about an "unexpected token" - which sends you
looking for a JSON syntax error that is not there. It was found by a probe that
happened to write its scratch file that way.

`npm run events:check` strips a BOM and carries on, and a test asserts the
committed file has none. But if you edit `data/events.json` with a tool that adds
one, save it without.

---

## 2. THE SHAPE OF THE FILE

```json
{
  "reviewedOn": "2026-10-05",
  "events": [ { ... }, { ... } ],
  "pageNote": {
    "heading": "...",
    "paragraphs": [ "...", "..." ]
  }
}
```

- `reviewedOn` - optional, `YYYY-MM-DD`. The date a human last checked this list.
  See section 7.
- `events` - required, an array, and it must not be empty.
- `pageNote` - **optional**. A block of prose rendered under the calendar. See
  section 2b.

Any other top-level key is a hard error with a spelling suggestion, so a typo
cannot be silently ignored.

---

## 2b. `pageNote`: PROSE THAT IS NOT AN EVENT

Some things belong on an events page and are not events. The current example is
"ongoing campaign activity", which has no date because it is not a thing that
happens on a day.

**Do not fake it as an event with an invented date.** That would put undated prose
onto a calendar of real election dates, and a reader would reasonably believe it
has a date it does not have.

```json
"pageNote": {
  "heading": "Ongoing campaign activity in the Upstate",
  "paragraphs": [
    "One paragraph of running prose.",
    "Another paragraph."
  ]
}
```

| Rule | |
| --- | --- |
| `heading` | required, non-empty, max 120 characters |
| `paragraphs` | required, an array of **strings**, min 1, max 900 characters each |
| unknown keys inside `pageNote` | hard error, with a spelling suggestion |

Three rules here exist to stop a specific silent failure:

- **`paragraphs` must be an array, even for one paragraph.** A bare string is
  rejected. The block is meant to grow.
- **An empty `paragraphs` array is rejected.** A heading with nothing under it
  renders as a section header over blank space, which on a finished page reads as
  a decision rather than a bug. To have no note at all, **omit the whole
  `pageNote` key** or set it to `null` - both are valid and render nothing.
- **Unknown keys are rejected.** `paragraph` instead of `paragraphs` would
  otherwise render a heading and a rule with no words under them.

The page reads this block; it does not hardcode the prose. A test fails if the
campaign text ever appears in the page source instead.

---

## 3. ONE EVENT, FULLY ANNOTATED

```json
{
  "id": "governor-debate",
  "name": "SC Governor Debate",
  "event": "Alan Wilson (R) and Jermaine Johnson (D) meet in the televised debate for the governor of South Carolina.",
  "startsAt": "2026-10-06T19:00",
  "endsAt": null,
  "allDay": false,
  "timezone": "Eastern Time (ET)",
  "location": "WIS Studios, Columbia",
  "type": "Debate",
  "thumbnail": "/img/events/governor-debate-thumb.svg",
  "banner": "/img/events/governor-debate-banner.svg",
  "url": null,
  "notes": "Starts at 7:00 pm and is streamed live by WIS."
}
```

`url`, `notes`, `thumbnail`, `banner` and `endsAt` are optional and may be `null`
or omitted. The calendar is built to render without any of them, and events in the
current data do: three have no `url`, because a real event with no published page
is more honest than one with a fabricated link.

### A NOTE ON `endsAt`, WHICH DOES TWO DIFFERENT JOBS

| `allDay` | `endsAt` means | renders as |
| --- | --- | --- |
| `false` | a **clock time** on the same or another day | `7:00 pm - 9:00 pm` |
| `true` | the **last day** of a multi-day span | `15 - 31 October 2026` |

The all-day case is how early voting is expressed: `"startsAt": "2026-10-15"`,
`"endsAt": "2026-10-31"`, `"allDay": true`. Both dates must be plain
`YYYY-MM-DD`. A span is only meaningful between two all-day dates - a timed pair
never renders as a span, because `18:30 - 31 October 2026` reads as nonsense.

**The calendar grid marks only the FIRST day of a span.** Early voting appears on
15 October; the 16th to the 31st look like ordinary empty days. The full range is
in the panel and in the list. This is a known limitation, recorded in ROADMAP.md.

---

## 4. EVERY FIELD

| Field | Required | Max | Rule |
| --- | --- | --- | --- |
| `id` | yes | 60 | lowercase kebab-case: letters, digits, single hyphens. Must be unique. Becomes the row's DOM id and its anchor. |
| `name` | yes | 120 | the event's name, shown as the row headline |
| `event` | yes | 400 | what the event IS: one or two sentences. Not the name again. |
| `startsAt` | yes | 19 | local wall clock, `YYYY-MM-DDTHH:MM`. See section 5. |
| `endsAt` | no | 19 | same format. Must not be earlier than `startsAt`. |
| `allDay` | no | 5 | `true` or `false`. See section 6. |
| `timezone` | yes, unless `allDay` | 40 | the venue's own zone as a label, e.g. `"Eastern Time (ET)"`. |
| `location` | yes | 200 | a venue, a street address, or `"Online"`. |
| `type` | yes | 20 | exactly one of the seven values in section 8. Case-sensitive. |
| `thumbnail` | no | 200 | root-relative path under `/img/`, e.g. `/img/events/foo-thumb.svg`. |
| `banner` | no | 200 | root-relative path under `/img/`, e.g. `/img/events/foo-banner.svg`. |
| `url` | no | 500 | absolute `http` or `https` URL. A registration page, normally. |
| `notes` | no | 600 | extra detail, shown in the panel. |

**Any key not in this table is rejected.** This is deliberate. A misspelled
`loction` would otherwise be silently ignored, the build would be green, and the
calendar would show a row with no venue - a page that looks finished and is
wrong. The error names the field you probably meant:

```
[unknown-key] "loction" is not a field of an event. Did you mean "location"?
```

---

## 5. DATES: LOCAL WALL CLOCK, NEVER A UTC OFFSET

`startsAt` is the time **at the venue**. `"2026-11-14T18:30"` means 6:30pm at
that venue, and it is printed back exactly as written.

**Do not write `Z`, and do not write `+05:00` or `-05:00`.** Those are rejected:

```
[timestamp-has-offset] events[2].startsAt must be a LOCAL wall clock with no "Z"
and no +HH:MM offset, got "2026-11-14T18:30:00-05:00". A venue event is stored in
the venue's own clock time; store the plain local time and put the zone in the
timezone field.
```

The reason is worth one paragraph, because the rejection looks fussy. The file
deliberately does not store the absolute instant - there is no way to derive it
from a wall clock without doing daylight-saving arithmetic, and a spring-forward
morning is a time that does not exist. So the value is the venue's clock reading,
full stop. Had an offset been accepted, the renderer - which reads the digits
back so that no build machine's timezone can shift them - would have printed
`11:30 pm` for a 6:30pm debate. A correct instant, the wrong event, and nothing
red. Hence: the zone goes in `timezone` as words a reader can read.

**A timed event with no `timezone` is rejected.** A clock time with no stated
zone is a question the page cannot answer for the reader.

`allDay` events take `timezone: null`.

Dates must be real: `2026-02-30` and `2026-11-14T25:00` are both rejected.
`2024-02-29` is accepted; `2026-02-29` is not, because 2026 is not a leap year.

---

## 6. ALL-DAY EVENTS

An event with no clock time - election day being the obvious one - sets
`allDay` and drops the time from `startsAt`:

```json
{
  "id": "election-day",
  "startsAt": "2026-11-03",
  "allDay": true,
  "timezone": null
}
```

The two must agree. `"allDay": true` with a time in `startsAt` is rejected, and
so is a bare date without `allDay: true` - otherwise an omitted time would
quietly render as midnight, which is a fabricated fact.

---

## 7. `reviewedOn`, AND WHY THE PAGE NEVER ASKS WHAT DAY IT IS

The page splits the calendar into "Already held" and "Upcoming". It does **not**
call `new Date()` to decide, because a build that renders "today" differently
depending on the day it ran would produce different HTML from the same commit on
two machines. Instead the split is drawn at `reviewedOn`, a date a human puts in
the file.

So: **bump `reviewedOn` to today when you review the list**, and expect anything
before it to move into "Already held". An event ON the reviewed date counts as
upcoming, because that day has not finished. If `reviewedOn` is absent, no split
is made and everything renders in one chronological list.

---

## 8. TYPES: A CLOSED LIST, ON PURPOSE

```
Election   Debate   Forum   Meeting   Rally   Fundraiser   Workshop   Lecture
```

These render as filter chips. Free text fragments over time - "Keynote",
"keynote", "Keynote Address" - and a filter offering four near-identical chips is
worse than no filter, because it implies a distinction the data does not make.
An unknown type is a loud failure that prints the whole allowed list.

Matching is **case-sensitive**: `forum` is rejected, `Forum` is correct.

**Order matters.** The list above is the order a filter row renders in. Put a new
entry where a reader would expect it relative to the existing groups rather than
appending it to the end.

**To add a genuine one-off**, make it a deliberate two-place edit:

1. add it to `EVENT_TYPES` in `src/lib/events-schema.ts`
2. add it to the list above (this section)

Both, in the same change. The point is that this cannot be done by accident while
filling in forty rows.

Note `Lecture` is singular while the original brief said "Lectures"; the other seven
were singular, and a chip reading "Lectures" is a grammar error in a filter row.
One-word revert if that was not the intent.

`Meeting` was added when the real events replaced the placeholders. A party
quarterly meeting is a scheduled gathering, not a moderated Q&A, and the chip is
the first thing a reader scans - filing it under `Forum` would make a filter lie
about its contents. It is the first time the vocabulary was actually extended, so
it is the worked example of the two-place edit above.

---

## 9. IMAGES

- Put files in `public/img/events/`. A path in the data is `/img/` plus that
  directory, so `public/img/events/foo.svg` is written `/img/events/foo.svg`.
- Naming convention: `<id>-thumb.svg` and `<id>-banner.svg`.
- **No photographs exist for the real events yet**, so `npm run events:placeholders`
  generates a **typographic placeholder** for each: a warm plate carrying the event
  name, the date, and the word `PLACEHOLDER`. It is a plate of type, not a
  photograph pretending to be one.
- **Replacing one is a two-step job.** Put the real image in place and update the
  path, then re-run `npm run events:check`. The generator **refuses to overwrite an
  existing file**, so a real photograph survives someone re-running it. Its
  `--force` flag will destroy real artwork; there is almost never a reason to use it.
  The generator also skips any path that does not end in `.svg`, so a `.jpg` is
  never at risk.
- **Real photography is welcome and is the point** - drop in `.jpg` or `.png` and
  update the path to match.
- **Placeholders do not follow the site's theme.** An SVG loaded through `<img>` is
  an isolated document and cannot read the page's CSS custom properties, so the
  civic palette is baked in. This is correct and not a defect: a real photograph
  would not follow the theme either.
- Aspect ratios the layout is built around: thumbnail **3:2** (the generated files
  are 480x320), banner **8:3** (1600x600). Both are cropped by CSS with
  `object-fit: cover`, so a different ratio still renders - it will just crop more.
- Both are optional. An event with neither renders as a complete row, and its
  panel shows a framed notice saying no banner was supplied. That is deliberate:
  the frame keeps its height so the panel does not jump when the reader selects a
  different date.
- A path that does not resolve to a real file is a **build-time failure**, caught
  by `npm run events:check`. A 404 image on a page about dates is exactly the
  kind of quiet breakage this project treats as unacceptable.
- Remote URLs and relative paths are rejected. The deployment base path is not
  known when the file is authored, and a remote image cannot be reviewed in this
  repository.

---

## 10. ADDING AN EVENT: THE FULL CHECKLIST

This is the part that is easy to miss, so it is stated as a numbered list.

1. Add the event object to the `events` array in `data/events.json`.
2. **Add its DATE to the selection rules in `src/pages/events.astro`.** There are
   three blocks of selectors there, and each needs one line for the new date
   (`YYYY-MM-DD`):
   - `#day-<date>:checked) :global([data-panel='<date>'])` - shows the panel
   - `#day-<date>:checked) :global([data-day='<date>'])` - marks it selected
   - `#day-<date>:focus-visible) :global([data-day='<date>'])` - rings the focus
3. Drop any image files into `public/img/events/` and reference them. If you have
   none, run `npm run events:placeholders` to generate typographic plates.
4. Run `npm run events:check` until it exits 0.
5. Run `npm test`. Tests assert that every **date** in the data has all three
   selectors, that no selector names a date the data no longer contains, and that
   both blocks hold exactly one line per date - so **step 2 is verified rather than
   remembered**, in both directions.

**It is the DATE, not the event id.** The calendar's selection unit is a date,
because a calendar cell is a date and two events can share one. Adding a second
event to a date that already exists needs **no** new selectors - the cell and the
panel already exist, and the panel simply stacks the two events.

### Why step 2 exists at all

CSS cannot relate a `<label for>` to the control it merely names. A calendar cell
and a list row are rendered by different components from the radio they select, and
the panel is a sibling of both, so the only way to say "this date is selected" is
one selector per date. Those lines are hand-written, and adding a date without
adding its lines produces a page where the cell is clickable and **nothing
happens**: no error, no warning, a green build, and a feature that silently does
nothing.

The test in step 5 is the answer to "if this were broken, how would I find out?" -
but you should still do step 2, because finding out from a test failure is worse
than doing it.

### When this stops being the right design

At roughly forty dates, step 2 is about 120 lines of hand-maintained CSS. At that
point the right trade is about ten lines of inline script setting a `data-` attribute
on the selected cell, and the calendar stops working with scripting off. Not before.

---

## 11. HOW THE PAGE USES THIS FILE

Worth knowing before you edit the data, because it explains several fields.

- **The calendar shows only months that have events.** No event means no month, and
  no empty grid is rendered. A month grid is built per distinct month in the data.
- **The list view is the same data, not a second list.** It is grouped by the same
  month headings and rows point at the same date radios, so a date selected in one
  view is selected in the other.
- **A date with several events stacks them in the panel**, each with its own banner.
  Nothing is hidden and no banner is picked arbitrarily. The current data relies on
  this: two elections fall on 3 November 2026.
- **`reviewedOn` marks past dates.** Dates before it are shown as already held: in
  the list they move to an "Already held" section, and in the calendar their cell is
  marked. Nothing is hidden - a bureau's past engagements are part of the record.
- **Bump `reviewedOn` when you review the list.** It is the only thing that moves
  the past/upcoming line, and it is deliberately not read from the clock.
- **The banner is height-capped**, not shown at its natural size. A full-width
  banner was the reason this page was redesigned. Any image proportion works; it is
  cropped to fit.
- **A multi-day span marks only its first day in the grid.** The full range appears
  in the panel and the list. If a span matters enough to fill the grid, that is a
  page change, not a data change.
- **`pageNote` is rendered last**, after the calendar and before the usage note, as
  its own `<h2>` section.

---

## 12. WHAT THIS SCHEMA DELIBERATELY DOES NOT HAVE

Recorded so their absence reads as a decision rather than an oversight.

- **No per-event `slug` for its own page.** One page, not one page per event.
- **No recurrence, series, or repeating events.** Add the rows.
- **No organiser, speaker, or ticket-price fields.** The brief listed name, date,
  event, location and type; anything else is a conversation, not a default.
- **No `updatedOn` per event.** `reviewedOn` at the top covers "when was this
  list last checked", which is the question a reader actually has.
- **No filter by type on the page yet.** The vocabulary is closed and the set
  present is derived from the data, so a filter is a change to the page alone and
  not a change to this contract.
- **No absolute UTC instant per event.** See section 5 for why, and what is given
  up.
- **No capacity, ticket price, or booking link semantics.** `url` is "a page with
  more about this event" and nothing more. If booking is ever added it wants its own
  field rather than overloading this one.
