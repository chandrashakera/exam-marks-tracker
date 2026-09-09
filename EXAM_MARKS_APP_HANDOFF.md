# Claude Code Handoff: Exam Marks Tracker

**Status:** Design complete, ready for implementation.
**Repo:** NEW, separate GitHub repo (e.g. `exam-marks-tracker`) — mirrors `student-achievement-tracker`'s pattern of being its own standalone project, not folded into that codebase.
**Hosting:** own Cloudflare Pages project, Custom Domain `marks.chandrashaker.in`. Linked from `apps.chandrashaker.in`'s landing page but fully independent hosting/domain.
**Backend:** Google Sheets via Drive API — same approach as `student-achievement-tracker`, no Firebase. Marks write directly into a Google Sheet; that Sheet is the attainment-calculation file, not an intermediate export.
**Access:** fully open, no login/auth — same model as the current tracker.

---

## 1. Backend: Google Sheets structure

- **One Google Sheet per exam** (or one Sheet with one tab per exam — decide based on how `student-achievement-tracker` already organizes its Drive files; match that convention rather than introducing a new one).
- **Columns (one header row, one row per student):**
  `Roll No. | Q1a | Q1b | Q1c | Q1d | Q1e | Q1f | Q1g | Q1h | Q1i | Q1j | Q2a | Q2b | Q3a | Q3b | Q4a | Q4b | Q5a | Q5b | Q6a | Q6b | Q7a | Q7b | Objective Total | Subjective Best-4 Total | Assignment | Final Total | Status`
- **Write mode:** app authenticates to Google Sheets API (service account or OAuth — check which pattern `student-achievement-tracker` already uses for Drive access, reuse it) and appends/updates a row per student submission.
- **Row identity:** keyed by Roll No. — if a row for that roll no. already exists in the exam's sheet, update it in place (e.g. on a faculty correction) rather than appending a duplicate.

---

## 2. Computation rules (same logic as before, unchanged)

- `questionTotal(a, b) = a + b`
- `bestFourTotal` = sum of the 4 highest of the 6 question totals (Q2–Q7) — auto, no manual override
- `rawTotal = objectiveTotal (sum of Q1 a-j) + bestFourTotal + assignment`
- `finalTotal = Number.isInteger(rawTotal) ? rawTotal : Math.ceil(rawTotal)` — round up only at this final step
- All inputs validate as multiples of 0.5

---

## 3. Screens

### Student flow (open, no login)
1. Select exam from a list (exam name/subject — populate from a config the faculty sets, see below).
2. Upload/scan photo of the marks sheet (after in-person verification with faculty — UI instruction only).
3. Roll no. auto-capture via OCR on the boxed H.T. No. field — pre-fills an editable text field, no validation against any list, correctable if misread.
4. Marks entry grid: Q1 a–j (10 fields), Q2–Q7 a/b (12 fields), Assignment (1 field). Photo shown alongside for reference. Optional OCR-assist autofill on the margin marks — never authoritative, always editable.
5. Entry-level alerts: exceeds max, non-multiple-of-0.5, missing fields.
6. Submission-level alert: show computed final total, require explicit confirmation against the physical sheet before submit unlocks.
7. Submit → writes/updates the row in the Google Sheet.

### Faculty flow (open, same no-login model)
1. Create/configure an exam: subject, exam name, max-marks config. Store this config however is simplest given no database — a small JSON config file in the repo, or a dedicated "Exams" tab in the same Google Sheet, whichever matches the existing tracker's simplicity.
2. View current submissions: read the exam's Sheet directly, list roll numbers + status.
3. Enter/edit any student's marks directly (same grid) — writes/updates that row.
4. No separate "export" button needed — the Google Sheet itself is already the attainment file; faculty opens/downloads it directly from Drive as needed.

---

## 4. OCR scope

- Google Vision API, same as before.
- **Target 1 (priority):** boxed H.T. No. grid — pre-fills roll no. field, always editable, no list to validate against.
- **Target 2 (optional, lower confidence):** margin-written Q1/Q2–Q7 marks — pre-fill suggestion only, never locks fields regardless of confidence.

---

## 5. Explicitly out of scope

- Any authentication/login.
- Firebase/Firestore in any form — Google Sheets/Drive only, matching the existing tracker.
- Roster pre-loading or roll-no validation against a list.
- Faculty-override audit logging.
- Manual override of best-4-of-6 selection.
- Per-sub-question attainment mapping logic itself (downstream, in the Sheet/Excel, not this app).

---

## 6. Git commit policy

- **No AI co-author trailers** (e.g. `Co-Authored-By: Claude`) on any commit in this repo — standing policy across all Chandras Edu repos. Commit normally under the existing git identity, no attribution footer.

## 7. Questions for Claude Code to flag back before building

- Exactly how `student-achievement-tracker` currently authenticates to Google Drive/Sheets (service account key, OAuth flow, etc.) — reuse the same credentials pattern/setup approach, don't introduce a second auth method for Drive access.
- Whether that existing repo has any reusable OCR integration code (Google Vision call, image upload handling) worth copying into this new repo rather than rebuilding from scratch.
- Confirm Google Sheets API quota/rate-limit considerations are a non-issue at expected usage (one class section's worth of submissions over a short window after an exam) — should be fine, but worth a sanity check before committing to per-submission API writes.
