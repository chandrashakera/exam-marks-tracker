/**
 * Exam Marks Tracker — Apps Script backend.
 *
 * Web App endpoint, one JSON-POST action per request, dispatched on
 * `action` (same wire-format convention as student-achievement-tracker's
 * Code.gs — see that repo for the sibling implementation this mirrors):
 *
 *   - "listExams"        -> { success, exams: [{examId, examName, subject,
 *                             q1Max, q2aMax, q2bMax, ..., q7aMax, q7bMax,
 *                             assignmentMax}] } — each of Q2-Q7's a/b
 *                             sub-parts has its own max, since they aren't
 *                             always worth the same marks
 *   - "createExam"       -> appends to the Exams tab, creates that exam's
 *                           marks tab with its header row, returns the exam
 *   - "listSubmissions"  -> { success, submissions: [{rollNo, ...marks,
 *                             objectiveTotal, bestFourTotal, assignment,
 *                             finalTotal, status}] } for one exam
 *   - "structure"        -> proxies a marks-sheet photo to Gemini, returns
 *                           best-effort { rollNo, q1a..q7b } (never
 *                           authoritative — every field is user-editable)
 *   - "submitMarks"      -> validates + recomputes totals server-side,
 *                           upserts (by Roll No.) into the exam's marks tab.
 *                           Any mark field may be omitted (e.g. students
 *                           submit only Q1 + Assignment; Q2-Q7 are entered
 *                           later by faculty) — an omitted field falls back
 *                           to that row's existing stored value, or 0 for a
 *                           brand-new row. This makes submitMarks a partial
 *                           update, never a silent overwrite of a field the
 *                           caller didn't send.
 *
 * ---- ONE-TIME SETUP (before deploying) ----
 * Project Settings (gear icon) > Script Properties > add:
 *   SHEET_ID        - ID of the master Google Sheet (from its URL)
 *   GEMINI_API_KEY  - API key from aistudio.google.com
 *   GEMINI_MODEL    - optional; defaults to GEMINI_MODEL_DEFAULT below
 * Deploy as a Web App: Execute as "Me", access "Anyone" — see appsscript.json
 * and the repo README for full steps (same deployment shape as
 * student-achievement-tracker).
 */

var EXAMS_SHEET_NAME = 'Exams';

// Q1 is objective (a-j, 10 parts); Q2-Q7 are subjective, each split a/b,
// best 4 of 6 question-totals counted — see computeTotals_ below.
var Q1_FIELDS = ['q1a', 'q1b', 'q1c', 'q1d', 'q1e', 'q1f', 'q1g', 'q1h', 'q1i', 'q1j'];
var Q_PAIRS = [['q2a', 'q2b'], ['q3a', 'q3b'], ['q4a', 'q4b'], ['q5a', 'q5b'], ['q6a', 'q6b'], ['q7a', 'q7b']];
var SUBJECTIVE_FIELDS = Q_PAIRS.reduce(function (acc, pair) { return acc.concat(pair); }, []);
var ALL_MARK_FIELDS = Q1_FIELDS.concat(SUBJECTIVE_FIELDS);

var EXAMS_HEADERS = ['Exam ID', 'Exam Name', 'Subject', 'Q1 Max (per sub-question)']
  .concat(SUBJECTIVE_FIELDS.map(function (f) { return f.charAt(0).toUpperCase() + f.slice(1) + ' Max'; }))
  .concat(['Assignment Max', 'Marks Tab Name', 'Created At']);

// Every mark field belongs to Q1 (uniform exam.q1Max) or is one of Q2-Q7's
// a/b sub-parts, each with its own configurable max (exam.q2aMax,
// exam.q2bMax, ... — the two parts of a question aren't always worth the
// same marks).
function maxForField_(exam, field) {
  if (Q1_FIELDS.indexOf(field) !== -1) return exam.q1Max;
  return exam[field + 'Max'];
}

var MARKS_HEADERS = [
  'Roll No.', 'Q1a', 'Q1b', 'Q1c', 'Q1d', 'Q1e', 'Q1f', 'Q1g', 'Q1h', 'Q1i', 'Q1j',
  'Q2a', 'Q2b', 'Q3a', 'Q3b', 'Q4a', 'Q4b', 'Q5a', 'Q5b', 'Q6a', 'Q6b', 'Q7a', 'Q7b',
  'Objective Total', 'Subjective Best-4 Total', 'Assignment', 'Final Total', 'Status'
];

