// Exam Marks Tracker — frontend app logic.
// Plain JS, no framework/build step. Single-page state machine toggling
// <section class="screen"> blocks in index.html, same pattern as the
// sibling student-achievement-tracker app.

const Q1_FIELDS = ['q1a', 'q1b', 'q1c', 'q1d', 'q1e', 'q1f', 'q1g', 'q1h', 'q1i', 'q1j'];
const Q_GROUPS = [
  { label: 'Q2', fields: ['q2a', 'q2b'] },
  { label: 'Q3', fields: ['q3a', 'q3b'] },
  { label: 'Q4', fields: ['q4a', 'q4b'] },
  { label: 'Q5', fields: ['q5a', 'q5b'] },
  { label: 'Q6', fields: ['q6a', 'q6b'] },
  { label: 'Q7', fields: ['q7a', 'q7b'] }
];
const ALL_MARK_FIELDS = Q1_FIELDS.concat(Q_GROUPS.reduce((acc, g) => acc.concat(g.fields), []));

const state = {
  mode: 'student',        // 'student' | 'faculty'
  exams: [],
  currentExam: null,      // the selected exam's config object
  photoFile: null,        // captured/uploaded File (student flow only)
  isManualEntry: false,   // true for faculty manual-entry/edit (no photo step)
  editingRollNo: null     // set when faculty is editing an existing submission
};

// ---- DOM refs ----
const screens = {
  home: document.getElementById('screen-home'),
  createExam: document.getElementById('screen-create-exam'),
  preview: document.getElementById('screen-preview'),
  processing: document.getElementById('screen-processing'),
  submissions: document.getElementById('screen-submissions'),
  marks: document.getElementById('screen-marks'),
  done: document.getElementById('screen-done')
};

function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

// ---- Home screen ----
const modeStudentBtn = document.getElementById('modeStudentBtn');
const modeFacultyBtn = document.getElementById('modeFacultyBtn');
const studentActions = document.getElementById('studentActions');
const facultyActions = document.getElementById('facultyActions');
const studentHint = document.getElementById('studentHint');
const examSelect = document.getElementById('examSelect');
const noExamsHint = document.getElementById('noExamsHint');

const scanBtn = document.getElementById('scanBtn');
const uploadBtn = document.getElementById('uploadBtn');
const cameraInput = document.getElementById('cameraInput');
const fileInput = document.getElementById('fileInput');
const createExamBtn = document.getElementById('createExamBtn');
const viewSubmissionsBtn = document.getElementById('viewSubmissionsBtn');
const manualEntryBtn = document.getElementById('manualEntryBtn');

function setMode(mode) {
  state.mode = mode;
  modeStudentBtn.classList.toggle('active', mode === 'student');
  modeFacultyBtn.classList.toggle('active', mode === 'faculty');
  studentActions.classList.toggle('hidden', mode !== 'student');
  studentHint.classList.toggle('hidden', mode !== 'student');
  facultyActions.classList.toggle('hidden', mode !== 'faculty');
}

modeStudentBtn.addEventListener('click', () => setMode('student'));
modeFacultyBtn.addEventListener('click', () => setMode('faculty'));

examSelect.addEventListener('change', () => {
  state.currentExam = state.exams.find((e) => e.examId === examSelect.value) || null;
  updateHomeButtonStates();
});

function updateHomeButtonStates() {
  const hasExam = !!state.currentExam;
  scanBtn.disabled = !hasExam;
  uploadBtn.disabled = !hasExam;
  viewSubmissionsBtn.disabled = !hasExam;
  manualEntryBtn.disabled = !hasExam;
}

async function loadExams(selectExamId) {
  examSelect.innerHTML = '<option value="">Loading exams...</option>';
  try {
    const result = await callApi('listExams', {});
    state.exams = result.exams || [];
    if (state.exams.length === 0) {
      examSelect.innerHTML = '<option value="">No exams yet</option>';
      noExamsHint.classList.remove('hidden');
      state.currentExam = null;
      updateHomeButtonStates();
      return;
    }
    noExamsHint.classList.add('hidden');
    examSelect.innerHTML = '<option value="">Select an exam...</option>' +
      state.exams.map((e) => `<option value="${escapeAttr(e.examId)}">${escapeHtml(e.examName)} (${escapeHtml(e.subject)})</option>`).join('');
    if (selectExamId) {
      examSelect.value = selectExamId;
    }
    state.currentExam = state.exams.find((e) => e.examId === examSelect.value) || null;
    updateHomeButtonStates();
  } catch (err) {
    examSelect.innerHTML = '<option value="">Failed to load exams</option>';
  }
}

