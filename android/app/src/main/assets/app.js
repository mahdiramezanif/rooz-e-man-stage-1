'use strict';

// مرحلهٔ سوم «روزِ من»: تقویم و یادآوری + پل اعلان آفلاین اندروید.
// تاریخ داخلی میلادی (YYYY-MM-DD) است؛ تاریخ‌های نشان‌داده‌شده شمسی‌اند.
const DB_NAME = 'rooz-e-man-local';
const DB_VERSION = 2;
const STORE_NAME = 'weeklyTasks';
const REMINDER_STORE = 'reminders';
const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
const persianNumber = new Intl.NumberFormat('fa-IR', { useGrouping: false });
const PERSIAN_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const persianNumericParts = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
  year: 'numeric', month: 'numeric', day: 'numeric'
});
const persianFullDate = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  day: 'numeric', month: 'long', year: 'numeric', numberingSystem: 'arabext'
});
const persianDayMonth = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  day: 'numeric', month: 'long', numberingSystem: 'arabext'
});

let db = null;
let tasks = [];
let reminders = [];
let reminderFilter = 'pending';
let weekStart = startOfWeek(new Date());
let toastTimer;
const REPEAT_TYPES = new Set(['none', 'weekly', 'monthly', 'yearly']);
const REPEAT_NAMES = {none: 'بدون تکرار', weekly: 'هفتگی', monthly: 'ماهانه (شمسی)', yearly: 'سالانه (شمسی)'};
const nativeAvailable = () => Boolean(window.AndroidPlanner && typeof window.AndroidPlanner.syncRules === 'function');
let nativeSyncLast = null;
let localDataLoaded = false;

const byId = (id) => document.getElementById(id);
const weekGrid = byId('weekGrid');
const dialog = byId('taskDialog');
const form = byId('taskForm');
const reminderDialog = byId('reminderDialog');
const reminderForm = byId('reminderForm');

function localNoon(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
}
function addDays(date, days) {
  const result = localNoon(date);
  result.setDate(result.getDate() + days);
  return result;
}
function startOfWeek(date) {
  const noon = localNoon(date);
  const daysSinceSaturday = (noon.getDay() + 1) % 7;
  return addDays(noon, -daysSinceSaturday);
}
function isoDay(date) {
  return [String(date.getFullYear()).padStart(4, '0'),
          String(date.getMonth() + 1).padStart(2, '0'),
          String(date.getDate()).padStart(2, '0')].join('-');
}
function parseIsoDay(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}
function isValidDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const result = parseIsoDay(value);
  return !Number.isNaN(result.getTime()) && isoDay(result) === value;
}
function isValidTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
function faNumber(number) {
  return persianNumber.format(number);
}
function faDigits(text) {
  return String(text).replace(/[0-9]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
}
function dayParts(date) {
  const parts = persianDayMonth.formatToParts(date);
  return {
    day: parts.find((p) => p.type === 'day')?.value || '',
    month: parts.find((p) => p.type === 'month')?.value || ''
  };
}
function daysOfWeek() {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}
function getPersianYmd(date) {
  const parts = persianNumericParts.formatToParts(date);
  const numberPart = (type) => Number(parts.find((p) => p.type === type)?.value);
  return { year: numberPart('year'), month: numberPart('month'), day: numberPart('day') };
}
function normalizeDigits(text) {
  return String(text).replace(/[۰-۹]/g, (ch) => String(ch.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (ch) => String(ch.charCodeAt(0) - 1632));
}
function persianDateToGregorian(year, month, day) {
  if (!Number.isInteger(year) || year < 1 || year > 3000 || !Number.isInteger(month) ||
      month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > 31) return null;
  const spring = new Date(year + 621, 2, 21, 12);
  let firstFarvardin = null;
  for (let delta = -10; delta <= 10; delta++) {
    const candidate = addDays(spring, delta);
    const parts = getPersianYmd(candidate);
    if (parts.year === year && parts.month === 1 && parts.day === 1) {
      firstFarvardin = candidate;
      break;
    }
  }
  if (!firstFarvardin) return null;
  const dayOffset = (month <= 6 ? (month - 1) * 31 : 186 + (month - 7) * 30) + day - 1;
  const converted = addDays(firstFarvardin, dayOffset);
  const actual = getPersianYmd(converted);
  return actual.year === year && actual.month === month && actual.day === day ? converted : null;
}
function updateJumpControls(date) {
  const { year, month, day } = getPersianYmd(date);
  byId('jumpYear').value = faNumber(year);
  byId('jumpMonth').value = String(month);
  byId('jumpDay').value = String(day);
}
function setupJumpControls() {
  const monthSelect = byId('jumpMonth');
  const daySelect = byId('jumpDay');
  PERSIAN_MONTHS.forEach((name, i) => {
    const option = document.createElement('option');
    option.value = String(i + 1);
    option.textContent = name;
    monthSelect.append(option);
  });
  for (let d = 1; d <= 31; d++) {
    const option = document.createElement('option');
    option.value = String(d);
    option.textContent = faNumber(d);
    daySelect.append(option);
  }
}
function jumpToWeek(event) {
  event.preventDefault();
  const year = Number(normalizeDigits(byId('jumpYear').value.trim()));
  const month = Number(byId('jumpMonth').value);
  const day = Number(byId('jumpDay').value);
  const target = persianDateToGregorian(year, month, day);
  if (!target) return showToast('تاریخ شمسی معتبر نیست؛ لطفاً روز، ماه و سال را بررسی کن.');
  weekStart = startOfWeek(target);
  renderWeek();
  showToast('هفتهٔ انتخاب‌شده نمایش داده شد.');
}
function makeId() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function textNode(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}
function showToast(message) {
  const toast = byId('toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3300);
}
function setError(message) {
  const error = byId('formError');
  error.textContent = message;
  error.hidden = !message;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB در این مرورگر فعال نیست.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('date', 'date', { unique: false });
      }
      if (!database.objectStoreNames.contains(REMINDER_STORE)) {
        const store = database.createObjectStore(REMINDER_STORE, { keyPath: 'id' });
        store.createIndex('date', 'date', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('امکان بازکردن پایگاه داده وجود ندارد.'));
    request.onblocked = () => reject(new Error('یک نسخهٔ دیگر برنامه مانع دسترسی به داده‌ها شده است.'));
  });
}
function readAllTasks() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}
function putTask(task) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(task);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
function deleteTask(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
function replaceAllTasks(importedTasks) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    importedTasks.forEach((task) => store.put(task));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
function readAllReminders() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REMINDER_STORE, 'readonly');
    const request = tx.objectStore(REMINDER_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}
