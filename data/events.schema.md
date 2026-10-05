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
  "events": [ { ... }, { ... } ]
}
```

- `reviewedOn` - optional, `YYYY-MM-DD`. The date a human last checked this list.
  See section 7.
- `events` - required, an array, and it must not be empty.

---

## 3. ONE EVENT, FULLY ANNOTATED

```json
{
  "id": "riverside-water-forum",
  "name": "Riverside Water Forum",
  "event": "An evening on who owns the river, who pays to keep it flowing, and what a low-water year actually does to farms downstream. Four speakers, then questions.",
  "startsAt": "2026-11-14T18:30",
  "endsAt": "2026-11-14T20:30",
  "allDay": false,
  "timezone": "Eastern Time (ET)",
  "location": "Riverside Public Library, 14 Mill Street, Millbrook",
  "type": "Forum",
  "thumbnail": "/img/events/riverside-water-forum-thumb.svg",
  "banner": "/img/events/riverside-water-forum-banner.svg",
  "url": "https://example.org/events/riverside-water-forum",
  "notes": "Doors at 6pm. The hearing room is reached up the stairs at the rear."
}
```

`url` and `notes` are optional and may be `null` or omitted. `thumbnail` and
`banner` are optional too, and both may be `null` - the calendar is built to
render without either, and there are events in the sample data that do.

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
Election   Debate   Forum   Rally   Fundraiser   Workshop   Lecture
```

These render as filter chips. Free text fragments over time - "Keynote",
"keynote", "Keynote Address" - and a filter offering four near-identical chips is
worse than no filter, because it implies a distinction the data does not make.
An unknown type is a loud failure that prints the whole allowed list.

Matching is **case-sensitive**: `forum` is rejected, `Forum` is correct.

**To add a genuine one-off**, make it a deliberate two-place edit:

1. add it to `EVENT_TYPES` in `src/lib/events-schema.ts`
2. add a row to the table in `data/events.schema` (section 3)

Both, in the same change. The point is that this cannot be done by accident while
filling in forty rows.

Note `Lecture` is singular while the original brief said "Lectures"; the other six
were singular, and a chip reading "Lectures" is a grammar error in a filter row.
One-word revert if that was not the intent.

---

## 9. IMAGES

- Put files in `public/img/events/`. A path in the data is `/img/` plus that
  directory, so `public/img/events/foo.svg` is written `/img/events/foo.svg`.
- Naming convention: `<id>-thumb.svg` and `<id>-banner.svg`.
- The placeholder set is SVG and flat geometric. **Real photography is welcome and
  is the point** - drop in `.jpg` or `.png` and update the path to match.
- Aspect ratios the layout is built around: thumbnail **3:2** (the sample files
  are 480x320), banner **8:3** (1600x600). Both are cropped by CSS with
  `object-fit: cover`, so a different ratio still renders - it will just crop more.
- Both are optional. An event with neither renders as a complete row, and its
  panel shows a framed notice saying no banner was supplied. That is deliberate:
  the frame keeps its height so the sticky panel on a phone does not jump when
  the reader selects a different event.
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
2. **Add its `id` to the selection rules in `src/pages/events.astro`.** There is a
   block of seven `html:has(#event-input-<id>:checked) [data-panel='<id>']`
   selectors. Add one line for the new id.
3. Drop any image files into `public/img/events/` and reference them.
4. Run `npm run events:check` until it exits 0.
5. Run `npm test`. One test asserts that every event in the data has a matching
   selector in step 2, so **step 2 is verified rather than remembered**.

**Why step 2 exists at all.** Astro scopes CSS written inside a component, and
there is no way to generate a selector from a JSON array. So those seven lines are
hand-written, and adding an event without adding its line would produce a page
where the row is selectable and its panel never appears: no error, no warning, a
green build, and a feature that silently does nothing. The test in step 5 is the
answer to "if this were broken, how would I find out?" - but you should still do
step 2, because finding out from a test failure is worse than doing it.

---

## 11. WHAT THIS SCHEMA DELIBERATELY DOES NOT HAVE

Recorded so their absence reads as a decision rather than an oversight.

- **No per-event `slug` for its own page.** One page, not one page per event.
- **No recurrence, series, or repeating events.** Add the rows.
- **No organiser, speaker, or ticket-price fields.** The brief listed name, date,
  event, location and type; anything else is a conversation, not a default.
- **No `updatedAt` per event.** `reviewedOn` at the top covers "when was this
  list last checked", which is the question a reader actually has.
- **No filter by type on the page yet.** The vocabulary is closed and the set
  present is derived from the data, so a filter is a change to the page alone and
  not a change to this contract.
- **No absolute UTC instant per event.** See section 5 for why, and what is given
  up.