scanBtn.addEventListener('click', () => cameraInput.click());
uploadBtn.addEventListener('click', () => fileInput.click());
cameraInput.addEventListener('change', (e) => handleFileSelected(e.target.files[0]));
fileInput.addEventListener('change', (e) => handleFileSelected(e.target.files[0]));

function handleFileSelected(file) {
  if (!file) return;
  state.photoFile = file;
  cameraInput.value = '';
  fileInput.value = '';
  renderPreview(file, previewArea);
  showScreen('preview');
}

// ---- Preview screen ----
const previewArea = document.getElementById('previewArea');
const retakeBtn = document.getElementById('retakeBtn');
const proceedBtn = document.getElementById('proceedBtn');

let lastPreviewObjectUrl = null;

function renderPreview(file, container) {
  container.innerHTML = '';
  if (lastPreviewObjectUrl) URL.revokeObjectURL(lastPreviewObjectUrl);
  const objectUrl = URL.createObjectURL(file);
  lastPreviewObjectUrl = objectUrl;

  const img = document.createElement('img');
  img.src = objectUrl;
  container.appendChild(img);

  const fullSizeLink = document.createElement('a');
  fullSizeLink.href = objectUrl;
  fullSizeLink.target = '_blank';
  fullSizeLink.rel = 'noopener';
  fullSizeLink.className = 'view-full-size';
  fullSizeLink.textContent = 'View full size ↗';
  container.appendChild(fullSizeLink);
}

retakeBtn.addEventListener('click', () => {
  state.photoFile = null;
  showScreen('home');
});

proceedBtn.addEventListener('click', () => {
  showScreen('processing');
  processingError.classList.add('hidden');
  processingBackBtn.classList.add('hidden');
  processingStatus.textContent = 'Reading marks sheet with AI (this can take a few seconds)...';
  runOcrPipeline().catch((err) => {
    processingStatus.textContent = 'Something went wrong.';
    processingError.textContent = err.message || String(err);
    processingError.classList.remove('hidden');
    processingBackBtn.classList.remove('hidden');
  });
});

// ---- Processing screen ----
const processingStatus = document.getElementById('processingStatus');
const processingError = document.getElementById('processingError');
const processingBackBtn = document.getElementById('processingBackBtn');
processingBackBtn.addEventListener('click', () => showScreen('preview'));

async function runOcrPipeline() {
  const imageBase64 = await blobToBase64(state.photoFile);
  const result = await callApi('structure', {
    examId: state.currentExam.examId,
    imageBase64,
    mimeType: state.photoFile.type || 'image/jpeg'
  });

  state.isManualEntry = false;
  state.editingRollNo = null;
  enterMarksScreen({
    rollNo: result.fields.rollNo || '',
    marks: result.fields,
    photo: state.photoFile,
    title: 'Enter Marks'
  });
}

// ---- Faculty: create exam ----
const newExamName = document.getElementById('newExamName');
const newExamSubject = document.getElementById('newExamSubject');
const newQ1Max = document.getElementById('newQ1Max');
const newQ2to7Max = document.getElementById('newQ2to7Max');
const newAssignmentMax = document.getElementById('newAssignmentMax');
const createExamError = document.getElementById('createExamError');
const createExamCancelBtn = document.getElementById('createExamCancelBtn');
const createExamSubmitBtn = document.getElementById('createExamSubmitBtn');

createExamBtn.addEventListener('click', () => {
  newExamName.value = '';
  newExamSubject.value = '';
  newQ1Max.value = '';
  newQ2to7Max.value = '';
  newAssignmentMax.value = '';
  createExamError.classList.add('hidden');
  showScreen('createExam');
});

createExamCancelBtn.addEventListener('click', () => showScreen('home'));

createExamSubmitBtn.addEventListener('click', () => {
  createExam().catch((err) => {
    createExamError.textContent = err.message || String(err);
    createExamError.classList.remove('hidden');
  });
});

async function createExam() {
  const examName = newExamName.value.trim();
  const subject = newExamSubject.value.trim();
  const q1Max = Number(newQ1Max.value);
  const q2to7Max = Number(newQ2to7Max.value);
  const assignmentMax = Number(newAssignmentMax.value);

  if (!examName || !subject || !(q1Max > 0) || !(q2to7Max > 0) || !(assignmentMax > 0)) {
    throw new Error('Please fill in every field with a valid positive number for the max-marks fields.');
  }

  createExamSubmitBtn.disabled = true;
  createExamSubmitBtn.textContent = 'Creating...';
  try {
    const result = await callApi('createExam', { examName, subject, q1Max, q2to7Max, assignmentMax });
    setMode('faculty');
    await loadExams(result.exam.examId);
    showScreen('home');
  } finally {
    createExamSubmitBtn.disabled = false;
    createExamSubmitBtn.textContent = 'Create';
  }
}

