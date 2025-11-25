/////////////////////////////////////////////////////
// CONFIG
/////////////////////////////////////////////////////

const MAX_FINGERPRINTS = 10;
const K_NEIGHBORS = 3; // For k-NN classifier
const RECORD_DURATION = 1500; // 1.5 seconds per sample

/////////////////////////////////////////////////////
// STORAGE + HISTORY
/////////////////////////////////////////////////////

let students = [];
let historyStack = [];
let recording = false;
let audioContext;
let mediaStream;
let sourceNode;
let processorNode;
let audioBuffer = [];

let sortDirection = { name: 'asc', stars: 'desc' };

function pushHistory() {
  const safeCopy = students.map(s => ({
    name: s.name,
    stars: s.stars,
    fingerprints: s.fingerprints.map(f => Array.from(f))
  }));
  historyStack.push(JSON.stringify(safeCopy));
  if (historyStack.length > 20) historyStack.shift();
}

function undo() {
  if (!historyStack.length) return setStatus("Nothing to undo");
  const prev = historyStack.pop();
  const restored = JSON.parse(prev);
  students = restored.map(s => ({
    name: s.name,
    stars: s.stars,
    fingerprints: s.fingerprints.map(f => new Float32Array(f))
  }));
  saveData();
  renderTable();
  setStatus("Undo complete");
}

/////////////////////////////////////////////////////
// LOAD / SAVE
/////////////////////////////////////////////////////

function saveData() {
  const data = students.map(s => ({
    name: s.name,
    stars: s.stars,
    fingerprints: s.fingerprints.map(f => Array.from(f))
  }));
  localStorage.setItem("students", JSON.stringify(data));
}

function loadData() {
  const data = JSON.parse(localStorage.getItem("students") || "[]");
  students = data.map(s => ({
    name: s.name,
    stars: s.stars || 0,
    fingerprints: s.fingerprints.map(f => new Float32Array(f))
  }));
}

/////////////////////////////////////////////////////
// STATUS
/////////////////////////////////////////////////////

const statusEl = document.getElementById('statusText');
function setStatus(text) { statusEl.textContent = text; }

/////////////////////////////////////////////////////
// AUDIO + MFCC
/////////////////////////////////////////////////////

async function initAudio() {
  if (!audioContext) audioContext = new AudioContext();
  if (audioContext.state === 'suspended') await audioContext.resume();

  if (!mediaStream) {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    sourceNode = audioContext.createMediaStreamSource(mediaStream);
  }
}

function normalizeVector(v) {
  const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0)) || 1;
  return v.map(x => x / norm);
}

function averageArray(arrays) {
  const len = arrays[0].length;
  const result = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    result[i] = arrays.reduce((sum, arr) => sum + arr[i], 0) / arrays.length;
  }
  return result;
}

async function recordMFCCSample(duration = RECORD_DURATION) {
  window.scrollTo({ top: 0, behavior: 'smooth' });  // Scroll to top when recording starts
  await initAudio();

  audioBuffer = [];
  processorNode = audioContext.createScriptProcessor(1024, 1, 1);

  processorNode.onaudioprocess = e => {
    audioBuffer.push(Float32Array.from(e.inputBuffer.getChannelData(0)));
  };

  sourceNode.connect(processorNode);
  processorNode.connect(audioContext.destination);

  await new Promise(res => setTimeout(res, duration));

  processorNode.disconnect();

  if (!audioBuffer.length) throw new Error("No audio recorded");

  const mfccFrames = audioBuffer
    .map(f => Meyda.extract("mfcc", f))
    .filter(f => f != null);

  if (!mfccFrames.length) throw new Error("MFCC extraction failed");

  return averageArray(mfccFrames.map(normalizeVector));
}

/////////////////////////////////////////////////////
// ENROLLMENT
/////////////////////////////////////////////////////

const enrollModal = document.getElementById('enrollModal');
const enrollBtn = document.getElementById('enrollBtn');
const closeModal = document.getElementById('closeModal');
const recordEnrollBtn = document.getElementById('recordEnroll');
const undoBtn = document.getElementById('undoBtn');
const clearStarsBtn = document.getElementById('clearStarsBtn');