var STATUS_DEFAULT = 'Submitted';
var GEMINI_MODEL_DEFAULT = 'gemini-3.1-flash-lite';

function doPost(e) {
  try {
    var body = parseRequestBody_(e);
    var action = body.action;

    switch (action) {
      case 'listExams':
        return jsonResponse_({ success: true, exams: listExams_() });
      case 'createExam':
        return jsonResponse_({ success: true, exam: createExam_(body) });
      case 'listSubmissions':
        return jsonResponse_({ success: true, submissions: listSubmissions_(body) });
      case 'structure':
        return jsonResponse_({ success: true, fields: handleStructureRequest_(body) });
      case 'submitMarks':
        return jsonResponse_(submitMarks_(body));
      default:
        throw new Error('Unknown or missing action: ' + action);
    }
  } catch (err) {
    return jsonResponse_({ success: false, error: err.message });
  }
}

// Lets you sanity-check the deployment URL in a browser (GET request).
function doGet(e) {
  return jsonResponse_({ status: 'ok', message: 'Exam Marks Tracker backend is running.' });
}

// ---------------------------------------------------------------------
// Exams
// ---------------------------------------------------------------------

function listExams_() {
  var sheet = getExamsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var rows = sheet.getRange(2, 1, lastRow - 1, EXAMS_HEADERS.length).getValues();
  return rows
    .filter(function (row) { return row[0]; })
    .map(rowToExam_);
}

function rowToExam_(row) {
  var exam = {
    examId: row[0],
    examName: row[1],
    subject: row[2],
    q1Max: Number(row[3])
  };
  SUBJECTIVE_FIELDS.forEach(function (f, i) { exam[f + 'Max'] = Number(row[4 + i]); });
  exam.assignmentMax = Number(row[4 + SUBJECTIVE_FIELDS.length]);
  exam.marksTabName = row[5 + SUBJECTIVE_FIELDS.length];
  return exam;
}

function createExam_(body) {
  var examName = requireString_(body, 'examName');
  var subject = requireString_(body, 'subject');
  var q1Max = requirePositiveNumber_(body, 'q1Max');
  var qMaxes = SUBJECTIVE_FIELDS.map(function (f) { return requirePositiveNumber_(body, f + 'Max'); });
  var assignmentMax = requirePositiveNumber_(body, 'assignmentMax');

  var examId = uniqueExamId_(examName);
  var marksTabName = examId; // already sanitized to a safe, unique Sheets tab name

  var sheet = getExamsSheet_();
  sheet.appendRow([examId, examName, subject, q1Max].concat(qMaxes).concat([assignmentMax, marksTabName, new Date()]));

  createMarksSheet_(marksTabName);

  var exam = { examId: examId, examName: examName, subject: subject, q1Max: q1Max, assignmentMax: assignmentMax };
  SUBJECTIVE_FIELDS.forEach(function (f, i) { exam[f + 'Max'] = qMaxes[i]; });
  return exam;
}

// Slugifies the exam name into a Sheets-tab-safe id, then disambiguates
// against existing exam ids (Sheets tab names must be unique per file).
function uniqueExamId_(examName) {
  var base = String(examName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80) || 'exam';

  var existing = listExams_().map(function (exam) { return exam.examId; });
  if (existing.indexOf(base) === -1) return base;

  var suffix = 2;
  while (existing.indexOf(base + '-' + suffix) !== -1) suffix++;
  return base + '-' + suffix;
}

function getExamById_(examId) {
  var exam = listExams_().filter(function (e) { return e.examId === examId; })[0];
  if (!exam) throw new Error('Unknown examId: ' + examId);
  return exam;
}