// ---- Faculty: submissions list ----
const submissionsExamLabel = document.getElementById('submissionsExamLabel');
const submissionsList = document.getElementById('submissionsList');
const submissionsEmptyHint = document.getElementById('submissionsEmptyHint');
const submissionsBackBtn = document.getElementById('submissionsBackBtn');

viewSubmissionsBtn.addEventListener('click', () => {
  loadSubmissions().catch((err) => {
    submissionsList.innerHTML = '';
    submissionsEmptyHint.textContent = err.message || String(err);
    submissionsEmptyHint.classList.remove('hidden');
    showScreen('submissions');
  });
});

submissionsBackBtn.addEventListener('click', () => showScreen('home'));

async function loadSubmissions() {
  const exam = state.currentExam;
  submissionsExamLabel.textContent = `${exam.examName} (${exam.subject})`;
  submissionsList.innerHTML = '';
  submissionsEmptyHint.classList.add('hidden');
  showScreen('submissions');

  const result = await callApi('listSubmissions', { examId: exam.examId });
  const submissions = result.submissions || [];
  if (submissions.length === 0) {
    submissionsEmptyHint.textContent = 'No submissions yet for this exam.';
    submissionsEmptyHint.classList.remove('hidden');
    return;
  }
  submissions.forEach((sub) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'submission-row';
    row.innerHTML = `<span class="roll">${escapeHtml(sub.rollNo)}</span>` +
      `<span class="meta">Final: ${escapeHtml(String(sub.finalTotal))} &middot; ${escapeHtml(sub.status || '')}</span>`;
    row.addEventListener('click', () => {
      state.isManualEntry = true;
      state.editingRollNo = sub.rollNo;
      enterMarksScreen({
        rollNo: sub.rollNo,
        marks: sub,
        status: sub.status,
        photo: null,
        title: `Edit Marks — ${sub.rollNo}`
      });
    });
    submissionsList.appendChild(row);
  });
}

manualEntryBtn.addEventListener('click', () => {
  state.isManualEntry = true;
  state.editingRollNo = null;
  enterMarksScreen({ rollNo: '', marks: {}, photo: null, title: 'Enter Marks Manually' });
});

// ---- Marks entry screen ----
const marksTitle = document.getElementById('marksTitle');
const marksPreviewArea = document.getElementById('marksPreviewArea');
const marksRollNo = document.getElementById('marksRollNo');
const marksStatusRow = document.getElementById('marksStatusRow');
const marksStatus = document.getElementById('marksStatus');
const q1Grid = document.getElementById('q1Grid');
const qGroups = document.getElementById('qGroups');
const subjectiveSection = document.getElementById('subjectiveSection');
const subjectivePendingHint = document.getElementById('subjectivePendingHint');
const marksAssignment = document.getElementById('marksAssignment');
const totalObjective = document.getElementById('totalObjective');
const totalBestFour = document.getElementById('totalBestFour');
const totalAssignment = document.getElementById('totalAssignment');
const totalFinal = document.getElementById('totalFinal');
const marksConfirmCheckbox = document.getElementById('marksConfirmCheckbox');
const marksError = document.getElementById('marksError');
const marksBackBtn = document.getElementById('marksBackBtn');
const marksSubmitBtn = document.getElementById('marksSubmitBtn');

const markInputs = {}; // field -> <input>
const markErrorEls = {}; // field -> <p class="field-error">

buildMarksGrid();

