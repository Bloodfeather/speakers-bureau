// scripts/lib/bom.mjs - remove a leading UTF-8 byte order mark, ONE implementation.
//
// WHY THIS IS ITS OWN MODULE. It used to be a private function in
// scripts/check-events.mjs and a byte-identical private function in
// scripts/make-placeholders.mjs. Both CLIs read the same hand-edited
// data/events.json, so both needed it, and check-events.mjs's own comment above
// its copy argued against reimplementing anything the other CLI needs - while
// doing exactly that one function over. Two copies means one of them eventually
// changes and the other does not, and the symptom is a mystery "unexpected token"
// on one command and not the other.
//
// THE CHARACTER IS BUILT FROM ITS CODE POINT, never typed. U+FEFF is invisible,
// and this project is ASCII-only in authored files (ROADMAP design rule 9): a
// literal here would either be invisible in review or arrive as mojibake.
// `text.charCodeAt(0) === 0xfeff` is the same check either way, and it is
// legible.
//
// FOUND BY A PROBE, NOT BY THEORY. Windows PowerShell 5.1's `Out-File -Encoding
// utf8` and Notepad both write a BOM by default, so a hand-edited events.json on
// this machine very plausibly arrives with one. JSON.parse rejects it outright,
// and the resulting error - "Unexpected token ''" pointing at the opening brace -
// says nothing about the actual cause, which is the worst shape a data error can
// take: the author goes looking for a syntax error in their JSON.
//
// NOTHING IS TRIMMED BEYOND THE MARK. Leading whitespace before it would still
// fail to parse, and hiding that would be dishonest.

export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