function getExamsSheet_() {
  var ss = SpreadsheetApp.openById(getRequiredProperty_('SHEET_ID'));
  var sheet = ss.getSheetByName(EXAMS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(EXAMS_SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(EXAMS_HEADERS);
  }
  return sheet;
}

// ---------------------------------------------------------------------
// Marks tabs (one per exam)
// ---------------------------------------------------------------------

function createMarksSheet_(marksTabName) {
  var ss = SpreadsheetApp.openById(getRequiredProperty_('SHEET_ID'));
  var sheet = ss.getSheetByName(marksTabName);
  if (!sheet) {
    sheet = ss.insertSheet(marksTabName);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(MARKS_HEADERS);
  }
  return sheet;
}

function getMarksSheet_(examId) {
  var exam = getExamById_(examId);
  var ss = SpreadsheetApp.openById(getRequiredProperty_('SHEET_ID'));
  var sheet = ss.getSheetByName(exam.marksTabName);
  if (!sheet) {
    throw new Error('Marks tab missing for exam: ' + examId);
  }
  return sheet;
}

function listSubmissions_(body) {
  var examId = requireString_(body, 'examId');
  var sheet = getMarksSheet_(examId);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var rows = sheet.getRange(2, 1, lastRow - 1, MARKS_HEADERS.length).getValues();
  return rows
    .filter(function (row) { return row[0]; })
    .map(function (row) { return rowToSubmission_(row); });
}

function rowToSubmission_(row) {
  var result = { rollNo: row[0] };
  MARKS_HEADERS.slice(1, 1 + ALL_MARK_FIELDS.length).forEach(function (header, i) {
    result[ALL_MARK_FIELDS[i]] = row[1 + i];
  });
  result.objectiveTotal = row[23];
  result.bestFourTotal = row[24];
  result.assignment = row[25];
  result.finalTotal = row[26];
  result.status = row[27];
  return result;
}

// ---------------------------------------------------------------------
// Gemini OCR proxy
// ---------------------------------------------------------------------

function handleStructureRequest_(body) {
  if (!body.imageBase64) {
    throw new Error('Missing required field: imageBase64');
  }
  if (!body.mimeType) {
    throw new Error('Missing required field: mimeType');
  }
  return callGeminiForStructuring_(String(body.imageBase64), String(body.mimeType));
}

function callGeminiForStructuring_(imageBase64, mimeType) {
  var apiKey = getRequiredProperty_('GEMINI_API_KEY');
  var model = PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') || GEMINI_MODEL_DEFAULT;
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(apiKey);

  var payload = {
    contents: [{
      parts: [
        { text: GEMINI_MARKS_EXTRACTION_PROMPT },
        { inlineData: { mimeType: mimeType, data: imageBase64 } }
      ]
    }],
    generationConfig: { responseMimeType: 'application/json' }
  };

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error('Gemini API error (HTTP ' + status + '): ' + response.getContentText());
  }

  var apiResult = JSON.parse(response.getContentText());
  var candidateText = apiResult
    && apiResult.candidates
    && apiResult.candidates[0]
    && apiResult.candidates[0].content
    && apiResult.candidates[0].content.parts
    && apiResult.candidates[0].content.parts[0]
    && apiResult.candidates[0].content.parts[0].text;

  if (!candidateText) {
    throw new Error('Gemini returned no extractable content.');
  }

  var parsed;
  try {
    parsed = JSON.parse(candidateText);
  } catch (parseErr) {
    throw new Error('Gemini response was not valid JSON: ' + candidateText);
  }

  return sanitizeGeminiFields_(parsed);
}

// Never throws on a missing/malformed field — every field is user-editable
// on the Marks Entry screen, so a bad Gemini response degrades to "leave it
// blank", not an error.
function sanitizeGeminiFields_(fields) {
  fields = fields || {};
  var result = { rollNo: fields.rollNo ? String(fields.rollNo) : '' };
  ALL_MARK_FIELDS.forEach(function (key) {
    result[key] = fields[key] !== undefined && fields[key] !== null ? String(fields[key]) : '';
  });
  return result;
}

// ---------------------------------------------------------------------
// Submit / update marks (upsert by Roll No.)
// ---------------------------------------------------------------------