function buildMarksGrid() {
  q1Grid.innerHTML = '';
  Q1_FIELDS.forEach((field) => {
    const letter = field.slice(2); // 'q1a' -> 'a'
    const wrap = document.createElement('div');
    wrap.className = 'mark-field';
    wrap.innerHTML = `<label for="mark-${field}">${letter}</label><input id="mark-${field}" type="number" step="0.5" min="0">`;
    q1Grid.appendChild(wrap);
    markInputs[field] = wrap.querySelector('input');
    const errEl = document.createElement('p');
    errEl.className = 'field-error hidden';
    wrap.appendChild(errEl);
    markErrorEls[field] = errEl;
    markInputs[field].addEventListener('input', () => onMarkFieldInput(field, markInputs[field].max ? Number(markInputs[field].max) : Infinity));
  });

  qGroups.innerHTML = '';
  Q_GROUPS.forEach((group) => {
    const box = document.createElement('div');
    box.className = 'q-group';
    box.innerHTML = `<p class="q-group-title"><span>${group.label}</span><span id="subtotal-${group.label}">0</span></p>` +
      `<div class="q-group-fields"></div>`;
    qGroups.appendChild(box);
    const fieldsContainer = box.querySelector('.q-group-fields');
    group.fields.forEach((field) => {
      const letter = field.slice(2);
      const wrap = document.createElement('div');
      wrap.className = 'mark-field';
      wrap.innerHTML = `<label for="mark-${field}">${letter}</label><input id="mark-${field}" type="number" step="0.5" min="0">`;
      fieldsContainer.appendChild(wrap);
      markInputs[field] = wrap.querySelector('input');
      const errEl = document.createElement('p');
      errEl.className = 'field-error hidden';
      wrap.appendChild(errEl);
      markErrorEls[field] = errEl;
      markInputs[field].addEventListener('input', () => onMarkFieldInput(field, markInputs[field].max ? Number(markInputs[field].max) : Infinity));
    });
  });
}

function onMarkFieldInput(field, max) {
  validateAndShowField(field, max);
  recomputeTotals();
  updateSubmitEnablement();
}

function validateAndShowField(field, max) {
  const input = markInputs[field];
  const { valid, message } = validateMarkValue(input.value, max);
  input.classList.toggle('invalid', input.value !== '' && !valid);
  markErrorEls[field].textContent = input.value !== '' && !valid ? message : '';
  markErrorEls[field].classList.toggle('hidden', input.value === '' || valid);
  return input.value !== '' && valid;
}

function validateMarkValue(value, max) {
  if (value === '' || value === null || value === undefined) {
    return { valid: false, message: 'Required' };
  }
  const num = Number(value);
  if (!isFinite(num) || num < 0) {
    return { valid: false, message: 'Invalid number' };
  }
  if (Math.round(num * 2) !== num * 2) {
    return { valid: false, message: 'Must be a multiple of 0.5' };
  }
  if (num > max) {
    return { valid: false, message: `Exceeds max of ${max}` };
  }
  return { valid: true };
}

function recomputeTotals() {
  const marks = {};
  ALL_MARK_FIELDS.forEach((f) => { marks[f] = Number(markInputs[f].value) || 0; });

  const objectiveTotal = Q1_FIELDS.reduce((sum, f) => sum + marks[f], 0);

  const questionTotals = Q_GROUPS.map((g) => marks[g.fields[0]] + marks[g.fields[1]]);
  Q_GROUPS.forEach((g, i) => {
    document.getElementById(`subtotal-${g.label}`).textContent = String(questionTotals[i]);
  });
  const sortedTotals = questionTotals.slice().sort((a, b) => b - a);
  const bestFourTotal = sortedTotals.slice(0, 4).reduce((sum, v) => sum + v, 0);

  const assignment = Number(marksAssignment.value) || 0;
  totalObjective.textContent = String(objectiveTotal);
  totalAssignment.textContent = String(assignment);

  if (!state.isManualEntry) {
    // Students never enter Q2-Q7 — those totals aren't known yet.
    totalBestFour.textContent = 'Pending';
    totalFinal.textContent = 'Pending (Q2–Q7 added by faculty)';
    return;
  }

  const rawTotal = objectiveTotal + bestFourTotal + assignment;
  const finalTotal = Number.isInteger(rawTotal) ? rawTotal : Math.ceil(rawTotal);
  totalBestFour.textContent = String(bestFourTotal);
  totalFinal.textContent = String(finalTotal);
}

marksAssignment.addEventListener('input', () => {
  validateAssignmentField();
  recomputeTotals();
  updateSubmitEnablement();
});

function validateAssignmentField() {
  const max = state.currentExam ? state.currentExam.assignmentMax : Infinity;
  const { valid } = validateMarkValue(marksAssignment.value, max);
  marksAssignment.classList.toggle('invalid', marksAssignment.value !== '' && !valid);
  return marksAssignment.value !== '' && valid;
}

marksRollNo.addEventListener('input', updateSubmitEnablement);
marksConfirmCheckbox.addEventListener('change', updateSubmitEnablement);

