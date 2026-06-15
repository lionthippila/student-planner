/* ===========================
   KU TIMETABLE APP
   =========================== */

// ---- CONSTANTS ----
const DAYS_SHORT  = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const DAYS_FULL   = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const START_HOUR  = 7;
const END_HOUR    = 20;   // exclusive → slots 7:00–19:30
const TOTAL_SLOTS = (END_HOUR - START_HOUR) * 2;  // 26 half-hour slots
const SLOT_W      = 56;   // px per 30-min slot

const COLORS = [
  '#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6',
  '#EC4899','#14B8A6','#F97316','#6366F1','#84CC16',
  '#06B6D4','#A855F7','#E11D48','#059669','#D97706',
];

// ---- STATE ----
let planCourses = [];
let editingId   = null;
let pendingDeleteId = null;

// drag state
let dragCourseId   = null;
let dragOffsetSlot = 0;
let visibleStart   = 0; // absolute slot of first visible column in plan mode

// ---- HELPERS ----
function timeToSlot(t) {
  const [h, m] = t.split(':').map(Number);
  return (h - START_HOUR) * 2 + (m >= 30 ? 1 : 0);
}
function slotToTime(s) {
  const h = START_HOUR + Math.floor(s / 2);
  const m = s % 2 === 0 ? '00' : '30';
  return `${String(h).padStart(2,'0')}:${m}`;
}
function uid() { return Math.random().toString(36).slice(2,9); }
function dayLabel(d) { return DAYS_FULL[d-1]; }


// ---- DYNAMIC VISIBLE RANGE ----
function getVisibleRange(courses) {
  if (!courses.length) {
    return { start: timeToSlot('08:00'), end: timeToSlot('18:00') };
  }
  const starts = courses.map(c => timeToSlot(c.startTime));
  const ends   = courses.map(c => timeToSlot(c.endTime));
  // pad 1 hour before, 30 min after, snap to hour
  const rawStart = Math.min(...starts) - 2;
  const rawEnd   = Math.max(...ends)   + 1;
  const snappedStart = Math.max(0,           Math.floor(rawStart / 2) * 2);
  const snappedEnd   = Math.min(TOTAL_SLOTS, Math.ceil(rawEnd   / 2) * 2);
  return { start: snappedStart, end: snappedEnd };
}

// ---- PLAN TIMETABLE (horizontal: days = rows, time = columns) ----
// สีประจำวันตามธรรมเนียมไทย: จ=เหลือง อ=ชมพู พ=เขียว พฤ=ส้ม ศ=ฟ้า ส=ม่วง
const DAY_ACCENT = ['#EAB308','#EC4899','#22C55E','#F97316','#3B82F6','#8B5CF6'];

function renderPlanTimetable() {
  const el = document.getElementById('plan-timetable');
  if (!el) return;

  const { start, end } = getVisibleRange(planCourses);
  visibleStart = start;
  const visibleCount = end - start;
  const totalW = visibleCount * SLOT_W;

  let html = `<div class="ph-wrap" style="min-width:${totalW + 116}px">`;

  // time header
  html += `<div class="ph-header">`;
  html += `<div class="ph-corner"><span>วัน / เวลา</span></div>`;
  html += `<div class="ph-time-strip">`;
  for (let s = start; s < end; s++) {
    const isHour = s % 2 === 0;
    const isFirst = s === start;
    html += `<div class="ph-time-cell${isHour?' ph-time-hour':' ph-time-half'}${isFirst?' ph-time-first':''}"
      style="width:${SLOT_W}px">${isHour ? slotToTime(s) : ''}</div>`;
  }
  html += `</div></div>`;

  // day rows
  for (let day = 1; day <= 6; day++) {
    const dayCourses = planCourses.filter(c => c.day === day);
    const accent = DAY_ACCENT[day - 1];
    html += `<div class="ph-row" data-day="${day}">`;
    html += `<div class="ph-day-label" style="border-left: 4px solid ${accent}">
      <span class="ph-day-short" style="color:${accent}">${DAYS_SHORT[day-1]}</span>
      <span class="ph-day-full">${DAYS_FULL[day-1]}</span>
    </div>`;
    html += `<div class="ph-cells" data-day="${day}" style="width:${totalW}px">`;

    // grid cells
    for (let s = start; s < end; s++) {
      const isHour  = s % 2 === 0;
      const isFirst = s === start;
      html += `<div class="ph-cell${isHour?' ph-cell-hour':' ph-cell-half'}${isFirst?' ph-cell-first':''}"
        data-day="${day}" data-slot="${s}" style="width:${SLOT_W}px"></div>`;
    }

    // course blocks
    dayCourses.forEach(c => {
      const startSlot = timeToSlot(c.startTime);
      const span      = timeToSlot(c.endTime) - startSlot;
      const left  = (startSlot - start) * SLOT_W + 3;
      const width = span * SLOT_W - 6;
      html += `<div class="ph-course"
        id="cb-${c.id}" data-id="${c.id}"
        data-start-slot="${startSlot}" data-span="${span}"
        draggable="true"
        style="left:${left}px; width:${width}px; background:${c.color};"
        title="${c.name} | ${c.startTime}–${c.endTime}${c.room?' | '+c.room:''}">
        <button class="course-del-btn" onclick="askDelete('${c.id}')" title="ลบ">✕</button>
        <div class="ph-course-name">${c.name}</div>
        <div class="ph-course-sub">${[c.code, c.section?'#'+c.section:'', c.room].filter(Boolean).join(' · ')}</div>
        <div class="ph-course-time">${c.startTime}–${c.endTime}</div>
      </div>`;
    });

    html += `</div></div>`;
  }
  html += `</div>`;

  el.innerHTML = html;
  attachPlanHEvents(el);
}