function putReminder(reminder) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REMINDER_STORE, 'readwrite');
    tx.objectStore(REMINDER_STORE).put(reminder);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
function deleteReminder(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REMINDER_STORE, 'readwrite');
    tx.objectStore(REMINDER_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
function replaceBackupData(importedTasks, importedReminders) {
  // Both stores are replaced in one transaction, so failed imports cannot leave partial data.
  const storeNames = importedReminders === null ? [STORE_NAME] : [STORE_NAME, REMINDER_STORE];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, 'readwrite');
    const taskStore = tx.objectStore(STORE_NAME);
    taskStore.clear();
    importedTasks.forEach((task) => taskStore.put(task));
    if (importedReminders !== null) {
      const reminderStore = tx.objectStore(REMINDER_STORE);
      reminderStore.clear();
      importedReminders.forEach((item) => reminderStore.put(item));
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
async function refresh() {
  [tasks, reminders] = await Promise.all([readAllTasks(), readAllReminders()]);
  localDataLoaded = true;
  renderWeek();
  renderReminders();
  syncToNative();
  renderNotificationCenter();
}
function renderWeek() {
  const days = daysOfWeek();
  const first = days[0];
  const last = days[6];
  updateJumpControls(first);
  byId('weekTitle').textContent = `${persianFullDate.format(first)} تا ${persianFullDate.format(last)}`;
  byId('weekSubtitle').textContent = 'شنبه تا جمعه · تقویم هجری شمسی';
  const dates = new Set(days.map(isoDay));
  const weeklyTasks = tasks.filter((task) => dates.has(task.date));
  byId('totalCount').textContent = faNumber(weeklyTasks.length);
  byId('doneCount').textContent = faNumber(weeklyTasks.filter((task) => task.done).length);
  byId('remainingCount').textContent = faNumber(weeklyTasks.filter((task) => !task.done).length);
  const today = isoDay(new Date());
  const fragment = document.createDocumentFragment();
  days.forEach((day, index) => {
    const date = isoDay(day);
    const events = weeklyTasks.filter((task) => task.date === date)
      .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
    const card = document.createElement('article');
    card.className = 'day-card' + (date === today ? ' today' : '');
    const header = textNode('div', '', 'day-head');
    const headLine = textNode('div', '', 'day-headline');
    const { day: persianDay, month } = dayParts(day);
    headLine.append(textNode('div', persianDay, 'date-tile'));
    const labels = document.createElement('div');
    labels.append(textNode('div', WEEKDAYS[index], 'day-name'));
    labels.append(textNode('div', `${month}${date === today ? ' · امروز' : ''}`, 'day-month'));
    headLine.append(labels);
    header.append(headLine, textNode('span', `${faNumber(events.length)} برنامه`, 'day-count' + (events.length ? ' has-events' : '')));
    card.append(header);
    const eventList = textNode('div', '', 'events');
    if (!events.length) {
      eventList.append(textNode('div', 'هنوز برنامه‌ای برای این روز نداری.', 'empty-day'));
    }
    events.forEach((event) => {
      const item = document.createElement('div');
      item.className = 'event' + (event.done ? ' done' : '');
      const main = textNode('div', '', 'event-main');
      const info = textNode('div', '', 'event-info');
      info.append(textNode('div', `${event.start} – ${event.end}`, 'event-time'));
      info.append(textNode('div', event.title, 'event-title'));
      if (event.notes) info.append(textNode('div', event.notes, 'event-notes'));
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.className = 'done-toggle';
      toggle.checked = Boolean(event.done);
      toggle.dataset.taskId = event.id;
      toggle.setAttribute('aria-label', `علامت انجام‌شدنِ ${event.title}`);
      main.append(info, toggle);
      const actions = textNode('div', '', 'event-actions');
      const edit = textNode('button', 'ویرایش', 'text-btn');
      edit.type = 'button';
      edit.dataset.action = 'edit';
      edit.dataset.taskId = event.id;
      const remove = textNode('button', 'حذف', 'text-btn danger');
      remove.type = 'button';
      remove.dataset.action = 'remove';
      remove.dataset.taskId = event.id;
      actions.append(edit, remove);
      item.append(main, actions);
      if (event.notifyEnabled) {
        info.append(textNode('div', `🔔 ${getTaskNotifyLabel(event.notifyOffset || 0)} · ${REPEAT_NAMES[event.notifyRepeat || 'none']}`, 'event-notes'));
      }
      eventList.append(item);
    });
    card.append(eventList);
    const add = textNode('button', '＋ افزودن برنامه به این روز', 'add-day');
    add.type = 'button';
    add.dataset.action = 'add';
    add.dataset.date = date;
    card.append(add);
    fragment.append(card);
  });
  weekGrid.replaceChildren(fragment);
}
function populateDays(selectedDay) {
  const dropdown = byId('taskDay');
  dropdown.replaceChildren();
  daysOfWeek().forEach((date, index) => {
    const option = document.createElement('option');
    option.value = isoDay(date);
    option.textContent = `${WEEKDAYS[index]}، ${persianFullDate.format(date)}`;
    dropdown.append(option);
  });
  dropdown.value = selectedDay;
}
function openTaskDialog({ date, task = null } = {}) {
  form.reset();
  setError('');
  byId('taskId').value = task?.id || '';
  byId('dialogTitle').textContent = task ? 'ویرایش برنامه' : 'برنامهٔ جدید';
  byId('saveTask').textContent = task ? 'ذخیرهٔ تغییرات' : 'ذخیرهٔ برنامه';
  const today = isoDay(new Date());
  const selectedDay = task?.date || date || (daysOfWeek().some((day) => isoDay(day) === today) ? today : isoDay(weekStart));
  populateDays(selectedDay);
  byId('taskTitle').value = task?.title || '';
  byId('taskStart').value = task?.start || '09:00';
  byId('taskEnd').value = task?.end || '10:00';
  byId('taskNotes').value = task?.notes || '';
  byId('taskNotify').value = task?.notifyEnabled ? String(task.notifyOffset || 0) : 'off';
  byId('taskRepeat').value = task?.notifyRepeat || 'none';
  dialog.showModal();
  requestAnimationFrame(() => byId('taskTitle').focus());
}
async function submitTask(event) {
  event.preventDefault();
  if (!db) return;
  setError('');
  const title = byId('taskTitle').value.trim();
  const date = byId('taskDay').value;
  const start = byId('taskStart').value;
  const end = byId('taskEnd').value;
  const notes = byId('taskNotes').value.trim();
  const notifyEnabled = byId('taskNotify').value !== 'off';
  const notifyOffset = notifyEnabled ? Number(byId('taskNotify').value) : 0;
  const notifyRepeat = notifyEnabled ? byId('taskRepeat').value : 'none';
  if (![0,5,15,30,60].includes(notifyOffset) || !REPEAT_TYPES.has(notifyRepeat)) return setError('تنظیم اعلان معتبر نیست.');
  if (!title) return setError('لطفاً عنوان برنامه را بنویس.');
  if (title.length > 100 || notes.length > 2000) return setError('عنوان یا توضیحات بیش از اندازه طولانی است.');
  if (!isValidDay(date) || !isValidTime(start) || !isValidTime(end)) return setError('روز یا ساعت واردشده معتبر نیست.');
  if (end <= start) return setError('ساعت پایان باید بعد از ساعت شروع باشد (هر برنامه در یک روز ثبت می‌شود).');
  const previous = tasks.find((task) => task.id === byId('taskId').value);
  const task = {
    id: previous?.id || makeId(),
    title, date, start, end, notes, notifyEnabled, notifyOffset, notifyRepeat,
    done: previous?.done || false,
    updatedAt: new Date().toISOString()
  };
  const saveButton = byId('saveTask');
  saveButton.disabled = true;
  try {
    await putTask(task);
    await refresh();
    dialog.close();
    showToast(previous ? 'برنامه ویرایش شد.' : 'برنامه با موفقیت ثبت شد.');
  } catch (error) {
    console.error(error);
    setError('ذخیره انجام نشد. لطفاً فضای ذخیره‌سازی مرورگر را بررسی کن.');
  } finally {
    saveButton.disabled = false;
  }
}
async function onWeekGridClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'add') return openTaskDialog({ date: button.dataset.date });
  const task = tasks.find((item) => item.id === button.dataset.taskId);
  if (!task) return;
  if (action === 'edit') return openTaskDialog({ task });
  if (action === 'remove' && confirm(`برنامهٔ «${task.title}» حذف شود؟`)) {
    try {
      await deleteTask(task.id);
      await refresh();
      showToast('برنامه حذف شد.');
    } catch (error) {
      console.error(error);
      showToast('حذف برنامه انجام نشد.');
    }
  }
}
async function onWeekGridChange(event) {
  const checkbox = event.target.closest('input[data-task-id]');
  if (!checkbox) return;
  const task = tasks.find((item) => item.id === checkbox.dataset.taskId);
  if (!task) return;
  checkbox.disabled = true;
  try {
    await putTask({ ...task, done: checkbox.checked, updatedAt: new Date().toISOString() });
    await refresh();
    showToast(checkbox.checked ? 'آفرین! انجام شد.' : 'به برنامه‌های باقی‌مانده برگشت.');
  } catch (error) {
    console.error(error);
    checkbox.disabled = false;
    checkbox.checked = !checkbox.checked;
    showToast('تغییر وضعیت ذخیره نشد.');
  }
}
function exportBackup() {
  const backup = {
    app: 'rooz-e-man', version: 3, exportedAt: new Date().toISOString(),
    tasks, reminders
  };
  if (nativeAvailable() && typeof window.AndroidPlanner.exportBackup === 'function') {
    window.AndroidPlanner.exportBackup(JSON.stringify(backup, null, 2));
    return;
  }
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `rooz-e-man-backup-${isoDay(new Date())}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
  showToast('پشتیبان برنامه‌ها و یادآوری‌ها آمادهٔ دریافت شد.');
}
function validateBackup(raw) {
  if (!raw || raw.app !== 'rooz-e-man' || ![1, 2, 3].includes(raw.version) ||
    !Array.isArray(raw.tasks) || (raw.version >= 2 && !Array.isArray(raw.reminders))) {
    throw new Error('فایل پشتیبان معتبر نیست یا متعلق به این برنامه نیست.');
  }
  if (raw.tasks.length > 10000) throw new Error('تعداد برنامه‌ها در فایل بیش از حد مجاز است.');
  const seenIds = new Set();
  const importedTasks = raw.tasks.map((item) => {
    if (!item || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 100 ||
      !isValidDay(item.date) || !isValidTime(item.start) || !isValidTime(item.end) || item.end <= item.start ||
      (item.notes != null && (typeof item.notes !== 'string' || item.notes.length > 2000))) {
      throw new Error('یکی از برنامه‌های موجود در فایل، اطلاعات نامعتبر دارد.');
    }
    let id = typeof item.id === 'string' && item.id.length <= 120 && item.id ? item.id : makeId();
    if (seenIds.has(id)) id = makeId();
    seenIds.add(id);
    return {
      id,
      date: item.date,
      title: item.title.trim(),
      start: item.start,
      end: item.end,
      notes: item.notes || '',
      done: item.done === true,
      notifyEnabled: item.notifyEnabled === true,
      notifyOffset: [0,5,15,30,60].includes(item.notifyOffset) ? item.notifyOffset : 0,
      notifyRepeat: REPEAT_TYPES.has(item.notifyRepeat) ? item.notifyRepeat : 'none',
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt.slice(0, 40) : new Date().toISOString()
    };
  });
  if (raw.version === 1) return { tasks: importedTasks, reminders: null, version: 1 };
  if (raw.reminders.length > 10000) throw new Error('تعداد یادآوری‌ها در فایل بیش از حد مجاز است.');
  const seenReminderIds = new Set();
  const importedReminders = raw.reminders.map((item) => {
    if (!item || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 100 ||
      !isValidDay(item.date) || !isValidTime(item.time) ||
      (item.notes != null && (typeof item.notes !== 'string' || item.notes.length > 2000))) {
      throw new Error('یکی از یادآوری‌های موجود در فایل نامعتبر است.');
    }
    let id = typeof item.id === 'string' && item.id.length <= 120 && item.id ? item.id : makeId();
    if (seenReminderIds.has(id)) id = makeId();
    seenReminderIds.add(id);
    return {
      id, title: item.title.trim(), date: item.date, time: item.time,
      notes: item.notes || '', done: item.done === true,
      notifyEnabled: item.notifyEnabled !== false,
      notifyRepeat: REPEAT_TYPES.has(item.notifyRepeat) ? item.notifyRepeat : 'none',
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt.slice(0, 40) : new Date().toISOString()
    };
  });
  return { tasks: importedTasks, reminders: importedReminders, version: raw.version };
}
async function importBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('حجم فایل بیش از ۵ مگابایت است.');
    const imported = validateBackup(JSON.parse(await file.text()));
    const message = imported.version === 1
      ? `این پشتیبان قدیمی شامل ${faNumber(imported.tasks.length)} برنامه است. فقط برنامه‌های هفتگی جایگزین می‌شوند و یادآوری‌های فعلی حفظ خواهند شد. ادامه می‌دهی؟`
      : `با بازیابی، برنامه‌ها و یادآوری‌های فعلی جایگزین ${faNumber(imported.tasks.length)} برنامه و ${faNumber(imported.reminders.length)} یادآوری می‌شوند. ادامه می‌دهی؟`;
    if (!confirm(message)) return;
    await replaceBackupData(imported.tasks, imported.reminders);
    await refresh();
    showToast('بازیابی با موفقیت انجام شد.');
  } catch (error) {
    console.error(error);
    alert(error instanceof SyntaxError ? 'فرمت فایل JSON معتبر نیست.' : (error.message || 'بازیابی انجام نشد.'));
  } finally {
    event.target.value = '';
  }
}
// ---------------------------------------------------------------------------
// Persian-date reminders (v2) enhanced with native Android notification rules (v3).
// ---------------------------------------------------------------------------
function fillReminderDateDropdowns() {
  const monthSelect = byId('reminderMonth');
  const daySelect = byId('reminderDay');
  PERSIAN_MONTHS.forEach((month, index) => {
    const option = document.createElement('option');
    option.value = String(index + 1);
    option.textContent = month;
    monthSelect.append(option);
  });
  for (let day = 1; day <= 31; day++) {
    const option = document.createElement('option');
    option.value = String(day);
    option.textContent = faNumber(day);
    daySelect.append(option);
  }
}
function setReminderPersianDate(date) {
  const {year, month, day} = getPersianYmd(date);
  byId('reminderYear').value = faNumber(year);
  byId('reminderMonth').value = String(month);
  byId('reminderDay').value = String(day);
  previewReminderDate();
}
function selectedReminderDate() {
  const year = Number(normalizeDigits(byId('reminderYear').value.trim()));
  const month = Number(byId('reminderMonth').value);
  const day = Number(byId('reminderDay').value);
  return persianDateToGregorian(year, month, day);
}
function previewReminderDate() {
  const date = selectedReminderDate();
  const label = byId('reminderDatePreview');
  label.textContent = date ? persianFullDate.format(date) : 'تاریخ شمسی نامعتبر است';
  label.classList.toggle('invalid', !date);
}
function setReminderError(message) {
  const element = byId('reminderFormError');
  element.textContent = message;
  element.hidden = !message;
}
function openReminderDialog(reminder = null) {
  reminderForm.reset();
  setReminderError('');
  byId('reminderId').value = reminder?.id || '';
  byId('reminderDialogTitle').textContent = reminder ? 'ویرایش یادآوری' : 'یادآوری جدید';
  byId('saveReminder').textContent = reminder ? 'ذخیرهٔ تغییرات' : 'ذخیرهٔ یادآوری';
  byId('reminderTitle').value = reminder?.title || '';
  byId('reminderNotes').value = reminder?.notes || '';
  byId('reminderTime').value = reminder?.time || '09:00';
  byId('reminderNotify').checked = reminder?.notifyEnabled !== false;
  byId('reminderRepeat').value = reminder?.notifyRepeat || 'none';
  setReminderPersianDate(reminder ? parseIsoDay(reminder.date) : new Date());
  reminderDialog.showModal();
  requestAnimationFrame(() => byId('reminderTitle').focus());
}
async function submitReminder(event) {
  event.preventDefault();
  if (!db) return;
  setReminderError('');
  const title = byId('reminderTitle').value.trim();
  const time = byId('reminderTime').value;
  const notes = byId('reminderNotes').value.trim();
  const notifyEnabled = byId('reminderNotify').checked;
  const notifyRepeat = notifyEnabled ? byId('reminderRepeat').value : 'none';
  if (!REPEAT_TYPES.has(notifyRepeat)) return setReminderError('تکرار اعلان نامعتبر است.');
  const dateValue = selectedReminderDate();
  if (!title) return setReminderError('عنوان یادآوری را وارد کن.');
  if (title.length > 100 || notes.length > 2000) return setReminderError('عنوان یا توضیحات بیش از اندازه طولانی است.');
  if (!dateValue) return setReminderError('تاریخ شمسی درست نیست؛ ماه، روز و سال را بررسی کن.');
  if (!isValidTime(time)) return setReminderError('ساعت یادآوری معتبر نیست.');
  const previous = reminders.find((reminder) => reminder.id === byId('reminderId').value);
  const reminder = {
    id: previous?.id || makeId(), title, date: isoDay(dateValue), time, notes, notifyEnabled, notifyRepeat,
    done: previous?.done || false,
    updatedAt: new Date().toISOString()
  };
  const button = byId('saveReminder');
  button.disabled = true;
  try {
    await putReminder(reminder);
    await refresh();
    reminderDialog.close();
    reminderFilter = 'pending';
    renderReminders();
    showToast(previous ? 'یادآوری ویرایش شد.' : 'یادآوری جدید ثبت شد.');
  } catch (error) {
    console.error(error);
    setReminderError('امکان ذخیره‌سازی وجود ندارد؛ فضای حافظه را بررسی کن.');
  } finally {
    button.disabled = false;
  }
}
function nextOccurrenceLocal({date, time, repeat = 'none', offsetMinutes = 0}, after = new Date()) {
  const original = new Date(`${date}T${time}:00`);
  if (Number.isNaN(original.getTime())) return null;
  const shift = (offsetMinutes || 0) * 60000;
  if (repeat === 'none') return original.getTime() - shift > after.getTime() ? new Date(original.getTime()-shift) : null;
  if (repeat === 'weekly') {
    const days = Math.max(0, Math.floor((after.getTime()-(original.getTime()-shift))/604800000)-2);
    for (let i=days;i<days+6;i++) {
      const next = addDays(original, i*7);
      next.setHours(original.getHours(),original.getMinutes(),0,0);
      if (next.getTime()-shift > after.getTime()) return new Date(next.getTime()-shift);
    }
    return null;
  }
  const {year,month,day} = getPersianYmd(original);
  const step = repeat === 'monthly' ? 1 : 12;
  for(let i=0;i<3600/step;i++) {
    const number = year*12+(month-1)+step*i;
    const y = Math.floor(number/12), m = number%12+1;
    let candidate;
    for(let d=day;d>=1;d--) { candidate=persianDateToGregorian(y,m,d); if(candidate) break; }
    if (!candidate) continue;
    candidate.setHours(original.getHours(),original.getMinutes(),0,0);
    if(candidate.getTime()-shift > after.getTime()) return new Date(candidate.getTime()-shift);
  }
  return null;
}
function getReminderState(reminder, now = new Date()) {
  if (reminder.done) return 'done';
  const next = reminder.notifyRepeat && reminder.notifyRepeat !== 'none' ?
    nextOccurrenceLocal({...reminder,repeat:reminder.notifyRepeat}, now) : null;
  if (next) return isoDay(next) === isoDay(now) ? 'today' : 'upcoming';
  const time = new Date(`${reminder.date}T${reminder.time}:00`);
  if (time.getTime() < now.getTime()) return 'overdue';
  if (reminder.date === isoDay(now)) return 'today';
  return 'upcoming';
}
function renderReminders() {
  const now = new Date();
  const pending = reminders.filter((reminder) => !reminder.done);
  byId('pendingReminders').textContent = faNumber(pending.length);
  byId('overdueReminders').textContent = faNumber(pending.filter((reminder) => getReminderState(reminder, now) === 'overdue').length);
  byId('completedReminders').textContent = faNumber(reminders.length - pending.length);
  const selected = reminders.filter((reminder) => reminderFilter === 'all' ||
    (reminderFilter === 'done' ? reminder.done : !reminder.done));
  selected.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  byId('reminderListCount').textContent = `${faNumber(selected.length)} مورد`;
  document.querySelectorAll('.filter-btn').forEach((button) => {
    const active = button.dataset.filter === reminderFilter;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const fragment = document.createDocumentFragment();
  if (!selected.length) {
    const message = reminderFilter === 'pending' ? 'یادآوریِ انجام‌نشده‌ای نداری. برای ثبت مورد تازه، «یادآوری جدید» را بزن.' :
      (reminderFilter === 'done' ? 'هنوز هیچ یادآوری‌ای را انجام‌شده علامت نزده‌ای.' : 'هنوز یادآوری‌ای ثبت نشده است.');
    fragment.append(textNode('div', message, 'reminders-empty'));
  }
  selected.forEach((reminder) => {
    const status = getReminderState(reminder, now);
    const item = textNode('article', '', `reminder-card status-${status}`);
    const top = textNode('div', '', 'reminder-card-head');
    const titleInfo = textNode('div', '', 'reminder-info');
    const title = textNode('h3', reminder.title, 'reminder-title');
    const dateRow = textNode('div', '', 'reminder-date-row');
    const date = parseIsoDay(reminder.date);
    dateRow.append(textNode('span', `${persianFullDate.format(date)} · ساعت ${faDigits(reminder.time)}`, 'reminder-date'));
    titleInfo.append(title, dateRow);
    if (reminder.notifyEnabled !== false) {
      let caption = `🔔 ${REPEAT_NAMES[reminder.notifyRepeat || 'none']}`;
      if (reminder.notifyRepeat && reminder.notifyRepeat !== 'none' && !reminder.done) {
        const next = nextOccurrenceLocal({...reminder,repeat:reminder.notifyRepeat}, new Date());
        if (next) caption += ` · موعد بعد: ${persianFullDate.format(next)}`;
      }
      titleInfo.append(textNode('div', caption, 'reminder-date'));
    }
    const statusNames = { done: 'انجام‌شده', overdue: 'سررسید گذشته', today: 'امروز', upcoming: 'آینده' };
    top.append(titleInfo, textNode('span', statusNames[status], `status-pill status-pill-${status}`));
    item.append(top);
    if (reminder.notes) item.append(textNode('p', reminder.notes, 'reminder-notes'));
    const bottom = textNode('div', '', 'reminder-card-actions');
    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'reminder-check-label';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'done-toggle';
    checkbox.dataset.reminderId = reminder.id;
    checkbox.checked = Boolean(reminder.done);
    checkbox.setAttribute('aria-label', `علامت انجام‌شدنِ ${reminder.title}`);
    toggleLabel.append(checkbox, textNode('span', 'انجام شد', ''));
    const actions = textNode('div', '', 'reminder-text-actions');
    const edit = textNode('button', 'ویرایش', 'text-btn');
    edit.type = 'button';
    edit.dataset.action = 'edit';
    edit.dataset.reminderId = reminder.id;
    const remove = textNode('button', 'حذف', 'text-btn danger');
    remove.type = 'button';
    remove.dataset.action = 'remove';
    remove.dataset.reminderId = reminder.id;
    actions.append(edit, remove);
    bottom.append(toggleLabel, actions);
    item.append(bottom);
    fragment.append(item);
  });
  byId('reminderList').replaceChildren(fragment);
}
async function onReminderClick(event) {
  const button = event.target.closest('button[data-action][data-reminder-id]');
  if (!button) return;
  const reminder = reminders.find((item) => item.id === button.dataset.reminderId);
  if (!reminder) return;
  if (button.dataset.action === 'edit') return openReminderDialog(reminder);
  if (button.dataset.action === 'remove' && confirm(`یادآوری «${reminder.title}» حذف شود؟`)) {
    try {
      await deleteReminder(reminder.id);
      await refresh();
      showToast('یادآوری حذف شد.');
    } catch (error) {
      console.error(error);
      showToast('حذف یادآوری انجام نشد.');
    }
  }
}
async function onReminderChange(event) {
  const checkbox = event.target.closest('input[data-reminder-id]');
  if (!checkbox) return;
  const reminder = reminders.find((item) => item.id === checkbox.dataset.reminderId);
  if (!reminder) return;
  checkbox.disabled = true;
  try {
    await putReminder({ ...reminder, done: checkbox.checked, updatedAt: new Date().toISOString() });
    await refresh();
    showToast(checkbox.checked ? 'یادآوری انجام‌شده ثبت شد.' : 'یادآوری به فهرست انتظار برگشت.');
  } catch (error) {
    console.error(error);
    checkbox.checked = !checkbox.checked;
    checkbox.disabled = false;
    showToast('ذخیرهٔ تغییرات انجام نشد.');
  }
}
// Stage 3: the offline Android application schedules alarms itself. The browser
// variant keeps editing and backing up data, but has no reliable offline alarm.
function getTaskNotifyLabel(offset) {
  if (!offset) return 'هنگام شروع';
  return `${faNumber(offset)} دقیقه پیش از شروع`;
}
function buildNotificationRules() {
  return [
    ...tasks.filter(t => t.notifyEnabled && !t.done).map(t => ({
      id: 'task:'+t.id, title: t.title, notes: t.notes || '', date: t.date, time: t.start,
      offsetMinutes: t.notifyOffset || 0, repeat: t.notifyRepeat || 'none', kind: 'task'
    })),
    ...reminders.filter(r => r.notifyEnabled !== false && !r.done).map(r => ({
      id: 'reminder:'+r.id, title: r.title, notes: r.notes || '', date: r.date, time: r.time,
      offsetMinutes: 0, repeat: r.notifyRepeat || 'none', kind: 'reminder'
    }))
  ];
}
function syncToNative() {
  if (!nativeAvailable() || !localDataLoaded) return;
  const data = JSON.stringify(buildNotificationRules());
  if (data === nativeSyncLast) return;
  try {
    window.AndroidPlanner.syncRules(data);
    nativeSyncLast = data;
  } catch (error) { console.warn('Native notification sync failed', error); }
}
function getNativeStatus() {
  if (!nativeAvailable()) return null;
  try {return JSON.parse(window.AndroidPlanner.getStatus());} catch {return null;}
}
function requestNativePermissions() {
  if (!nativeAvailable()) { showToast('اعلان آفلاین فقط در نسخهٔ اندروید فعال است.'); return; }
  window.AndroidPlanner.requestPermissions();
}
function testNativeNotification() {
  if (!nativeAvailable()) { showToast('این آزمایش به برنامهٔ اندروید نیاز دارد.'); return; }
  window.AndroidPlanner.testNotification();
  setTimeout(renderNotificationCenter, 400);
}
function acknowledgeFromInbox(event) {
  const button = event.target.closest('button[data-occurrence]');
  if (!button || !nativeAvailable()) return;
  window.AndroidPlanner.acknowledge(button.dataset.id, button.dataset.occurrence);
  setTimeout(renderNotificationCenter, 150);
}
function renderNotificationCenter() {
  const status = getNativeStatus();
  byId('nativeStatus').textContent = !status ? 'نسخهٔ مرورگر: اعلان آفلاین در زمان بسته بودن برنامه فعال نیست.' :
    (!status.notifications ? 'اجازهٔ نمایش اعلان داده نشده است.' :
    (!status.exact ? 'اجازهٔ هشدار دقیق داده نشده؛ هشدارها ممکن است با تأخیر برسند.' : 'اعلان آفلاین و هشدار دقیق فعال‌اند.'));
  byId('permissionBtn').hidden = !status || (status.notifications && status.exact);
  byId('testNotificationBtn').disabled = !status || !status.notifications;
  const node = byId('notificationInbox');
  node.replaceChildren();
  if (!status) {
    node.append(textNode('p', 'برای دریافت اعلان‌های واقعیِ آفلاین، APK اندروید را نصب کن. در نسخهٔ وب می‌توانی زمان و تکرار یادآوری‌ها را ثبت و ویرایش کنی.', 'reminders-empty'));
    byId('inboxCount').textContent = '—';
    return;
  }
  let inbox = [];
  try { inbox = JSON.parse(window.AndroidPlanner.getInbox()); } catch (e) { console.warn(e); }
  byId('inboxCount').textContent = faNumber(inbox.length);
  if (!inbox.length) node.append(textNode('p', 'هنوز اعلان مشاهده‌نشده‌ای نداری.', 'reminders-empty'));
  inbox.slice().sort((a,b) => b.occurrence-a.occurrence).forEach(item => {
    const card = textNode('div', '', 'inbox-card');
    card.append(textNode('strong', item.title, ''));
    card.append(textNode('span', `${persianFullDate.format(new Date(item.occurrence))} · ${faDigits(new Date(item.occurrence).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'}))}`, 'reminder-date'));
    const btn = textNode('button', '✓ مشاهده شد', 'outline-btn');
    btn.dataset.id = item.id;
    btn.dataset.occurrence = String(item.occurrence);
    btn.type = 'button';
    card.append(btn);
    node.append(card);
  });
}
window.onNativeStatusChanged = function() {
  nativeSyncLast = null;
  syncToNative();
  renderNotificationCenter();
};