function updateSubmitEnablement() {
  const rollNoOk = marksRollNo.value.trim().length > 0;
  const assignmentOk = validateAssignmentField();
  // Students only enter Q1 — Q2-Q7 are faculty-only, so only faculty
  // screens (manual entry / editing a submission) need those validated.
  const fieldsToCheck = state.isManualEntry ? ALL_MARK_FIELDS : Q1_FIELDS;
  const allFieldsOk = fieldsToCheck.every((f) => {
    const max = state.currentExam ? (Q1_FIELDS.includes(f) ? state.currentExam.q1Max : state.currentExam.q2to7Max) : Infinity;
    return validateAndShowField(f, max);
  });
  marksSubmitBtn.disabled = !(rollNoOk && assignmentOk && allFieldsOk && marksConfirmCheckbox.checked);
}

function enterMarksScreen({ rollNo, marks, status, photo, title }) {
  marksTitle.textContent = title;
  marksError.classList.add('hidden');
  marksConfirmCheckbox.checked = false;
  marksRollNo.value = rollNo || '';

  const exam = state.currentExam;
  ALL_MARK_FIELDS.forEach((f) => {
    const max = Q1_FIELDS.includes(f) ? exam.q1Max : exam.q2to7Max;
    markInputs[f].max = String(max);
    markInputs[f].value = marks && marks[f] !== undefined && marks[f] !== null && marks[f] !== '' ? String(marks[f]) : '';
    markInputs[f].classList.remove('invalid');
    markErrorEls[f].classList.add('hidden');
  });
  marksAssignment.max = String(exam.assignmentMax);
  marksAssignment.value = marks && marks.assignment !== undefined && marks.assignment !== null && marks.assignment !== '' ? String(marks.assignment) : '';
  marksAssignment.classList.remove('invalid');

  marksStatusRow.classList.toggle('hidden', !state.isManualEntry);
  marksStatus.value = status || '';

  // Q2-Q7 (subjective) are faculty-only — students never see or submit them.
  subjectiveSection.classList.toggle('hidden', !state.isManualEntry);
  subjectivePendingHint.classList.toggle('hidden', state.isManualEntry);

  if (photo) {
    marksPreviewArea.classList.remove('hidden');
    renderPreview(photo, marksPreviewArea);
  } else {
    marksPreviewArea.classList.add('hidden');
    marksPreviewArea.innerHTML = '';
  }

  recomputeTotals();
  marksSubmitBtn.disabled = true;
  showScreen('marks');
}

marksBackBtn.addEventListener('click', () => {
  showScreen(state.isManualEntry ? (state.editingRollNo ? 'submissions' : 'home') : 'home');
});

marksSubmitBtn.addEventListener('click', () => {
  submitMarks().catch((err) => {
    marksError.textContent = err.message || String(err);
    marksError.classList.remove('hidden');
    marksSubmitBtn.disabled = false;
    marksSubmitBtn.textContent = 'Submit';
  });
});

async function submitMarks() {
  marksSubmitBtn.disabled = true;
  marksSubmitBtn.textContent = 'Submitting...';

  const payload = {
    examId: state.currentExam.examId,
    rollNo: marksRollNo.value.trim(),
    assignment: Number(marksAssignment.value)
  };
  // Students only ever fill in Q1 — omit Q2-Q7 entirely so the backend
  // leaves those fields alone (fallback to existing/0) instead of zeroing
  // out marks faculty may have already entered.
  const fieldsToSubmit = state.isManualEntry ? ALL_MARK_FIELDS : Q1_FIELDS;
  fieldsToSubmit.forEach((f) => { payload[f] = Number(markInputs[f].value); });
  if (state.isManualEntry && marksStatus.value.trim()) {
    payload.status = marksStatus.value.trim();
  }

  const result = await callApi('submitMarks', payload);

  doneMessage.textContent = `Roll No. ${payload.rollNo} — Final Total: ${result.finalTotal}.`;
  showScreen('done');
}

// ---- Done screen ----
const doneMessage = document.getElementById('doneMessage');
const submitAnotherBtn = document.getElementById('submitAnotherBtn');

submitAnotherBtn.addEventListener('click', () => {
  state.photoFile = null;
  state.isManualEntry = false;
  state.editingRollNo = null;
  showScreen('home');
});

// ---- API helper ----
async function callApi(action, input) {
  const response = await fetch(CONFIG.WEBAPP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight
    body: JSON.stringify(Object.assign({ action }, input))
  });
  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || `Request failed: ${action}`);
  }
  return result;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(blob);
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function escapeAttr(str) {
  return escapeHtml(str);
}

// ---- PWA install ----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Non-fatal: app still works without offline shell caching.
    });
  });
}

// ---- Init ----
loadExams();
