/**
 * Gemini field-extraction prompt for a scanned/photographed exam answer
 * sheet's marks grid — canonical, executable copy (this is the version
 * Code.gs actually sends to Gemini).
 *
 * Two extraction targets, sent in one combined vision call (mirrors
 * student-achievement-tracker's single-call-per-image pattern):
 *   - Roll No. (H.T. No.) — PRIORITY target. Printed in a boxed digit grid
 *     on the sheet, one digit per box. Read carefully digit-by-digit.
 *   - Per-question marks (Q1 a-j, Q2-Q7 a/b) — OPTIONAL, lower-confidence
 *     target. Hand-written by the evaluator in the margin next to each
 *     sub-question. Never authoritative — every value just pre-fills an
 *     editable field, so it is far better to return "" for something
 *     illegible than to guess.
 */

var GEMINI_MARKS_EXTRACTION_PROMPT =
  'You are extracting data from a photograph of a student\'s exam answer-book cover/marks sheet.\n\n' +
  'Return ONLY a single JSON object. No markdown code fences, no explanation, no leading or trailing text — just the raw JSON object, parseable by JSON.parse().\n\n' +
  'The JSON object must have exactly these 23 keys, matching these exact names:\n\n' +
  '{\n' +
  '  "rollNo": string,\n' +
  '  "q1a": string, "q1b": string, "q1c": string, "q1d": string, "q1e": string,\n' +
  '  "q1f": string, "q1g": string, "q1h": string, "q1i": string, "q1j": string,\n' +
  '  "q2a": string, "q2b": string,\n' +
  '  "q3a": string, "q3b": string,\n' +
  '  "q4a": string, "q4b": string,\n' +
  '  "q5a": string, "q5b": string,\n' +
  '  "q6a": string, "q6b": string,\n' +
  '  "q7a": string, "q7b": string\n' +
  '}\n\n' +
  'Field-by-field rules:\n\n' +
  '1. "rollNo" — THIS IS THE PRIORITY FIELD. It is printed in a boxed grid ' +
  '(one character per box), usually labeled "H.T. No." or "Hall Ticket No." ' +
  'or "Roll No.". Read it very carefully, digit by digit / character by ' +
  'character, in order left to right. If truly illegible, return "" rather ' +
  'than guessing — never fabricate a plausible-looking roll number.\n\n' +
  '2. "q1a" through "q1j", and "q2a"/"q2b" through "q7a"/"q7b" — these are ' +
  'marks hand-written by an evaluator, usually in a small margin table next ' +
  'to each question/sub-question label (e.g. "Q1(a)", "Q2(a)", "Q7(b)"). ' +
  'These are OPTIONAL and LOWER CONFIDENCE than the roll number — they are ' +
  'never treated as final; a person always reviews and corrects every one ' +
  'before it is saved. So:\n' +
  '   - Only fill in a value if you can actually make out a number in that ' +
  'question\'s marks cell.\n' +
  '   - Values are almost always small (single digits or half-marks like ' +
  '"2.5"). Return the number as a plain string, e.g. "2", "2.5", "0".\n' +
  '   - If a sub-question\'s mark is blank, crossed out, or illegible, ' +
  'return "" for that field. An empty string is the correct, expected ' +
  'answer for most fields most of the time — do not treat it as a failure.\n' +
  '   - Do not infer a mark from surrounding context (e.g. do not assume ' +
  'full marks because the answer looks complete) — only report a mark that ' +
  'is actually written down.\n\n' +
  'General rules:\n' +
  '- Every value must be a plain string (use "" for unknown/illegible, ' +
  'never null, never omit a key).\n' +
  '- Do not add any keys beyond the 23 listed above.\n' +
  '- Do not wrap the JSON in markdown code fences (no ```json).\n' +
  '- CRITICAL: if the image does not actually appear to be a real, legible ' +
  'exam answer sheet / marks sheet — e.g. blank, corrupted, unrelated ' +
  'content, or too illegible to make out any genuine details — return "" ' +
  'for every field rather than inventing a plausible-looking roll number or ' +
  'marks just to produce a fuller-looking answer. All-empty is correct and ' +
  'expected when there is truly nothing legible to extract.\n' +
  '- Base every field strictly on what is actually visible in the image — ' +
  'do not use outside knowledge, and do not infer details that aren\'t ' +
  'visibly supported.\n';