function attachPlanHEvents(el) {
  // click on empty cell → add
  el.querySelectorAll('.ph-cell').forEach(cell => {
    cell.addEventListener('click', e => {
      if (e.target !== cell) return;
      const day  = parseInt(cell.dataset.day);
      const slot = parseInt(cell.dataset.slot);
      openAddModal(day, slot);
    });
  });

  // drag sources
  el.querySelectorAll('.ph-course').forEach(block => {
    block.addEventListener('dragstart', onDragStart);
    block.addEventListener('dragend',   onDragEnd);
    block.addEventListener('dblclick',  () => openEditModal(block.dataset.id));
  });

  // drop targets — ph-cells rows
  el.querySelectorAll('.ph-cells').forEach(cells => {
    cells.addEventListener('dragover',  onDragOver);
    cells.addEventListener('dragleave', onDragLeave);
    cells.addEventListener('drop',      onDropH);
  });
}

// ---- DRAG HANDLERS ----
function onDragStart(e) {
  dragCourseId = e.currentTarget.dataset.id;
  const blockLeft = e.currentTarget.getBoundingClientRect().left;
  dragOffsetSlot  = Math.floor((e.clientX - blockLeft) / SLOT_W);
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragCourseId);
}

function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  dragCourseId = null;
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}

function onDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget))
    e.currentTarget.classList.remove('drag-over');
}

function onDropH(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (!dragCourseId) return;

  const cells  = e.currentTarget;
  const newDay = parseInt(cells.dataset.day);
  const rect   = cells.getBoundingClientRect();
  let newStartSlot = Math.round((e.clientX - rect.left) / SLOT_W) - dragOffsetSlot + visibleStart;

  const course = planCourses.find(c => c.id === dragCourseId);
  if (!course) return;
  const span = timeToSlot(course.endTime) - timeToSlot(course.startTime);
  newStartSlot = Math.max(0, Math.min(newStartSlot, TOTAL_SLOTS - span));

  course.day       = newDay;
  course.startTime = slotToTime(newStartSlot);
  course.endTime   = slotToTime(newStartSlot + span);

  savePlanToStorage();
  renderPlanTimetable();
  renderCourseList('plan-course-list', planCourses, true);
}