function submitMarks_(body) {
  var examId = requireString_(body, 'examId');
  var rollNo = requireString_(body, 'rollNo');
  var exam = getExamById_(examId);
  var sheet = getMarksSheet_(examId);

  var rowIndex = findRowIndexByRollNo_(sheet, rollNo);
  var existing = rowIndex === -1 ? null : rowToSubmission_(sheet.getRange(rowIndex, 1, 1, MARKS_HEADERS.length).getValues()[0]);

  var marks = {};
  ALL_MARK_FIELDS.forEach(function (field) {
    var fallback = existing ? existing[field] : 0;
    marks[field] = resolveMarkValue_(body, field, maxForField_(exam, field), fallback);
  });
  var assignment = resolveMarkValue_(body, 'assignment', exam.assignmentMax, existing ? existing.assignment : 0);
  var status = (body.status && String(body.status).trim()) || (existing && existing.status) || STATUS_DEFAULT;

  var totals = computeTotals_(marks, assignment);

  var row = [rollNo]
    .concat(ALL_MARK_FIELDS.map(function (f) { return marks[f]; }))
    .concat([totals.objectiveTotal, totals.bestFourTotal, assignment, totals.finalTotal, status]);

  if (rowIndex === -1) {
    sheet.appendRow(row);
  } else {
    sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  }

  return {
    success: true,
    objectiveTotal: totals.objectiveTotal,
    bestFourTotal: totals.bestFourTotal,
    finalTotal: totals.finalTotal
  };
}

function findRowIndexByRollNo_(sheet, rollNo) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var rollNos = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < rollNos.length; i++) {
    if (String(rollNos[i][0]) === rollNo) return i + 2; // +2: 1-indexed, plus header row
  }
  return -1;
}

// questionTotal(a,b) = a+b; bestFourTotal = sum of the 4 highest of the 6
// Q2-Q7 question totals; objectiveTotal = sum of Q1 a-j; finalTotal rounds
// up only if the raw total isn't already a whole number.
function computeTotals_(marks, assignment) {
  var objectiveTotal = Q1_FIELDS.reduce(function (sum, f) { return sum + marks[f]; }, 0);

  var questionTotals = Q_PAIRS.map(function (pair) { return marks[pair[0]] + marks[pair[1]]; });
  questionTotals.sort(function (a, b) { return b - a; });
  var bestFourTotal = questionTotals.slice(0, 4).reduce(function (sum, v) { return sum + v; }, 0);

  var rawTotal = objectiveTotal + bestFourTotal + assignment;
  var finalTotal = Number.isInteger(rawTotal) ? rawTotal : Math.ceil(rawTotal);

  return { objectiveTotal: objectiveTotal, bestFourTotal: bestFourTotal, finalTotal: finalTotal };
}

// ---------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------

function requireString_(body, key) {
  var value = body[key];
  if (!value || !String(value).trim()) {
    throw new Error('Missing required field: ' + key);
  }
  return String(value).trim();
}

function requirePositiveNumber_(body, key) {
  var value = Number(body[key]);
  if (!isFinite(value) || value <= 0) {
    throw new Error('Invalid or missing field: ' + key + ' (must be a positive number)');
  }
  return value;
}

// Every mark (and Assignment) must be a non-negative multiple of 0.5, no
// greater than that field's configured max for this exam. A field the
// caller didn't send (e.g. a student submitting only Q1, leaving Q2-Q7 for
// faculty) falls back to that row's existing stored value, or 0 for a
// brand-new row — omitting a field is never an error, and never silently
// zeroes out a value someone else already entered.
function resolveMarkValue_(body, key, max, fallback) {
  if (body[key] === undefined || body[key] === null || String(body[key]).trim() === '') {
    return Number(fallback) || 0;
  }
  var value = Number(body[key]);
  if (!isFinite(value) || value < 0) {
    throw new Error('Invalid value for ' + key + ': must be a non-negative number');
  }
  if (Math.round(value * 2) !== value * 2) {
    throw new Error('Invalid value for ' + key + ': must be a multiple of 0.5');
  }
  if (value > max) {
    throw new Error('Invalid value for ' + key + ': exceeds max of ' + max);
  }
  return value;
}

function getRequiredProperty_(key) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) {
    throw new Error('Missing script property: ' + key + '. Set it in Project Settings > Script Properties.');
  }
  return value;
}

function parseRequestBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('Missing request body.');
  }
  try {
    return JSON.parse(e.postData.contents);
  } catch (parseErr) {
    throw new Error('Request body is not valid JSON.');
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
