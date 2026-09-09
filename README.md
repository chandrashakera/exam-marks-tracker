# Exam Marks Tracker

Zero-cost PWA for capturing per-question exam marks from physical answer
sheets straight into the Google Sheet that already does attainment
calculation for that exam. A student (or faculty, editing/correcting)
scans or uploads a photo of the marks sheet, Gemini reads the boxed roll
number (and, best-effort, the margin-written per-question marks), the
entry grid is checked/corrected against the physical sheet, and the row
lands directly in that exam's Sheet tab.

Sibling app: [student-achievement-tracker](https://github.com/chandrashakera/student-achievement-tracker)
— same architecture (Apps Script Web App backend, no server, no login,
Gemini vision for OCR), reused here rather than reinvented. See
[EXAM_MARKS_APP_HANDOFF.md](EXAM_MARKS_APP_HANDOFF.md) for the original
spec this app implements.

## Stack

- Frontend: plain HTML/JS/CSS PWA, installable via "Add to Home Screen"
- Hosting: Cloudflare Pages, intended for `marks.chandrashaker.in`
- Backend: Google Apps Script Web App (free, no server)
- Storage: Google Sheets only — one master Sheet with an `Exams` config
  tab plus one auto-created tab per exam (the exam's own attainment file)
- OCR/structuring: Gemini vision API, proxied through the Apps Script
  backend so the API key never reaches the browser
- Auth: none — fully open, matching the achievement tracker's model

## Repo layout

```
backend/    Google Apps Script Web App (Code.gs, GeminiPrompt.gs, appsscript.json)
frontend/   PWA: index.html, app.js, style.css, config.js, manifest, service worker
```

## Data model

**One master Google Sheet** (`SHEET_ID` script property):

- **`Exams` tab**: `Exam ID | Exam Name | Subject | Q1 Max (per sub-question)
  | Q2-Q7 Max (per sub-question) | Assignment Max | Marks Tab Name |
  Created At`. Auto-created (with header) on first exam creation.
- **One tab per exam** (name = the exam's slugified ID), auto-created when
  the exam is created. Header row: `Roll No. | Q1a...Q1j | Q2a Q2b ... Q7a
  Q7b | Objective Total | Subjective Best-4 Total | Assignment | Final
  Total | Status`.
- Rows are keyed by Roll No. within an exam's tab — submitting the same
  roll no. again updates that row in place rather than duplicating it.

## Computation rules

- `questionTotal(a, b) = a + b`
- `bestFourTotal` = sum of the 4 highest of the 6 Q2–Q7 question totals
- `objectiveTotal` = sum of Q1 a–j
- `rawTotal = objectiveTotal + bestFourTotal + assignment`
- `finalTotal = Number.isInteger(rawTotal) ? rawTotal : Math.ceil(rawTotal)`
- Every mark (and Assignment) must be a non-negative multiple of 0.5, no
  greater than that exam's configured max for that field. The backend
  re-validates and recomputes every total itself on submit — the
  confirmation checkbox in the UI is a review step, not the actual guard.

## Backend wire format

The Web App handles five JSON-POST actions on the same `/exec` URL:

**`listExams`**
```json
{ "action": "listExams" }
```
→ `{ "success": true, "exams": [{ "examId", "examName", "subject", "q1Max", "q2to7Max", "assignmentMax" }] }`

**`createExam`**
```json
{ "action": "createExam", "examName": "Mid-Term 1", "subject": "Data Structures", "q1Max": 1, "q2to7Max": 5, "assignmentMax": 5 }
```
→ `{ "success": true, "exam": { "examId", "examName", "subject", "q1Max", "q2to7Max", "assignmentMax" } }`

**`listSubmissions`**
```json
{ "action": "listSubmissions", "examId": "mid-term-1" }
```
→ `{ "success": true, "submissions": [{ "rollNo", "q1a"..."q7b", "objectiveTotal", "bestFourTotal", "assignment", "finalTotal", "status" }] }`

**`structure`** (proxies the marks-sheet photo to Gemini)
```json
{ "action": "structure", "examId": "mid-term-1", "imageBase64": "<base64, no data: prefix>", "mimeType": "image/jpeg" }
```
→ `{ "success": true, "fields": { "rollNo", "q1a"..."q7b" } }` — every field best-effort, `""` when illegible, never authoritative.

**`submitMarks`** (upsert by Roll No.)
```json
{ "action": "submitMarks", "examId": "mid-term-1", "rollNo": "21A91A0501", "q1a": 1, "...": "...", "q7b": 4.5, "assignment": 5, "status": "Submitted" }
```
→ `{ "success": true, "objectiveTotal": 9, "bestFourTotal": 34, "finalTotal": 48 }`

All errors: `{ "success": false, "error": "..." }`.

### Why base64 JSON, `text/plain` content type

Same rationale as the achievement tracker: Apps Script Web Apps parse a
`text/plain` JSON body reliably and this content type counts as a CORS
"simple request", sidestepping preflight entirely — no `multipart/form-data`
or JSON content-type CORS handling needed.

## Deploying the backend

### 1. Create the master Sheet

Create (or pick) a Google Sheet — this becomes both the `Exams` config and
every exam's data tabs. Copy its **Sheet ID** from the URL:
`https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`

You don't need to pre-create any tabs — the backend creates the `Exams`
tab and each exam's tab automatically.

### 2. Create the Apps Script project

- Go to [script.google.com](https://script.google.com) > New project.
- Rename the project (e.g. "Exam Marks Tracker Backend").
- Replace `Code.gs`'s contents with [backend/Code.gs](backend/Code.gs).
- Add a new script file (`File > New > Script`) named `GeminiPrompt`, paste
  in [backend/GeminiPrompt.gs](backend/GeminiPrompt.gs).

### 3. Set Script Properties

Project Settings (gear icon) > **Script Properties** > add:

| Property | Value |
|---|---|
| `SHEET_ID` | the Sheet ID from step 1 |
| `GEMINI_API_KEY` | API key from [aistudio.google.com](https://aistudio.google.com) (free tier) |
| `GEMINI_MODEL` | optional — defaults to `gemini-3.1-flash-lite`; check `https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY` if extraction starts failing (free-tier model availability changes over time) |

### 4. Deploy as a Web App

- Deploy > New deployment > gear icon next to "Select type" > **Web app**.
- **Execute as:** Me — required so the script can write to the Sheet
  regardless of who calls the endpoint.
- **Who has access:** Anyone — required for the no-login model.
  **Flagging this as a tradeoff, not asking permission to change it**: the
  URL, once known, can be POSTed to by anyone with no built-in rate
  limiting — matches the brief's trusted-cohort framing.
- Deploy, authorize the requested Sheets permissions (click through the
  "unverified app" warning — it's your own personal script).
- Copy the **Web app URL** (ends in `/exec`).

### 5. Redeploying after edits

Deploy > Manage deployments > pencil icon > Version: **New version** >
Deploy. The `/exec` URL stays the same.

## Running the frontend locally

```bash
npx serve frontend
```

Open the printed URL. Paste your deployment's `/exec` URL into
`frontend/config.js` (`CONFIG.WEBAPP_URL`) first.

Faculty flow first (no exams exist yet on a fresh Sheet): switch to
**Faculty** mode, **Create New Exam**, then switch back to **Student** to
test the scan/upload → OCR → marks entry → submit flow, and check the
Sheet tab afterward to confirm the row and computed totals landed
correctly.

## Deploying the frontend

Cloudflare Pages: connect this repo, build output directory `frontend`, no
build command needed (static site). Point the `marks.chandrashaker.in`
custom domain at the Pages project once deployed.

## Git commit policy

No AI co-author trailers on commits in this repo — standing policy across
all Chandras Edu repos (see [EXAM_MARKS_APP_HANDOFF.md](EXAM_MARKS_APP_HANDOFF.md), Section 6).