// ---- COURSE LIST ----
function renderCourseList(containerId, courses, isPlan) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!courses.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">${isPlan ? '📋' : '📭'}</div>
      <p>${isPlan ? 'ยังไม่มีวิชา กดปุ่ม "+ เพิ่มวิชา" หรือคลิกที่ตาราง' : 'ไม่มีข้อมูลรายวิชา'}</p>
    </div>`;
    return;
  }

  // deduplicate by code+section for list
  const seen = new Set();
  const unique = [];
  courses.forEach(c => {
    const key = `${c.code}-${c.section}-${c.name}`;
    if (!seen.has(key)) { seen.add(key); unique.push(c); }
  });

  el.innerHTML = unique.map(c => {
    const timeStr = courses.filter(x => x.id===c.id || (x.code===c.code && x.section===c.section))
      .map(x => `${dayLabel(x.day)} ${x.startTime}–${x.endTime}`).join(', ');
    const actions = isPlan
      ? `<button class="course-card-btn" onclick="openEditModal('${c.id}')">แก้ไข</button>
         <button class="course-card-btn del" onclick="askDelete('${c.id}')">ลบ</button>`
      : '';
    return `<div class="course-card">
      <div class="course-card-dot" style="background:${c.color}"></div>
      <div class="course-card-info">
        <div class="course-card-name">${c.name}</div>
        <div class="course-card-sub">${c.code||''}${c.section?' Sec '+c.section:''} ${c.room?'| '+c.room:''} | ${timeStr}</div>
      </div>
      ${actions ? `<div class="course-card-actions">${actions}</div>` : ''}
    </div>`;
  }).join('');
}

// ---- ADD / EDIT MODAL ----
function populateTimeSelects() {
  const startEl = document.getElementById('f-start');
  const endEl   = document.getElementById('f-end');
  startEl.innerHTML = '';
  endEl.innerHTML   = '';
  for (let s = 0; s < TOTAL_SLOTS; s++) {
    const t = slotToTime(s);
    startEl.innerHTML += `<option value="${t}">${t}</option>`;
    if (s > 0) endEl.innerHTML += `<option value="${t}">${t}</option>`;
  }
  endEl.innerHTML += `<option value="${slotToTime(TOTAL_SLOTS)}">${slotToTime(TOTAL_SLOTS)}</option>`;
}

function populateColorPicker(selected) {
  const el = document.getElementById('color-picker');
  el.innerHTML = COLORS.map(c =>
    `<div class="color-swatch${c===selected?' selected':''}"
      style="background:${c}" data-color="${c}"
      onclick="selectColor('${c}')"></div>`
  ).join('');
}

function onDayChange(val) {
  if (!val || editingId) return; // don't override when editing
  populateColorPicker(DAY_ACCENT[parseInt(val) - 1]);
}

function selectColor(color) {
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.toggle('selected', s.dataset.color === color));
}

function getSelectedColor() {
  const el = document.querySelector('.color-swatch.selected');
  return el ? el.dataset.color : COLORS[0];
}

function openAddModal(day, slot) {
  editingId = null;
  populateTimeSelects();
  document.getElementById('modal-title').textContent = 'เพิ่มวิชา';
  document.getElementById('f-id').value      = '';
  document.getElementById('f-code').value    = '';
  document.getElementById('f-section').value = '';
  document.getElementById('f-name').value    = '';
  document.getElementById('f-room').value    = '';
  document.getElementById('f-day').value     = day || '';
  if (slot !== undefined) {
    document.getElementById('f-start').value = slotToTime(slot);
    const endSlot = Math.min(slot + 4, TOTAL_SLOTS);
    document.getElementById('f-end').value   = slotToTime(endSlot);
  } else {
    document.getElementById('f-start').value = '09:00';
    document.getElementById('f-end').value   = '12:00';
  }
  const defaultColor = day ? DAY_ACCENT[day - 1] : COLORS[0];
  populateColorPicker(defaultColor);
  document.getElementById('course-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('f-name').focus(), 100);
}

function openEditModal(id) {
  const c = planCourses.find(x => x.id === id);
  if (!c) return;
  editingId = id;
  populateTimeSelects();
  document.getElementById('modal-title').textContent = 'แก้ไขวิชา';
  document.getElementById('f-id').value      = id;
  document.getElementById('f-code').value    = c.code    || '';
  document.getElementById('f-section').value = c.section || '';
  document.getElementById('f-name').value    = c.name;
  document.getElementById('f-room').value    = c.room    || '';
  document.getElementById('f-day').value     = c.day;
  document.getElementById('f-start').value   = c.startTime;
  document.getElementById('f-end').value     = c.endTime;
  populateColorPicker(c.color);
  document.getElementById('course-modal').classList.remove('hidden');
}

function closeModal() { document.getElementById('course-modal').classList.add('hidden'); }
function closeModalOutside(e) { if (e.target === e.currentTarget) closeModal(); }

function saveCourse(e) {
  e.preventDefault();
  const code     = document.getElementById('f-code').value.trim();
  const section  = document.getElementById('f-section').value.trim();
  const name     = document.getElementById('f-name').value.trim();
  const room     = document.getElementById('f-room').value.trim();
  const day      = parseInt(document.getElementById('f-day').value);
  const startTime = document.getElementById('f-start').value;
  const endTime   = document.getElementById('f-end').value;
  const color    = getSelectedColor();

  if (timeToSlot(endTime) <= timeToSlot(startTime)) {
    alert('เวลาสิ้นสุดต้องมากกว่าเวลาเริ่ม');
    return;
  }

  if (editingId) {
    const idx = planCourses.findIndex(c => c.id === editingId);
    if (idx >= 0) planCourses[idx] = { ...planCourses[idx], code, section, name, room, day, startTime, endTime, color };
  } else {
    planCourses.push({ id: uid(), code, section, name, room, day, startTime, endTime, color });
  }

  closeModal();
  savePlanToStorage();
  renderPlanTimetable();
  renderCourseList('plan-course-list', planCourses, true);
}

// ---- DELETE ----
function askDelete(id) {
  const c = planCourses.find(x => x.id === id);
  if (!c) return;
  pendingDeleteId = id;
  document.getElementById('delete-course-name').textContent = c.name;
  document.getElementById('delete-modal').classList.remove('hidden');
}
function closeDeleteModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('delete-modal').classList.add('hidden');
  pendingDeleteId = null;
}
function confirmDelete() {
  if (!pendingDeleteId) return;
  planCourses = planCourses.filter(c => c.id !== pendingDeleteId);
  document.getElementById('delete-modal').classList.add('hidden');
  pendingDeleteId = null;
  savePlanToStorage();
  renderPlanTimetable();
  renderCourseList('plan-course-list', planCourses, true);
}

// ---- CLEAR ALL ----
function clearPlanCourses() {
  if (!planCourses.length) return;
  if (!confirm('ต้องการล้างวิชาทั้งหมดหรือไม่?')) return;
  planCourses = [];
  savePlanToStorage();
  renderPlanTimetable();
  renderCourseList('plan-course-list', planCourses, true);
}

// ---- EXPORT TEXT ----
function exportPlan() {
  if (!planCourses.length) { alert('ยังไม่มีวิชา'); return; }
  const lines = planCourses.map(c =>
    `${c.code||'—'} ${c.name} Sec${c.section||'—'} | ${dayLabel(c.day)} ${c.startTime}–${c.endTime} | ${c.room||'—'}`
  );
  const text = 'ตารางเรียนวางแผน\n' + '─'.repeat(40) + '\n' + lines.join('\n');
  navigator.clipboard.writeText(text)
    .then(() => alert('คัดลอกแล้ว!'))
    .catch(() => prompt('คัดลอกข้อความด้านล่าง:', text));
}

// ---- EXPORT MENU TOGGLE ----
function toggleExportMenu(e) {
  e.stopPropagation();
  document.getElementById('export-menu').classList.toggle('hidden');
}
document.addEventListener('click', () => {
  const m = document.getElementById('export-menu');
  if (m) m.classList.add('hidden');
});

// ---- EXPORT AS IMAGE / PDF ----
async function exportAsImage(format) {
  document.getElementById('export-menu').classList.add('hidden');
  if (!planCourses.length) { alert('ยังไม่มีวิชา'); return; }

  const btn = document.getElementById('export-btn');
  btn.innerHTML = '⏳ กำลังสร้าง...';
  btn.disabled = true;

  // Build a dedicated export DOM (clean, no interactive bits)
  const exportRoot = buildExportDOM();
  document.body.appendChild(exportRoot);

  try {
    await document.fonts.ready;

    const canvas = await html2canvas(exportRoot, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      scrollX: 0,
      scrollY: 0,
      width:  exportRoot.scrollWidth,
      height: exportRoot.scrollHeight,
    });

    if (format === 'png') {
      const a = document.createElement('a');
      a.download = 'ตารางเรียน.png';
      a.href = canvas.toDataURL('image/png', 1.0);
      a.click();

    } else {
      const { jsPDF } = window.jspdf;
      // canvas is @2x so real pixel size = canvas.width/2
      // 1 pt = 1/72 inch, 1 inch = 96px → 1px = 72/96 pt = 0.75pt
      // jsPDF default unit = pt
      const ptPerPx = 72 / 96;
      const imgWpt = (canvas.width  / 2) * ptPerPx;
      const imgHpt = (canvas.height / 2) * ptPerPx;

      // pick orientation to best fit
      const orient = imgWpt > imgHpt ? 'landscape' : 'portrait';
      const pdf = new jsPDF({ orientation: orient, unit: 'pt', format: 'a4' });
      const pgW = pdf.internal.pageSize.getWidth();
      const pgH = pdf.internal.pageSize.getHeight();
      const margin = 28; // pt (~10mm)
      const maxW = pgW - margin * 2;
      const maxH = pgH - margin * 2;
      const scale = Math.min(maxW / imgWpt, maxH / imgHpt, 1); // never upscale
      const drawW = imgWpt * scale;
      const drawH = imgHpt * scale;
      const x = (pgW - drawW) / 2;
      const y = (pgH - drawH) / 2;
      pdf.addImage(canvas.toDataURL('image/png', 1.0), 'PNG', x, y, drawW, drawH);
      pdf.save('ตารางเรียน.pdf');
    }
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
    console.error(err);
  } finally {
    document.body.removeChild(exportRoot);
    btn.innerHTML = '⬇ Export <span class="export-arrow">▾</span>';
    btn.disabled = false;
  }
}

function buildExportDOM() {
  const { start, end } = getVisibleRange(planCourses);
  const visCount = end - start;
  const SW = 72;   // slot width px in export
  const RH = 80;   // row height px
  const DW = 120;  // day label width px
  const PAD = 32;  // container padding

  const dateStr = new Date().toLocaleDateString('th-TH', { year:'numeric', month:'long', day:'numeric' });
  const uniqueCodes = [...new Set(planCourses.map(c => c.code).filter(Boolean))].length;

  const wrap = document.createElement('div');
  wrap.style.cssText = `
    position:fixed; top:-9999px; left:-9999px;
    background:#ffffff; padding:${PAD}px;
    font-family:'Sarabun',sans-serif;
    width:${DW + visCount * SW + PAD * 2}px;
    box-sizing:border-box;
  `;

  // ── Title ──
  wrap.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-end;
                margin-bottom:20px;padding-bottom:14px;border-bottom:2.5px solid #e2e8f0;">
      <div>
        <div style="font-size:22px;font-weight:800;color:#0f172a;letter-spacing:-.4px;line-height:1.2">
          ตารางเรียนวางแผน
        </div>
        <div style="font-size:12px;color:#64748b;margin-top:5px;font-weight:400">
          สร้างเมื่อ ${dateStr}
        </div>
      </div>
      <div style="text-align:right;font-size:13px;color:#475569;font-weight:600;line-height:1.7">
        <div>${planCourses.length} รายการ</div>
        <div style="color:#94a3b8;font-weight:400">${uniqueCodes} รหัสวิชา</div>
      </div>
    </div>`;

  // ── Timetable ──
  const table = document.createElement('div');
  table.style.cssText = `
    border:1.5px solid #cbd5e1; border-radius:12px;
    overflow:hidden; font-size:12px;`;

  // header row
  let head = `<div style="display:flex;background:#f1f5f9;border-bottom:2px solid #cbd5e1;">`;
  head += `<div style="width:${DW}px;min-width:${DW}px;border-right:2px solid #cbd5e1;
                        padding:10px 8px;font-size:11px;font-weight:600;color:#94a3b8;
                        display:flex;align-items:center;justify-content:center;">วัน / เวลา</div>`;
  for (let s = start; s < end; s++) {
    const isHour = s % 2 === 0;
    const label  = isHour ? slotToTime(s) : '';
    const bl     = s === start ? 'none' : (isHour ? '1.5px solid #cbd5e1' : '1px dashed #dde3eb');
    head += `<div style="width:${SW}px;min-width:${SW}px;border-left:${bl};
                          padding:10px 0 10px 7px;font-size:12px;font-weight:${isHour?'700':'400'};
                          color:#475569;white-space:nowrap;">${label}</div>`;
  }
  head += `</div>`;
  table.innerHTML = head;

  // day rows
  for (let day = 1; day <= 6; day++) {
    const dayCourses = planCourses.filter(c => c.day === day);
    const accent = DAY_ACCENT[day - 1];
    const bg = day % 2 === 0 ? '#fafbfd' : '#ffffff';

    const row = document.createElement('div');
    row.style.cssText = `display:flex;border-bottom:1px solid #e2e8f0;
                          min-height:${RH}px;background:${bg};position:relative;`;
    if (day === 6) row.style.borderBottom = 'none';

    // day label
    row.innerHTML = `<div style="width:${DW}px;min-width:${DW}px;
        border-right:2px solid #e2e8f0;border-left:4px solid ${accent};
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        gap:3px;padding:8px;background:${bg};">
      <span style="font-size:20px;font-weight:900;color:${accent};line-height:1;">${DAYS_SHORT[day-1]}</span>
      <span style="font-size:10px;color:#94a3b8;font-weight:500;">${DAYS_FULL[day-1]}</span>
    </div>`;

    // cells area
    const cells = document.createElement('div');
    cells.style.cssText = `position:relative;display:flex;flex:1;`;
    for (let s = start; s < end; s++) {
      const isHour = s % 2 === 0;
      const bl = s === start ? 'none' : (isHour ? '1.5px solid #e2e8f0' : '1px dashed #edf2f7');
      const cell = document.createElement('div');
      cell.style.cssText = `width:${SW}px;min-width:${SW}px;height:100%;min-height:${RH}px;border-left:${bl};`;
      cells.appendChild(cell);
    }

    // course blocks
    dayCourses.forEach(c => {
      const ss   = timeToSlot(c.startTime);
      const span = timeToSlot(c.endTime) - ss;
      const left = (ss - start) * SW + 3;
      const w    = span * SW - 6;
      const block = document.createElement('div');
      block.style.cssText = `
        position:absolute; top:5px;
        left:${left}px; width:${w}px; height:${RH - 10}px;
        background:${c.color}; color:#ffffff;
        border-radius:8px; padding:7px 10px;
        overflow:hidden; display:flex; flex-direction:column; justify-content:center;
        box-sizing:border-box;
      `;
      // lighten overlay stripe for visual depth (no rgba shadow)
      const textColor = '#ffffff';
      block.innerHTML = `
        <div style="font-size:13px;font-weight:800;color:${textColor};
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
                    line-height:1.2;letter-spacing:-.2px;">${c.name}</div>
        <div style="font-size:11px;color:${textColor};font-weight:500;margin-top:3px;
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
                    opacity:0.9;">
          ${[c.code, c.section?'#'+c.section:'', c.room].filter(Boolean).join(' · ')}
        </div>
        <div style="font-size:11px;color:${textColor};margin-top:2px;
                    white-space:nowrap;opacity:0.85;">${c.startTime}–${c.endTime}</div>
      `;
      cells.appendChild(block);
    });

    row.appendChild(cells);
    table.appendChild(row);
  }

  // ── Legend ──
  const seen = new Set();
  const unique = planCourses.filter(c => {
    const k = `${c.code}-${c.section}-${c.name}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
  const legend = document.createElement('div');
  legend.style.cssText = `margin-top:16px;display:flex;flex-wrap:wrap;gap:8px;`;
  unique.forEach(c => {
    const chip = document.createElement('div');
    chip.style.cssText = `display:flex;align-items:center;gap:7px;
      background:#f8fafc;border:1px solid #e2e8f0;border-radius:20px;
      padding:5px 12px 5px 8px;font-size:12px;`;
    chip.innerHTML = `<span style="width:10px;height:10px;border-radius:50%;background:${c.color};flex-shrink:0;display:inline-block;"></span>
      <span style="color:#1e293b;font-weight:600;">${c.name}</span>
      ${c.code?`<span style="color:#94a3b8;">${c.code}${c.section?' #'+c.section:''}</span>`:''}`;
    legend.appendChild(chip);
  });

  wrap.appendChild(table);
  wrap.appendChild(legend);
  return wrap;
}


// ---- LOCAL STORAGE ----
function savePlanToStorage() {
  localStorage.setItem('ku-plan-courses', JSON.stringify(planCourses));
}
function loadPlanFromStorage() {
  try {
    const raw = localStorage.getItem('ku-plan-courses');
    if (raw) planCourses = JSON.parse(raw);
  } catch {}
}

// ---- INIT ----
function init() {
  populateTimeSelects();
  loadPlanFromStorage();
  renderPlanTimetable();
  renderCourseList('plan-course-list', planCourses, true);

  // keyboard shortcut: Esc closes modals
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeModal();
      document.getElementById('delete-modal').classList.add('hidden');
    }
  });
}

init();