enrollBtn.onclick = () => {
  enrollModal.style.display = 'block';
  document.getElementById('studentName').focus();
  enrollBtn.blur();
};

closeModal.onclick = () => {
  enrollModal.style.display = 'none';
  closeModal.blur();
};

recordEnrollBtn.onclick = async () => {
  recordEnrollBtn.blur();
  const name = document.getElementById('studentName').value.trim();
  if (!name) return alert("Enter a name");

  enrollModal.style.display = 'none';
  recordEnrollBtn.disabled = true;

  try {
    const samples = [];
    for (let i = 1; i <= MAX_FINGERPRINTS; i++) {
      setStatus(`Recording sample ${i}/${MAX_FINGERPRINTS} for ${name}...`);
      samples.push(await recordMFCCSample());
    }

    pushHistory();
    let student = students.find(s => s.name === name);
    if (student) {
      student.fingerprints.push(...samples);
      while (student.fingerprints.length > MAX_FINGERPRINTS) student.fingerprints.shift();
    } else {
      students.push({ name, fingerprints: samples, stars: 0 });
    }

    saveData();
    renderTable();
    setStatus(`Enrolled ${name}`);
  } catch (err) {
    console.error(err);
    setStatus("Failed to record");
  } finally {
    recordEnrollBtn.disabled = false;
    document.getElementById('studentName').value = '';
  }
};

undoBtn.onclick = () => {
  undoBtn.blur();
  undo();
};

clearStarsBtn.onclick = () => {
  if (!students.length) return setStatus("No students to clear stars for");
  if (!confirm("Are you sure you want to clear all stars?")) return;

  pushHistory();
  students.forEach(s => s.stars = 0);
  saveData();
  renderTable();

  // Highlight all rows briefly
  const tableRows = document.querySelectorAll('#starTable tr');
  tableRows.forEach(row => row.classList.add('highlighted-row'));

  // Remove the highlight after the animation ends
  setTimeout(() => {
    tableRows.forEach(row => row.classList.remove('highlighted-row'));
  }, 1000);  // Keep the highlight for 1 second

  setStatus("All stars cleared");
  clearStarsBtn.blur();
};

/////////////////////////////////////////////////////
// TABLE RENDERING
/////////////////////////////////////////////////////

function renderTable() {
  const table = document.getElementById('starTable');
  table.innerHTML = `<tr>
    <th onclick="sortTable('name')">Student <span id="nameSortArrow">${sortDirection.name === 'asc' ? '↑' : '↓'}</span></th>
    <th onclick="sortTable('stars')">Stars <span id="starsSortArrow">${sortDirection.stars === 'asc' ? '↑' : '↓'}</span></th>
    <th>Actions</th>
  </tr>`;

  students.forEach((s, idx) => {
    const row = document.createElement('tr');
    row.dataset.name = s.name;
    row.innerHTML = `
      <td>${s.name}</td>
      <td>${'⭐'.repeat(s.stars)} (${s.stars})</td>
      <td>
        <button class="add-star-btn" data-index="${idx}" title="Add a Star">⭐</button>
        <button class="remove-star-btn" data-index="${idx}" title="Remove a Star">❌</button>
        <button class="rerecord-btn" data-index="${idx}" title="Re-record Samples">🎤</button>
        <button class="drop-student-btn" data-index="${idx}" title="Drop ${s.name}">🗑️</button>
      </td>
    `;
    table.appendChild(row);
  });

  updateStudentCount();
}

function scrollToStudent(name) {
  const row = document.querySelector(`#starTable tr[data-name="${name}"]`);
  if (row) {
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.add('row-highlight');
    setTimeout(() => {
      row.classList.remove('row-highlight');
    }, 1000);
  }
}

/////////////////////////////////////////////////////
// k-NN CLASSIFIER
/////////////////////////////////////////////////////