function bindEvents() {
  setupJumpControls();
  fillReminderDateDropdowns();
  byId('newReminderBtn').addEventListener('click', () => openReminderDialog());
  byId('closeReminderDialog').addEventListener('click', () => reminderDialog.close());
  byId('cancelReminder').addEventListener('click', () => reminderDialog.close());
  reminderDialog.addEventListener('click', (event) => { if (event.target === reminderDialog) reminderDialog.close(); });
  reminderForm.addEventListener('submit', submitReminder);
  byId('reminderToday').addEventListener('click', () => setReminderPersianDate(new Date()));
  ['reminderYear', 'reminderMonth', 'reminderDay'].forEach((id) => {
    byId(id).addEventListener('change', previewReminderDate);
    byId(id).addEventListener('input', previewReminderDate);
  });
  byId('reminderList').addEventListener('click', onReminderClick);
  byId('reminderList').addEventListener('change', onReminderChange);
  document.querySelectorAll('.filter-btn').forEach((button) => {
    button.addEventListener('click', () => { reminderFilter = button.dataset.filter; renderReminders(); });
  });
  // Recheck due/overdue state while the app remains open.
  setInterval(() => { if (!document.hidden && db) renderReminders(); }, 60000);
  byId('jumpForm').addEventListener('submit', jumpToWeek);
  byId('prevWeek').addEventListener('click', () => { weekStart = addDays(weekStart, -7); renderWeek(); });
  byId('nextWeek').addEventListener('click', () => { weekStart = addDays(weekStart, 7); renderWeek(); });
  byId('todayBtn').addEventListener('click', () => { weekStart = startOfWeek(new Date()); renderWeek(); });
  byId('newTaskHero').addEventListener('click', () => openTaskDialog());
  byId('closeDialog').addEventListener('click', () => dialog.close());
  byId('cancelTask').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  form.addEventListener('submit', submitTask);
  weekGrid.addEventListener('click', onWeekGridClick);
  weekGrid.addEventListener('change', onWeekGridChange);
  byId('exportBtn').addEventListener('click', exportBackup);
  byId('importBtn').addEventListener('click', () => byId('importFile').click());
  byId('importFile').addEventListener('change', importBackup);
  byId('permissionBtn').addEventListener('click', requestNativePermissions);
  byId('refreshInboxBtn').addEventListener('click', renderNotificationCenter);
  byId('testNotificationBtn').addEventListener('click', testNativeNotification);
  byId('notificationInbox').addEventListener('click', acknowledgeFromInbox);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && db) refresh().catch(console.error);
  });
}
async function main() {
  bindEvents();
  try {
    db = await openDatabase();
    await refresh();
  } catch (error) {
    console.error(error);
    document.querySelector('.local-tag').textContent = 'ذخیره‌سازی در دسترس نیست';
    weekGrid.replaceChildren(textNode('div', 'دسترسی به حافظهٔ محلی ممکن نشد. برنامه را از یک نشانی HTTPS در Chrome باز کن و تنظیمات ذخیره‌سازی مرورگر را بررسی کن.', 'empty-day'));
    byId('newTaskHero').disabled = true;
    byId('exportBtn').disabled = true;
    byId('importBtn').disabled = true;
    byId('newReminderBtn').disabled = true;
    byId('reminderList').replaceChildren(textNode('div', 'دسترسی به ذخیره‌سازی یادآوری‌ها ممکن نشد.', 'reminders-empty'));
    showToast('اتصال به پایگاه دادهٔ محلی برقرار نشد.');
  }
  if ('serviceWorker' in navigator && !nativeAvailable() && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('Offline setup:', error));
    });
  }
}
main();