function euclideanDist(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

function classifyFingerprint(fingerprint) {
  let distances = [];
  students.forEach(s => {
    s.fingerprints.forEach(f => {
      distances.push({ name: s.name, dist: euclideanDist(fingerprint, f) });
    });
  });

  distances.sort((a, b) => a.dist - b.dist);
  const kNearest = distances.slice(0, K_NEIGHBORS);

  const counts = {};
  kNearest.forEach(item => counts[item.name] = (counts[item.name] || 0) + 1);

  let best = null, bestCount = 0;
  for (let name in counts) {
    if (counts[name] > bestCount) {
      best = name;
      bestCount = counts[name];
    }
  }

  return best;
}

/////////////////////////////////////////////////////
// AWARD STAR
/////////////////////////////////////////////////////

async function matchAndAddStar() {
  if (!students.length) return;
  setStatus("Recording...");
  try {
    const fingerprint = normalizeVector(await recordMFCCSample());
    const matchedName = classifyFingerprint(fingerprint);

    if (matchedName) {
      const student = students.find(s => s.name === matchedName);
      pushHistory();
      student.stars++;
      saveData();
      renderTable();
      setStatus(`Star awarded to ${matchedName}`);
      scrollToStudent(matchedName);
    } else {
      setStatus("No match found");
    }
  } catch (err) {
    console.error(err);
    setStatus("Recording failed");
  }
}

/////////////////////////////////////////////////////
// KEYBOARD + TABLE ACTIONS
/////////////////////////////////////////////////////

document.addEventListener('keydown', e => {
  if (e.code === 'Space' && !recording) {
    recording = true;
    e.preventDefault();
    matchAndAddStar().finally(() => recording = false);
  }
});

document.getElementById('starTable').addEventListener('click', async (e) => {
  const idx = e.target.dataset.index;
  if (!idx) return;
  e.target.blur();

  if (e.target.classList.contains('add-star-btn')) {
    pushHistory();
    students[idx].stars++;
    saveData();
    renderTable();
    setStatus(`Added a star to ${students[idx].name}`);
    scrollToStudent(students[idx].name);
  }

  if (e.target.classList.contains('remove-star-btn')) {
    pushHistory();
    if (students[idx].stars > 0) students[idx].stars--;
    saveData();
    renderTable();
    setStatus(`Removed a star from ${students[idx].name}`);
  }

  if (e.target.classList.contains('rerecord-btn')) {
    if (!confirm(`Re-record ALL samples for ${students[idx].name}?`)) return;
    pushHistory();
    try {
      const newSamples = [];
      for (let i = 1; i <= MAX_FINGERPRINTS; i++) {
        setStatus(`Re-recording sample ${i}/${MAX_FINGERPRINTS} for ${students[idx].name}...`);
        newSamples.push(await recordMFCCSample());
      }
      students[idx].fingerprints = newSamples;
      saveData();
      renderTable();
      setStatus(`Re-recorded ${students[idx].name}`);
    } catch (err) {
      console.error(err);
      setStatus("Failed to re-record");
    }
  }

  if (e.target.classList.contains('drop-student-btn')) {
    if (!confirm(`Are you sure you want to drop ${students[idx].name}?`)) return;
    pushHistory();
    const droppedName = students[idx].name;
    students.splice(idx, 1);
    saveData();
    renderTable();
    setStatus(`Dropped ${droppedName}`);
  }
});

/////////////////////////////////////////////////////
// SORTING
/////////////////////////////////////////////////////

function sortTable(column) {
  if (column === 'name') {
    sortDirection.name = sortDirection.name === 'asc' ? 'desc' : 'asc';
    students.sort((a, b) => sortDirection.name === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name));
  } else if (column === 'stars') {
    sortDirection.stars = sortDirection.stars === 'asc' ? 'desc' : 'asc';
    students.sort((a, b) => sortDirection.stars === 'asc' ? a.stars - b.stars : b.stars - a.stars);
  }
  renderTable();
}

/////////////////////////////////////////////////////
// STUDENT COUNT + BACK TO TOP
/////////////////////////////////////////////////////

function updateStudentCount() {
  const countEl = document.getElementById('studentCount');
  countEl.textContent = `Students: ${students.length}`;
}

const backToTopBtn = document.getElementById('backToTop');

window.onscroll = () => {
  if (document.body.scrollTop > 100 || document.documentElement.scrollTop > 100) {
    backToTopBtn.style.display = "block";
  } else {
    backToTopBtn.style.display = "none";
  }
};

backToTopBtn.onclick = () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

/////////////////////////////////////////////////////
// INIT
/////////////////////////////////////////////////////

loadData();
renderTable();
setStatus("Ready");
