'use strict';
// Sổ Chi Tiêu — toàn bộ dữ liệu nằm trong một object `state`, mọi màn hình được vẽ lại từ đó.
// Tiền lưu dạng số (VND), ngày lưu dạng 'YYYY-MM-DD'; không còn chuỗi hiển thị trộn với dữ liệu.

const KEY = 'soChiTieuV2';
const FONT_KEY = 'soChiTieuFont'; // cỡ chữ: lựa chọn theo từng thiết bị nên không nằm trong sổ (sao lưu/khôi phục không ghi đè)
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
const pad = n => String(n).padStart(2, '0');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const digits = value => Number(String(value ?? '').replace(/\D/g, '')) || 0;
const vnd = n => `${Math.round(n).toLocaleString('vi-VN')} ₫`;
const short = n => n >= 1e6 ? `${(n / 1e6).toFixed(2).replace(/\.?0+$/, '').replace('.', ',')} tr` : vnd(n);
const compact = n => n >= 1e6 ? `${+(n / 1e6).toFixed(1)}tr`.replace('.', ',') : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n));
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthOf = d => isoOf(d).slice(0, 7);
const shiftMonth = (key, n) => { const [y, m] = key.split('-').map(Number); return monthOf(new Date(y, m - 1 + n, 1)); };
const monthText = key => `Tháng ${Number(key.slice(5))}, ${key.slice(0, 4)}`;
const daysIn = key => new Date(Number(key.slice(0, 4)), Number(key.slice(5)), 0).getDate();

// ---------- Dữ liệu ----------
const DEFAULT_EXPENSE = ['Ăn uống', 'Đi chợ', 'Nhà ở', 'Đi lại', 'Mua sắm', 'Y tế', 'Giáo dục', 'Giải trí', 'Khác'];
const DEFAULT_INCOME = ['Lương', 'Thưởng', 'Thu nhập khác'];
const freshState = () => ({
  profile: { name: '', email: '' },
  expenseCats: [...DEFAULT_EXPENSE],
  incomeCats: [...DEFAULT_INCOME],
  accounts: [{ id: uid(), name: 'Ví tiền mặt', type: 'Tiền mặt', opening: 0 }],
  transactions: [], // { id, type: expense|income|transfer, amount, category, account, to, note, date, location, related, recurringId?, isSample? }
  budgets: [],      // { id, category, limit }  — áp dụng cho mọi tháng
  recurring: [],    // { id, name, amount, category, day, account, active }
  totalBudget: 0,   // tổng ngân sách mỗi tháng; 0 = chưa đặt, tổng được cộng từ các hạn mức nhóm
  notifyBudget: true
});

const isIsoDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
// Dữ liệu sai cấu trúc (file sao lưu sửa tay, lỗi cũ...) làm mọi màn hình ném lỗi, nên phải chặn từ đầu vào.
function validState(s) {
  return Boolean(s) && Array.isArray(s.transactions) && Array.isArray(s.accounts) && s.accounts.length > 0
    && s.accounts.every(a => a && typeof a.id === 'string' && typeof a.name === 'string')
    && s.transactions.every(t => t && typeof t.id === 'string' && ['expense', 'income', 'transfer'].includes(t.type) && Number.isFinite(t.amount) && isIsoDate(t.date))
    && [s.budgets, s.recurring, s.expenseCats, s.incomeCats].every(x => x === undefined || Array.isArray(x));
}
function load() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); const saved = JSON.parse(raw); if (validState(saved)) return { ...freshState(), ...saved }; } catch { /* JSON hỏng */ }
  if (raw) try { localStorage.setItem(`${KEY}-hong`, raw); } catch { /* không giữ được bản hỏng */ } // giữ lại bản hỏng để có thể cứu dữ liệu
  return migrateFromV1() ?? freshState();
}
// Chrome/Safari cho khoảng 5 triệu ký tự mỗi tên miền. Theo dõi mức dùng để cảnh báo sớm, trước khi việc ghi bắt đầu thất bại.
const STORAGE_LIMIT = 5000000;
const storage = { used: 0, failed: false };
const measureStorage = () => { try { return Object.keys(localStorage).reduce((n, k) => n + k.length + (localStorage.getItem(k) ?? '').length, 0); } catch { return 0; } };
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); storage.failed = false; } catch (e) {
    storage.failed = true; // dữ liệu mới chỉ còn trong bộ nhớ trang cho đến khi ghi được
    const full = e?.name === 'QuotaExceededError' || e?.code === 22;
    toast('Không lưu được dữ liệu mới', full ? 'Bộ nhớ trình duyệt đã đầy. Dữ liệu vừa nhập sẽ mất khi đóng trang: hãy sao lưu ngay rồi dọn dẹp dữ liệu cũ (Cài đặt).' : 'Trình duyệt đang chặn lưu trữ cục bộ (chế độ riêng tư?).', 10000);
  }
  storage.used = measureStorage();
}

// Chuyển dữ liệu của bản cũ (tiền/ngày là chuỗi) sang cấu trúc mới; bỏ dữ liệu demo.
function migrateFromV1() {
  const old = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
  const oldTx = old('soChiTieuTransactions');
  if (!Array.isArray(oldTx)) return null;
  const demoKeys = new Set(['Ăn uống|Bữa trưa cùng đồng nghiệp', 'Xăng xe|Đổ xăng tại Petrolimex', 'Tiền điện|Hóa đơn tháng 10', 'Mua sắm|Đồ dùng gia đình', 'Lương tháng 10|Vietcombank', 'Tiền thuê nhà|Chuyển khoản định kỳ']);
  const isDemo = item => item.isSample || demoKeys.has(`${item.title}|${item.note}`);
  const s = freshState();
  const profile = old('soChiTieuProfile'); if (profile) s.profile = { name: profile.name || s.profile.name, email: profile.email || '' };
  const cats = old('soChiTieuCategories'); if (Array.isArray(cats) && cats.length) s.expenseCats = cats;
  const accounts = (old('soChiTieuAccounts') || []).filter(a => !a.isSample);
  if (accounts.length) s.accounts = accounts.map(a => ({ id: uid(), name: a.name, type: a.type || 'Tiền mặt', opening: Number(a.balance) || 0 }));
  const dateOf = t => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(t.isoDate || '')) return t.isoDate;
    const m = String(t.date).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
    const d = new Date(); if (String(t.date).startsWith('Hôm qua')) d.setDate(d.getDate() - 1); return isoOf(d);
  };
  s.transactions = oldTx.filter(t => !isDemo(t)).map(t => {
    const type = ['income', 'transfer'].includes(t.type) ? t.type : 'expense';
    const account = (s.accounts.find(a => a.name === t.account) || s.accounts[0]).id;
    const category = t.category || t.title || 'Khác';
    const list = type === 'income' ? s.incomeCats : s.expenseCats;
    if (type !== 'transfer' && !list.includes(category)) list.push(category);
    return { id: uid(), type, amount: digits(t.amount), category: type === 'transfer' ? '' : category, account, to: '', note: t.note || '', date: dateOf(t), location: t.location || '', related: t.related || '' };
  }).filter(t => t.amount > 0 && t.type !== 'transfer');
  // Số dư cũ là số dư hiện tại → trừ giao dịch đã chuyển để không bị tính hai lần.
  s.accounts.forEach(a => { if (accounts.length) a.opening -= balanceOf(a.id, s) - a.opening; });
  s.budgets = (old('soChiTieuBudgets') || []).filter(b => !b.isSample && b.limit > 0).map(b => ({ id: uid(), category: b.category, limit: Number(b.limit) }));
  s.budgets.forEach(b => { if (!s.expenseCats.includes(b.category)) s.expenseCats.push(b.category); });
  s.recurring = (old('soChiTieuRecurring') || []).filter(r => !r.isSample && !['Tiền thuê nhà', 'Tiền internet', 'Bảo hiểm nhân thọ'].includes(r.name)).map(r => ({ id: uid(), name: r.name, amount: digits(r.amount), category: s.expenseCats.includes(r.category) ? r.category : 'Khác', day: Number(r.day) || 1, account: s.accounts[0].id, active: r.status === 'active' }));
  return s;
}

let state = load();
storage.used = measureStorage();
let view = 'home';
let month = monthOf(new Date());
let filter = { type: 'all', category: 'all', q: '' };
let settingsTab = 'profile';
let editingTx = null;
let txType = 'expense';

// ---------- Tính toán ----------
const txIn = key => state.transactions.filter(t => t.date.startsWith(key));
const sumOf = (list, type) => list.reduce((s, t) => t.type === type ? s + t.amount : s, 0);
const byNewest = (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id);
const accountName = id => state.accounts.find(a => a.id === id)?.name ?? '—';
function balanceOf(id, s = state, list = s.transactions) {
  const opening = list === s.transactions ? s.accounts.find(a => a.id === id)?.opening ?? 0 : 0;
  return list.reduce((sum, t) => {
    if (t.type === 'income' && t.account === id) return sum + t.amount;
    if (t.type === 'expense' && t.account === id) return sum - t.amount;
    if (t.type === 'transfer') return sum - (t.account === id ? t.amount : 0) + (t.to === id ? t.amount : 0);
    return sum;
  }, opening);
}
const monthExpense = (category, key = month) => txIn(key).filter(t => t.type === 'expense' && t.category === category).reduce((s, t) => s + t.amount, 0);
// Trạng thái một hạn mức, dùng chung cho banner, toast, chuông, thanh tiến độ và danh sách:
// ok (<80%) · near (80% đến dưới 100%) · full (đúng bằng hạn mức) · over (vượt).
const levelOf = (used, limit) => used > limit ? 'over' : used === limit ? 'full' : used * 5 >= limit * 4 ? 'near' : 'ok';
const LEVEL_COLOR = { ok: '', near: '#e0a25c', full: '#e08a3c', over: '#d65f4f' };
function budgetRows(key = month) { return state.budgets.map(b => { const used = monthExpense(b.category, key); return { ...b, used, ratio: b.limit ? used / b.limit : 0, level: levelOf(used, b.limit) }; }); }
function budgetStatus(b) { return b.level === 'over' ? `Vượt ${vnd(b.used - b.limit)}` : b.level === 'full' ? 'Đã dùng hết hạn mức' : b.level === 'near' ? `Sắp hết · còn ${vnd(b.limit - b.used)}` : `Còn lại ${vnd(b.limit - b.used)}`; }
// Dòng "tổng ngân sách": so với toàn bộ chi tiêu của tháng, kể cả khoản không thuộc nhóm nào.
function totalRow(key = month) { if (!state.totalBudget) return null; const used = sumOf(txIn(key), 'expense'); return { category: 'Tổng ngân sách', limit: state.totalBudget, used, ratio: used / state.totalBudget, level: levelOf(used, state.totalBudget) }; }
const isSavings = id => state.accounts.find(a => a.id === id)?.type === 'Tiết kiệm';
// Tiền chuyển từ tài khoản thường sang tài khoản Tiết kiệm là "đã tiết kiệm"; chiều ngược lại là rút ra.
const savedIn = list => list.reduce((s, t) => t.type !== 'transfer' ? s : isSavings(t.to) && !isSavings(t.account) ? s + t.amount : isSavings(t.account) && !isSavings(t.to) ? s - t.amount : s, 0);
function series(type, n = 6) { return Array.from({ length: n }, (_, i) => { const key = shiftMonth(month, i - n + 1); return { key, value: sumOf(txIn(key), type) }; }); }
function change(cur, prev) { return prev > 0 ? (cur - prev) / prev * 100 : null; }
const fmtPct = p => `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p).toFixed(1).replace('.', ',')}%`;
function badge(cur, prev, upIsGood) {
  const p = change(cur, prev);
  if (p === null) return { text: cur > 0 ? 'Mới' : '—', cls: 'neutral' };
  return { text: fmtPct(p), cls: Math.abs(p) < .05 ? 'neutral' : (p > 0) === upIsGood ? 'positive' : 'negative' };
}
function niceMax(v) { if (v <= 0) return 0; const p = 10 ** Math.floor(Math.log10(v)); return [1, 1.5, 2, 3, 4, 5, 6, 8, 10].map(m => m * p).find(m => m >= v); }

// Màu/biểu tượng theo danh mục: nhóm quen thuộc giữ màu cũ, nhóm tự tạo lấy theo tên.
const STYLE = { 'Nhà ở':0, 'Ăn uống':1, 'Đi chợ':1, 'Mua sắm':2, 'Đi lại':3 };
const GLYPH = { 'Ăn uống':'⌁', 'Đi chợ':'⌁', 'Nhà ở':'⌂', 'Đi lại':'↗', 'Mua sắm':'□', 'Lương':'↗', 'Tổng ngân sách':'◎' };
const ICON = ['home-icon', 'food-icon', 'shopping-icon', 'travel-icon'];
const BG = ['house-bg', 'food-bg', 'shop-bg', 'travel-bg'];
const RANK = ['house', 'shop', 'fork', 'car'];
const styleOf = c => STYLE[c] ?? [...String(c)].reduce((h, ch) => h + ch.charCodeAt(0), 0) % 4;
const glyphOf = c => GLYPH[c] || [...String(c)][0]?.toUpperCase() || '•';

function dateLabel(iso) {
  const today = new Date(); const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (iso === isoOf(today)) return 'Hôm nay';
  if (iso === isoOf(yesterday)) return 'Hôm qua';
  return `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

// ---------- Hiển thị ----------
function toast(title, message, ms = 3200) {
  $('#toastTitle').textContent = title; $('#toastMessage').textContent = message || '';
  $('#toast').classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').classList.remove('show'), ms);
}
// Sau khi ghi một khoản chi: nếu nhóm đó (hoặc tổng ngân sách) của tháng đã từ 80% hạn mức trở lên thì báo ngay, thay cho toast "đã lưu".
// `before` (từ levelsOf, chụp trước khi ghi) để mức "sắp hết" chỉ báo đúng lúc vừa chạm 80%, không lặp lại ở mỗi khoản chi sau đó.
const levelsOf = (category, key) => Object.fromEntries([budgetRows(key).find(r => r.category === category), totalRow(key)].filter(Boolean).map(b => [b.category, b.level]));
function warnOverrun(category, key, before = {}) {
  if (!state.notifyBudget || storage.failed) return;
  const hit = [budgetRows(key).find(r => r.category === category), totalRow(key)].filter(b => b && b.level !== 'ok' && !(b.level === 'near' && (before[b.category] ?? 'ok') !== 'ok'));
  if (!hit.length) return;
  const text = b => { const name = b.category === 'Tổng ngân sách' ? 'tổng ngân sách' : `“${b.category}”`; return b.level === 'over' ? `${name} vượt ${vnd(b.used - b.limit)}` : b.level === 'full' ? `${name} đã dùng hết hạn mức` : `${name} đã dùng ${Math.round(b.ratio * 100)}% (còn ${vnd(b.limit - b.used)})`; };
  const worst = ['over', 'full', 'near'].find(l => hit.some(b => b.level === l));
  toast({ over: '⚠ Vượt hạn mức chi', full: '⚠ Đã dùng hết hạn mức', near: 'Sắp hết hạn mức' }[worst], `${hit.map(text).join('; ')} trong ${monthText(key).toLowerCase()}.`, 7000);
}
const empty = (text, hint = '') => `<div class="empty-data-state">${esc(text)}${hint ? `<small>${esc(hint)}</small>` : ''}</div>`;

function txRow(t) {
  const transfer = t.type === 'transfer';
  const sign = t.type === 'income' ? '+' : transfer ? '' : '-';
  const place = transfer ? `${accountName(t.account)} → ${accountName(t.to)}` : accountName(t.account);
  return `<div class="transaction-item"><i class="transaction-icon ${t.type === 'income' ? 'income-icon' : ICON[styleOf(transfer ? 'Chuyển' : t.category)]}">${transfer ? '⇄' : glyphOf(t.category)}</i><div class="transaction-info"><strong>${esc(transfer ? 'Chuyển tiền' : t.category)}</strong><small>${esc(t.note ? `${t.note} · ${place}` : place)}</small></div><div class="transaction-amount"><strong class="${t.type === 'income' ? 'amount-income' : 'amount-expense'}">${sign}${vnd(t.amount)}</strong><small>${dateLabel(t.date)}</small></div><div class="transaction-actions"><button data-action="edit-tx" data-id="${t.id}" title="Sửa">✎</button><button data-action="dup-tx" data-id="${t.id}" title="Sao chép">⧉</button><button data-action="del-tx" data-id="${t.id}" title="Xóa">×</button></div></div>`;
}

function renderGreeting() {
  const now = new Date(), hour = now.getHours();
  const hello = hour < 5 ? 'Khuya rồi' : hour < 11 ? 'Chào buổi sáng' : hour < 13 ? 'Chào buổi trưa' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
  $('#todayLabel').textContent = now.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
  $('#greeting').innerHTML = `${hello}, ${esc(state.profile.name || 'Bạn')} <span>✦</span>`;
}
function renderChrome() {
  const name = state.profile.name || 'Bạn';
  $('#sideName').textContent = name;
  $('#sideAvatar').textContent = $('#topAvatar').textContent = name.trim().charAt(0).toUpperCase();
  renderGreeting();
  $('#homeSubtitle').textContent = `Đây là tình hình tài chính của bạn trong ${monthText(month).toLowerCase()}.`;
  $$('[data-month-picker]').forEach(el => { el.innerHTML = `<button class="round-arrow" data-action="month-prev" aria-label="Tháng trước">‹</button><strong>${monthText(month)}</strong><button class="round-arrow" data-action="month-next" aria-label="Tháng sau">›</button><button class="today-button" data-action="month-now">Hôm nay</button>`; });
}

function renderWarnings() {
  const hotOf = key => state.notifyBudget ? [totalRow(key), ...budgetRows(key)].filter(b => b && b.level !== 'ok').sort((a, b) => b.ratio - a.ratio) : [];
  // Chấm đỏ trên chuông: tình hình tháng hiện tại. Banner: dữ liệu của chính tháng đang xem (tháng trống → không có gì để báo).
  $('#bellDot').hidden = !hotOf(monthOf(new Date())).length;
  const hot = hotOf(month);
  const groups = [['over', 'Đã vượt hạn mức', b => `${b.category} (+${short(b.used - b.limit)})`], ['full', 'Đã dùng hết hạn mức', b => b.category], ['near', 'Sắp hết hạn mức', b => `${b.category} (${Math.round(b.ratio * 100)}%)`]];
  const lines = groups.map(([level, label, show]) => { const list = hot.filter(b => b.level === level); return list.length ? `${label}: ${list.map(show).join(', ')}` : ''; }).filter(Boolean);
  $$('[data-budget-warning]').forEach(el => {
    el.hidden = !hot.length; if (el.hidden) return;
    el.innerHTML = `<span class="warning-symbol">!</span><div><strong>${esc(lines[0])}</strong>${lines.slice(1).map(l => `<small>${esc(l)}</small>`).join('')}<small>${esc(monthText(month))}</small></div>${el.dataset.budgetWarning === 'home' ? '<button data-action="view" data-view="budgets">Xem hạn mức →</button>' : ''}`;
  });
}

function renderStorageWarning() {
  const pct = storage.used / STORAGE_LIMIT * 100, show = storage.failed || pct >= 80, kb = n => Math.round(n / 1000).toLocaleString('vi-VN');
  $$('[data-storage-warning]').forEach(el => {
    el.hidden = !show; if (!show) return;
    const title = storage.failed ? 'Không lưu được dữ liệu mới: bộ nhớ trình duyệt đã đầy' : pct >= 95 ? `Bộ nhớ sắp đầy (${Math.round(pct)}%)` : `Bộ nhớ đã dùng ${Math.round(pct)}%`;
    const sub = storage.failed ? 'Dữ liệu vừa nhập sẽ mất khi đóng trang. Hãy sao lưu ngay, rồi dọn dẹp dữ liệu các năm trước.' : `Khoảng ${kb(storage.used)} / ${kb(STORAGE_LIMIT)} KB. Nên dọn dẹp dữ liệu các năm trước để không bị đầy.`;
    el.innerHTML = `<span class="warning-symbol">!</span><div><strong>${esc(title)}</strong><small>${esc(sub)}</small></div><button data-action="goto-cleanup">Dọn dẹp →</button>`;
  });
}

function renderHome() {
  const list = txIn(month), prev = txIn(shiftMonth(month, -1));
  const income = sumOf(list, 'income'), expense = sumOf(list, 'expense'), balance = income - expense;
  const setBadge = (id, b) => { const el = $(id); el.textContent = b.text; el.className = `trend ${b.cls}`; };
  $('#incomeValue').textContent = vnd(income); $('#expenseValue').textContent = vnd(expense); $('#balanceValue').textContent = vnd(balance);
  setBadge('#incomeTrend', badge(income, sumOf(prev, 'income'), true));
  setBadge('#expenseTrend', badge(expense, sumOf(prev, 'expense'), false));
  setBadge('#balanceTrend', { text: balance > 0 ? 'Dương' : balance < 0 ? 'Thâm hụt' : '—', cls: balance > 0 ? 'positive' : balance < 0 ? 'negative' : 'neutral' });
  $('#balanceBar').style.width = `${income ? Math.min(Math.max(balance / income * 100, 0), 100) : 0}%`;
  [['#incomeSpark', 'income'], ['#expenseSpark', 'expense']].forEach(([id, type]) => {
    const data = series(type), max = Math.max(...data.map(d => d.value), 1);
    $(id).innerHTML = data.map(d => `<i style="height:${Math.max(d.value / max * 100, 6)}%" title="${monthText(d.key)}: ${vnd(d.value)}"></i>`).join('');
  });

  // Donut theo danh mục: 4 nhóm lớn nhất + gộp phần còn lại.
  const totals = {}; list.filter(t => t.type === 'expense').forEach(t => { totals[t.category] = (totals[t.category] || 0) + t.amount; });
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const rows = sorted.slice(0, 4); const rest = sorted.slice(4).reduce((s, [, v]) => s + v, 0); if (rest) rows.push(['Nhóm khác', rest]);
  const colors = ['#12aa96', '#5c85ed', '#63bd91', '#8fa8b0', '#d6ece7'], dots = ['teal', 'blue', 'green', 'slate', 'pale'];
  $('#spendingSub').textContent = `Phân bổ ${monthText(month).toLowerCase()}`;
  if (!expense) $('#spendingBody').innerHTML = empty('Chưa có khoản chi trong tháng này.', 'Hãy thêm giao dịch chi tiêu.');
  else {
    let acc = 0; const stops = rows.map(([, v], i) => { const from = acc / expense * 100; acc += v; return `${colors[i]} ${from}% ${acc / expense * 100}%`; });
    $('#spendingBody').innerHTML = `<div class="donut" style="background:conic-gradient(${stops.join(',')})"><div class="donut-hole"><strong>${short(expense)}</strong><span>Tổng chi</span></div></div><div class="legend">${rows.map(([name, v], i) => `<div><i class="dot ${dots[i]}"></i><span>${esc(name)}</span><strong>${short(v)}</strong></div>`).join('')}</div>`;
  }

  const total = totalRow(), hot = [...(total ? [total] : []), ...budgetRows().sort((a, b) => b.ratio - a.ratio)].slice(0, 4);
  $('#homeBudgets').innerHTML = hot.length ? hot.map(b => `<div class="budget-row"><div class="budget-row-top"><span><i class="category-icon ${ICON[styleOf(b.category)]}">${glyphOf(b.category)}</i> ${esc(b.category)}</span><strong style="color:${LEVEL_COLOR[b.level]}">${Math.round(b.ratio * 100)}% <small>${short(b.used)} / ${short(b.limit)}</small></strong></div><div class="progress"><span style="width:${Math.min(b.ratio * 100, 100)}%;background:${LEVEL_COLOR[b.level]}"></span></div></div>`).join('') : empty('Chưa có hạn mức chi nào.', 'Vào mục Ngân sách để tạo hạn mức đầu tiên.');

  const recent = [...list].sort(byNewest).slice(0, 4);
  $('#recentTransactions').innerHTML = recent.length ? recent.map(txRow).join('') : '<div class="empty-state">Chưa có giao dịch trong tháng này.</div>';
  renderInsight(expense);
}

function renderInsight(expense) {
  const head = '<div class="insight-header"><span class="insight-badge">✦</span><div><h2>Góc nhìn tài chính</h2><p>Cập nhật theo tháng đang xem</p></div></div>';
  const earlier = [1, 2, 3].map(i => sumOf(txIn(shiftMonth(month, -i)), 'expense')).filter(v => v > 0);
  if (!expense || !earlier.length) { $('#insight').innerHTML = head + empty('Chưa đủ dữ liệu để so sánh.', 'Cần chi tiêu của tháng này và ít nhất một tháng trước.'); return; }
  const avg = earlier.reduce((a, b) => a + b, 0) / earlier.length, p = Math.abs((avg - expense) / avg * 100).toFixed(1).replace('.', ',');
  const data = series('expense'), max = Math.max(...data.map(d => d.value), 1);
  $('#insight').innerHTML = `${head}<div class="insight-main"><strong>Chi tiêu của bạn đang ${expense <= avg ? 'tốt hơn' : 'cao hơn'} <em>${p}%</em></strong><p>so với mức trung bình ${earlier.length} tháng trước${month === monthOf(new Date()) ? ' (tháng này mới tính đến hôm nay)' : ''}.</p></div><div class="insight-chart">${data.map(d => `<span style="height:${Math.max(d.value / max * 100, 4)}%" title="${monthText(d.key)}: ${vnd(d.value)}"></span>`).join('')}</div><div class="chart-labels">${data.map(d => `<span>T${Number(d.key.slice(5))}</span>`).join('')}</div>`;
}

const fold = v => String(v).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase(); // tìm không phân biệt dấu: "luong" khớp "Lương"
function visibleTransactions() {
  const q = fold(filter.q.trim());
  return txIn(month).filter(t => (filter.type === 'all' || t.type === filter.type) && (filter.category === 'all' || t.category === filter.category) && (!q || fold(`${t.category} ${t.note} ${t.location} ${t.related} ${accountName(t.account)}`).includes(q))).sort(byNewest);
}
function renderTransactions() {
  const list = visibleTransactions(), all = txIn(month);
  $('#allTransactions').innerHTML = list.length ? list.map(txRow).join('') : `<div class="empty-state">${all.length ? 'Không có giao dịch phù hợp bộ lọc.' : 'Chưa có giao dịch trong tháng này.'}</div>`;
  $('#transactionCount').textContent = list.length === all.length ? `${all.length} giao dịch trong ${monthText(month).toLowerCase()}` : `${list.length}/${all.length} giao dịch phù hợp`;
  const active = (filter.type !== 'all') + (filter.category !== 'all');
  $('#filterCount').hidden = !active; $('#filterCount').textContent = active;
  const categories = [...new Set([...state.expenseCats, ...state.incomeCats])];
  $('#filterCategory').innerHTML = `<option value="all">Tất cả danh mục</option>${categories.map(c => `<option>${esc(c)}</option>`).join('')}`;
  $('#filterCategory').value = categories.includes(filter.category) ? filter.category : 'all';

  const first = new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1), lead = (first.getDay() + 6) % 7, dim = daysIn(month);
  const marked = new Set(all.map(t => Number(t.date.slice(8)))), today = isoOf(new Date());
  $('#calendarDays').innerHTML = Array.from({ length: Math.ceil((lead + dim) / 7) * 7 }, (_, i) => {
    const day = i - lead + 1, inMonth = day >= 1 && day <= dim;
    return `<span class="${inMonth ? '' : 'muted-day'} ${inMonth && marked.has(day) ? 'has-expense' : ''} ${inMonth && `${month}-${pad(day)}` === today ? 'active-day' : ''}">${inMonth ? day : ''}</span>`;
  }).join('');
  $('#calendarSub').textContent = monthText(month);
  $('#calExpense').textContent = vnd(sumOf(all, 'expense')); $('#calIncome').textContent = vnd(sumOf(all, 'income'));

  $('#recurringList').innerHTML = state.recurring.length ? state.recurring.map(r => {
    const posted = state.transactions.some(t => t.recurringId === r.id && t.date.startsWith(month));
    return `<div class="recurring-item"><span class="recurring-icon ${r.active ? 'active-recurring' : ''}">↻</span><div class="recurring-info"><strong>${esc(r.name)}</strong><small>${esc(r.category)} · hàng tháng · ngày ${r.day} · ${posted ? 'đã ghi nhận tháng này' : 'chưa ghi nhận tháng này'}</small><small>${posted || !r.active ? '' : `<button class="text-button" data-action="rec-post" data-id="${r.id}">Ghi nhận</button> `}<button class="text-button" data-action="rec-edit" data-id="${r.id}">Sửa</button></small></div><b>${vnd(r.amount)}</b><button class="recurring-toggle ${r.active ? 'active' : 'paused'}" data-action="rec-toggle" data-id="${r.id}">${r.active ? 'Đang bật' : 'Tạm dừng'}</button><button class="recurring-delete" data-action="rec-del" data-id="${r.id}" title="Xóa">×</button></div>`;
  }).join('') : '<div class="empty-state">Chưa có giao dịch định kỳ.</div>';
}

function renderStats() {
  const list = txIn(month), prev = txIn(shiftMonth(month, -1));
  const income = sumOf(list, 'income'), expense = sumOf(list, 'expense');
  const pIncome = sumOf(prev, 'income'), pExpense = sumOf(prev, 'expense');
  const versus = `so với T${Number(shiftMonth(month, -1).slice(5))}`;
  const note = (cur, p, upIsGood) => { const c = change(cur, p); return c === null ? '<small>Chưa có dữ liệu tháng trước</small>' : `<small class="${Math.abs(c) < .05 || (c > 0) === upIsGood ? 'positive-text' : 'negative-text'}">${c >= 0 ? '↑' : '↓'} ${Math.abs(c).toFixed(1).replace('.', ',')}% ${versus}</small>`; };
  $('#statCards').innerHTML = [['Tổng thu', income, pIncome, true], ['Tổng chi', expense, pExpense, false], ['Còn lại', income - expense, pIncome - pExpense, true], ['Chuyển vào tiết kiệm', savedIn(list), savedIn(prev), true]].map(([label, v, p, good]) => `<div class="stat-box"><span>${label}</span><strong>${vnd(v)}</strong>${note(v, p, good)}</div>`).join('');

  const inc = series('income'), exp = series('expense'), max = niceMax(Math.max(...inc.map(d => d.value), ...exp.map(d => d.value)));
  if (!max) $('#lineChart').innerHTML = empty('Chưa có dữ liệu dòng tiền.', 'Biểu đồ sẽ xuất hiện sau khi bạn thêm giao dịch.');
  else {
    const path = data => 'M' + data.map((d, i) => `${((i + .5) / 6 * 600).toFixed(1)},${(190 - d.value / max * 180).toFixed(1)}`).join(' L');
    $('#lineChart').innerHTML = `<div class="y-labels">${[max, max * 2 / 3, max / 3, 0].map(v => `<span>${compact(v)}</span>`).join('')}</div><div class="line-area"><div class="plot"><div class="grid-line" style="top:0"></div><div class="grid-line" style="top:33.3%"></div><div class="grid-line" style="top:66.6%"></div><div class="grid-line" style="top:100%"></div><svg viewBox="0 0 600 200" preserveAspectRatio="none"><path class="income-line" vector-effect="non-scaling-stroke" d="${path(inc)}"/><path class="expense-line" vector-effect="non-scaling-stroke" d="${path(exp)}"/></svg></div><div class="x-labels" style="display:grid;grid-template-columns:repeat(6,1fr);text-align:center">${inc.map(d => `<span>T${Number(d.key.slice(5))}</span>`).join('')}</div></div>`;
  }

  $('#topSub').textContent = `Trong ${monthText(month).toLowerCase()}`;
  const top = list.filter(t => t.type === 'expense').sort((a, b) => b.amount - a.amount).slice(0, 4);
  $('#ranking').innerHTML = top.length ? top.map((t, i) => `<div><b>${pad(i + 1)}</b><i class="rank-icon ${RANK[styleOf(t.category)]}">${glyphOf(t.category)}</i><span><strong>${esc(t.note || t.category)}</strong><small>${esc(t.category)}</small></span><em>${vnd(t.amount)}</em></div>`).join('') : empty('Chưa có khoản chi nào.');

  const year = Number(month.slice(0, 4));
  const monthly = Array.from({ length: 12 }, (_, m) => ({ m, v: sumOf(txIn(`${year}-${pad(m + 1)}`), 'expense') })), maxMonthly = Math.max(...monthly.map(d => d.v), 1);
  const years = [...new Set([year, ...state.transactions.map(t => Number(t.date.slice(0, 4)))])].sort((a, b) => b - a);
  const yearly = years.map(y => { const l = state.transactions.filter(t => t.date.startsWith(String(y))); return { y, income: sumOf(l, 'income'), expense: sumOf(l, 'expense') }; }), maxYearly = Math.max(...yearly.flatMap(d => [d.income, d.expense]), 1);
  $('#comparisons').innerHTML = `<article class="panel comparison-panel"><div class="panel-heading"><div><h2>So sánh chi tiêu theo tháng</h2><p>Tổng chi trong năm ${year}</p></div><strong>${vnd(monthly[Number(month.slice(5)) - 1].v)}</strong></div><div class="monthly-comparison-chart">${monthly.map(d => `<div class="month-comparison ${d.m === Number(month.slice(5)) - 1 ? 'selected-month' : ''}" title="Tháng ${d.m + 1}: ${vnd(d.v)}"><span style="height:${d.v ? Math.max(d.v / maxMonthly * 100, 7) : 3}%"></span><small>T${d.m + 1}</small></div>`).join('')}</div><p class="comparison-note">Cột đậm là ${monthText(month).toLowerCase()}. Di chuột vào cột để xem số tiền.</p></article><article class="panel comparison-panel"><div class="panel-heading"><div><h2>So sánh theo năm</h2><p>Tổng thu và chi của các năm có dữ liệu</p></div></div><div class="year-comparison-list">${yearly.map(d => `<div class="year-comparison ${d.y === year ? 'selected-year' : ''}"><div><strong>${d.y}</strong><span>${d.y === year ? 'Năm đang xem' : 'Dữ liệu đã lưu'}</span></div><div class="year-bars"><span class="year-income" style="width:${d.income / maxYearly * 100}%"></span><span class="year-expense" style="width:${d.expense / maxYearly * 100}%"></span></div><div class="year-values"><span>Thu ${vnd(d.income)}</span><span>Chi ${vnd(d.expense)}</span></div></div>`).join('')}</div><div class="comparison-legend"><span><i class="comparison-income"></i>Thu nhập</span><span><i class="comparison-expense"></i>Chi tiêu</span></div></article>`;
}

function renderBudgets() {
  const rows = budgetRows(), groupLimit = rows.reduce((s, b) => s + b.limit, 0), groupUsed = rows.reduce((s, b) => s + b.used, 0);
  const spent = sumOf(txIn(month), 'expense'), hasTotal = state.totalBudget > 0;
  // Có tổng ngân sách → so với mọi khoản chi; chưa có → cộng từ các nhóm có hạn mức.
  const limit = hasTotal ? state.totalBudget : groupLimit, used = hasTotal ? spent : groupUsed, pct = limit ? used / limit * 100 : 0;
  const extra = hasTotal ? (groupLimit > limit ? ` · Hạn mức các nhóm cộng lại (${vnd(groupLimit)}) vượt tổng ngân sách` : groupLimit ? ` · ${vnd(groupLimit)} đã chia cho các nhóm` : '') : (spent > groupUsed ? ` · ${vnd(spent - groupUsed)} chi ngoài các nhóm trên` : '');
  $('#budgetOverview').innerHTML = `<div><span>${hasTotal ? 'Tổng ngân sách tháng' : 'Tổng hạn mức tháng (cộng từ các nhóm)'}</span><strong>${vnd(limit)}</strong></div><div><span>${hasTotal ? 'Đã chi trong tháng' : 'Đã chi trong các nhóm có hạn mức'}</span><strong>${vnd(used)}</strong></div><div><span>${used > limit ? 'Vượt ngân sách' : 'Còn lại'}</span><strong class="teal-text">${vnd(Math.abs(limit - used))}</strong></div><div class="overview-progress"><div class="progress"><span style="width:${Math.min(pct, 100)}%;background:${LEVEL_COLOR[levelOf(used, limit)]}"></span></div><small>${pct.toFixed(1).replace('.', ',')}% đã sử dụng${esc(extra)}</small></div>`;
  $('#budgetCards').innerHTML = rows.length ? rows.map(b => `<div class="panel detailed-budget"><div class="budget-card-head"><div class="large-category-icon ${BG[styleOf(b.category)]}">${glyphOf(b.category)}</div><div><h2>${esc(b.category)}</h2><p>Hạn mức chi · ${monthText(month)}</p></div><div class="budget-card-actions"><button class="more-button" data-action="budget-edit" data-id="${b.id}" title="Sửa hạn mức">✎</button><button class="more-button" data-action="budget-del" data-id="${b.id}" title="Xóa hạn mức">×</button></div></div><div class="budget-numbers"><strong>${vnd(b.used)}</strong><span>/ ${vnd(b.limit)}</span></div><div class="progress"><span style="width:${Math.min(b.ratio * 100, 100)}%;background:${LEVEL_COLOR[b.level]}"></span></div><div class="budget-foot"><span style="color:${LEVEL_COLOR[b.level]}">${budgetStatus(b)}</span><b style="color:${LEVEL_COLOR[b.level]}">${Math.round(b.ratio * 100)}%</b></div></div>`).join('') : `<div class="panel">${empty('Chưa có hạn mức chi nào.', 'Bấm “Thêm hạn mức” để đặt mức chi tối đa cho một nhóm.')}</div>`;
}

const ACCOUNT_STYLE = { 'Ngân hàng':['bank', '▣'], 'Ví điện tử':['wallet', '▰'], 'Tiền mặt':['wallet', '▰'], 'Tiết kiệm':['savings', '◉'] };
function renderAccounts() {
  $('#accountTotal').textContent = vnd(state.accounts.reduce((s, a) => s + balanceOf(a.id), 0));
  $('#accountList').innerHTML = state.accounts.map(a => {
    const net = balanceOf(a.id, state, txIn(month)), [cls, glyph] = ACCOUNT_STYLE[a.type] || ACCOUNT_STYLE['Tiền mặt'];
    return `<div class="panel account-card-main"><div class="account-type"><span class="account-icon ${cls}">${glyph}</span><div><h2>${esc(a.name)}</h2><p>${esc(a.type)}</p></div><div class="budget-card-actions" style="margin-left:auto"><button class="more-button" data-action="account-edit" data-id="${a.id}" title="Sửa">✎</button><button class="more-button" data-action="account-del" data-id="${a.id}" title="Xóa">×</button></div></div><strong>${vnd(balanceOf(a.id))}</strong><span class="account-change ${net > 0 ? 'positive-text' : ''}">${net < 0 ? '−' : '+'} ${vnd(Math.abs(net))} trong ${monthText(month).toLowerCase()}</span></div>`;
  }).join('');
}

function renderSettings() {
  $$('.settings-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === settingsTab));
  const box = $('#settingsContent');
  const chips = kind => (kind === 'expense' ? state.expenseCats : state.incomeCats).map((c, i) => `<span class="category-chip">${esc(c)}<button data-action="cat-del" data-kind="${kind}" data-index="${i}" aria-label="Xóa danh mục">×</button></span>`).join('');
  const addRow = kind => `<div class="add-category-row"><input id="newCat-${kind}" placeholder="Tên danh mục mới" /><button class="secondary-button" data-action="cat-add" data-kind="${kind}">＋ Thêm</button></div>`;
  if (settingsTab === 'profile') box.innerHTML = `<h2>Thông tin cá nhân</h2><p class="settings-description">Thông tin này giúp cá nhân hóa trải nghiệm quản lý tài chính. Ứng dụng dùng đơn vị Việt Nam Đồng (₫).</p><div class="form-grid"><label>Họ và tên<input id="profileName" value="${esc(state.profile.name)}" /></label><label>Email<input id="profileEmail" type="email" value="${esc(state.profile.email)}" /></label></div><button class="primary-button" data-action="save-profile">Lưu thay đổi</button><h2 style="margin-top:34px">Cỡ chữ</h2><p class="settings-description">Chỉnh riêng cho thiết bị này. Chọn mức bạn đọc thoải mái nhất.</p><div class="font-choices">${[['md', 'Vừa', 15], ['lg', 'Lớn', 18], ['xl', 'Rất lớn', 22]].map(([key, label, px]) => `<button class="font-choice ${(document.documentElement.dataset.font || 'md') === key ? 'active' : ''}" data-action="font-size" data-size="${key}"><span style="font-size:${px}px">Aa</span>${label}</button>`).join('')}</div>`;
  else if (settingsTab === 'categories') box.innerHTML = `<h2>Danh mục</h2><p class="settings-description">Danh mục đang được dùng trong giao dịch, hạn mức chi hoặc lịch định kỳ sẽ không xóa được.</p><h2 style="font-size:15px">Chi tiêu</h2><div class="category-settings-list">${chips('expense')}</div>${addRow('expense')}<h2 style="font-size:15px;margin-top:28px">Thu nhập</h2><div class="category-settings-list">${chips('income')}</div>${addRow('income')}`;
  else if (settingsTab === 'notify') box.innerHTML = `<h2>Thông báo</h2><p class="settings-description">Chọn nhắc nhở bạn muốn thấy trên thiết bị này.</p><label class="setting-switch"><span><strong>Cảnh báo hạn mức chi</strong><small>Hiện cảnh báo ở Trang chủ và Ngân sách khi một nhóm đã dùng từ 80% hạn mức.</small></span><input id="notifyBudget" type="checkbox" ${state.notifyBudget ? 'checked' : ''}><i></i></label>`;
  else box.innerHTML = `<h2>Dữ liệu & sao lưu</h2><p class="settings-description">Dữ liệu được lưu ngay trên trình duyệt này. Hãy sao lưu định kỳ — xóa dữ liệu trình duyệt sẽ mất sổ.</p><div class="settings-data-row"><div><strong>Sao lưu (JSON)</strong><small>Tải toàn bộ dữ liệu để khôi phục lại sau này.</small></div><button class="secondary-button" data-action="backup">↓ Sao lưu</button></div><div class="settings-data-row"><div><strong>Khôi phục từ file sao lưu</strong><small>Thay thế toàn bộ dữ liệu hiện tại bằng file JSON đã sao lưu.</small></div><button class="secondary-button" data-action="restore">↑ Khôi phục</button></div><div class="settings-data-row"><div><strong>Xuất CSV</strong><small>Danh sách giao dịch để mở bằng Excel.</small></div><button class="secondary-button" data-action="export-csv">↓ Xuất CSV</button></div><div class="settings-data-row"><div><strong>Dọn dẹp dữ liệu cũ</strong><small>Xóa giao dịch trước ngày chọn để giải phóng bộ nhớ. App tự tải bản sao lưu trước và chốt lại số dư để số dư hiện tại không đổi. Sổ đang dùng khoảng ${Math.round(JSON.stringify(state).length / 1000).toLocaleString('vi-VN')} KB trên giới hạn khoảng 5.000 KB của Chrome.</small></div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input type="date" id="cleanupDate" value="${new Date().getFullYear()}-01-01" min="2000-01-01" max="${monthOf(new Date())}-01" style="border:1px solid #dfecea;border-radius:9px;padding:9px;font:inherit" /><button class="danger-button" data-action="cleanup">Dọn dẹp…</button></div></div><div class="settings-data-row sample-row"><div><strong>Nạp dữ liệu mẫu</strong><small>Tạo nhiều tài khoản, giao dịch 3 tháng gần nhất (có chuyển tiền, vượt hạn mức, định kỳ) và một tháng năm trước để thử mọi tình huống.</small></div><button class="secondary-button" data-action="seed">Nạp dữ liệu</button></div><div class="settings-data-row sample-row"><div><strong>Xóa dữ liệu mẫu</strong><small>Chỉ xóa dữ liệu mẫu, dữ liệu bạn tự nhập vẫn được giữ.</small></div><button class="danger-button" data-action="clear-sample">Xóa dữ liệu mẫu</button></div><div class="settings-data-row danger-row"><div><strong>Xóa toàn bộ dữ liệu</strong><small>Xóa mọi giao dịch, tài khoản, hạn mức và cài đặt. Không thể hoàn tác.</small></div><button class="danger-button" data-action="clear-all">Xóa tất cả</button></div>`;
}

function render() {
  renderChrome(); renderHome(); renderTransactions(); renderStats(); renderBudgets(); renderAccounts(); renderSettings(); renderWarnings(); renderStorageWarning();
}

// ---------- Màn hình & hộp thoại ----------
const VIEW_NAMES = { home:'Trang chủ', transactions:'Giao dịch', stats:'Thống kê', budgets:'Ngân sách', accounts:'Tài khoản', settings:'Cài đặt' };
function setView(name) {
  view = name;
  $$('.view').forEach(el => el.classList.toggle('active-view', el.id === `${name}View`));
  $$('.nav-item[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === name));
  $('#pageTitle').textContent = VIEW_NAMES[name];
  $$('[data-action=more-menu]').forEach(el => el.classList.toggle('active', name === 'accounts' || name === 'settings')); // mục "Quản lý" sáng khi đang ở Tài khoản / Cài đặt
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function closeModals() { $$('.modal-backdrop.open').forEach(el => el.classList.remove('open')); editingTx = null; }
function openModal(el) { el.classList.add('open'); (el.querySelector('input:not([type=hidden]), select') || el).focus?.(); }
const options = (items, selected) => items.map(o => { const [value, label] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`; }).join('');
const accountOptions = selected => options(state.accounts.map(a => [a.id, a.name]), selected);
const formatMoneyInput = n => n ? n.toLocaleString('vi-VN') : '';

// Form nhỏ dùng chung cho hạn mức chi, tài khoản, giao dịch định kỳ.
// fields: { name, label, type: text|money|number|select, value, options?, min?, max?, placeholder? }
function openForm({ eyebrow, title, fields, submit = 'Lưu', onSave }) {
  const html = fields.map(f => `<label>${esc(f.label)}${f.type === 'select' ? `<select id="f-${f.name}">${options(f.options, f.value)}</select>` : `<input id="f-${f.name}" ${f.type === 'money' ? 'data-money inputmode="numeric"' : f.type === 'number' ? `type="number" min="${f.min}" max="${f.max}"` : ''} value="${esc(f.type === 'money' ? formatMoneyInput(f.value) : f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" />`}</label>`).join('');
  const modal = $('#formModal');
  $('.modal', modal).innerHTML = `<div class="modal-head"><div><p class="eyebrow">${esc(eyebrow)}</p><h2>${esc(title)}</h2></div><button class="close-modal" data-action="close-modal" aria-label="Đóng">×</button></div><div class="modal-grid">${html}</div><div class="modal-footer"><button class="secondary-button" data-action="close-modal">Hủy</button><button class="primary-button" id="formSave">${esc(submit)}</button></div>`;
  $('#formSave').onclick = () => {
    const values = {};
    fields.forEach(f => { const v = $(`#f-${f.name}`).value; values[f.name] = f.type === 'money' ? digits(v) : f.type === 'number' ? Number(v) : v.trim(); });
    if (onSave(values) !== false) closeModals();
  };
  openModal(modal);
}

function fillTxCategories(selected) {
  const list = txType === 'income' ? state.incomeCats : state.expenseCats;
  $('#txCategory').innerHTML = options(list, selected);
}
function setTxType(type, selectedCategory) {
  txType = type;
  $$('#transactionModal .type-button').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  $('#txCategoryWrap').hidden = type === 'transfer';
  $('#txToWrap').hidden = type !== 'transfer';
  $('#txAccountLabel').textContent = type === 'transfer' ? 'Từ tài khoản' : 'Tài khoản';
  if (type !== 'transfer') fillTxCategories(selectedCategory ?? $('#txCategory').value);
}
function openTx(id = null) {
  const t = id ? state.transactions.find(x => x.id === id) : null;
  editingTx = t?.id ?? null;
  $('#modalEyebrow').textContent = t ? 'CHỈNH SỬA' : 'GIAO DỊCH MỚI';
  $('#modalTitle').textContent = t ? 'Sửa giao dịch' : 'Thêm giao dịch';
  $('#txAccount').innerHTML = accountOptions(t?.account); $('#txTo').innerHTML = accountOptions(t?.to || state.accounts[1]?.id);
  $('#txAmount').value = formatMoneyInput(t?.amount);
  $('#txNote').value = t?.note ?? ''; $('#txLocation').value = t?.location ?? ''; $('#txRelated').value = t?.related ?? '';
  const now = new Date();
  $('#txDate').value = t?.date ?? (month === monthOf(now) ? isoOf(now) : `${month}-01`);
  setTxType(t?.type ?? 'expense', t?.category);
  openModal($('#transactionModal')); $('#txAmount').focus();
}
function saveTx() {
  const amount = digits($('#txAmount').value), date = $('#txDate').value, account = $('#txAccount').value, to = $('#txTo').value;
  if (!amount) return toast('Thiếu số tiền', 'Vui lòng nhập số tiền giao dịch.');
  if (!isIsoDate(date) || date < '2000-01-01' || date > '2099-12-31') return toast('Ngày không hợp lệ', 'Vui lòng chọn ngày trong khoảng năm 2000–2099.');
  if (txType === 'transfer' && account === to) return toast('Chọn hai tài khoản khác nhau', 'Chuyển tiền cần tài khoản đi và đến khác nhau.');
  const item = { id: editingTx || uid(), type: txType, amount, category: txType === 'transfer' ? '' : $('#txCategory').value, account, to: txType === 'transfer' ? to : '', note: $('#txNote').value.trim(), date, location: $('#txLocation').value.trim(), related: $('#txRelated').value.trim() };
  const before = levelsOf(item.category, date.slice(0, 7));
  const index = state.transactions.findIndex(t => t.id === editingTx), old = state.transactions[index];
  if (index >= 0) state.transactions[index] = { ...old, ...item, isSample: undefined }; else state.transactions.push(item);
  month = date.slice(0, 7); // chuyển sang tháng của giao dịch để người dùng thấy ngay kết quả
  const wasEditing = index >= 0;
  closeModals(); commit(wasEditing ? 'Đã cập nhật giao dịch' : 'Đã lưu giao dịch', 'Dữ liệu đã được cập nhật trong sổ.');
  const changed = !old || old.type !== item.type || old.amount !== item.amount || old.category !== item.category || old.date.slice(0, 7) !== item.date.slice(0, 7);
  if (txType === 'expense' && changed) warnOverrun(item.category, month, before);
}
function commit(title, message) { save(); render(); if (title && !storage.failed) toast(title, message); }

// ---------- Thao tác ----------
function budgetForm(id) {
  const b = state.budgets.find(x => x.id === id);
  const free = state.expenseCats.filter(c => c === b?.category || !state.budgets.some(x => x.category === c));
  if (!free.length) return toast('Đã đủ hạn mức', 'Mọi danh mục chi tiêu đều đã có hạn mức.');
  openForm({ eyebrow: b ? 'ĐIỀU CHỈNH HẠN MỨC' : 'HẠN MỨC MỚI', title: b ? 'Sửa hạn mức chi' : 'Tạo hạn mức chi', submit: b ? 'Lưu thay đổi' : 'Tạo hạn mức',
    fields: [{ name: 'category', label: 'Danh mục', type: 'select', options: free, value: b?.category }, { name: 'limit', label: 'Hạn mức mỗi tháng', type: 'money', value: b?.limit, placeholder: '3.000.000' }],
    onSave: v => { if (!v.limit) return toast('Thiếu hạn mức', 'Vui lòng nhập số tiền hạn mức.'), false; if (b) Object.assign(b, v); else state.budgets.push({ id: uid(), ...v }); commit(b ? 'Đã cập nhật hạn mức' : 'Đã tạo hạn mức', `Hạn mức cho “${v.category}”.`); } });
}
function accountForm(id) {
  const a = state.accounts.find(x => x.id === id);
  openForm({ eyebrow: a ? 'CHỈNH SỬA' : 'TÀI KHOẢN MỚI', title: a ? 'Sửa tài khoản' : 'Thêm tài khoản', submit: a ? 'Lưu thay đổi' : 'Thêm tài khoản',
    fields: [{ name: 'name', label: 'Tên tài khoản', type: 'text', value: a?.name, placeholder: 'Ví dụ: Ví MoMo' }, { name: 'type', label: 'Loại tài khoản', type: 'select', options: Object.keys(ACCOUNT_STYLE), value: a?.type }, { name: 'opening', label: 'Số dư ban đầu (chưa tính giao dịch)', type: 'money', value: a?.opening, placeholder: '0' }],
    onSave: v => { if (!v.name) return toast('Thiếu tên tài khoản', 'Vui lòng nhập tên tài khoản.'), false; if (a) Object.assign(a, v); else state.accounts.push({ id: uid(), ...v }); commit(a ? 'Đã cập nhật tài khoản' : 'Đã thêm tài khoản', `“${v.name}”.`); } });
}
function recurringForm(id) {
  const r = state.recurring.find(x => x.id === id);
  openForm({ eyebrow: 'LẬP LỊCH', title: r ? 'Sửa giao dịch định kỳ' : 'Thêm giao dịch định kỳ', submit: r ? 'Lưu thay đổi' : 'Lưu lịch định kỳ',
    fields: [{ name: 'name', label: 'Tên giao dịch', type: 'text', value: r?.name, placeholder: 'Ví dụ: Tiền thuê nhà' }, { name: 'amount', label: 'Số tiền', type: 'money', value: r?.amount, placeholder: '5.000.000' }, { name: 'category', label: 'Danh mục', type: 'select', options: state.expenseCats, value: r?.category }, { name: 'day', label: 'Ngày trong tháng', type: 'number', min: 1, max: 31, value: r?.day ?? 1 }, { name: 'account', label: 'Tài khoản', type: 'select', options: state.accounts.map(a => [a.id, a.name]), value: r?.account }],
    onSave: v => { if (!v.name || !v.amount) return toast('Thiếu thông tin', 'Vui lòng nhập tên và số tiền.'), false; if (!(v.day >= 1 && v.day <= 31)) return toast('Ngày không hợp lệ', 'Nhập ngày từ 1 đến 31.'), false; if (r) Object.assign(r, v); else state.recurring.push({ id: uid(), active: true, ...v }); commit('Đã lưu lịch định kỳ', `“${v.name}”.`); } });
}
function postRecurring(id) {
  const r = state.recurring.find(x => x.id === id); if (!r) return;
  const before = levelsOf(r.category, month);
  state.transactions.push({ id: uid(), type: 'expense', amount: r.amount, category: r.category, account: r.account, to: '', note: r.name, date: `${month}-${pad(Math.min(r.day, daysIn(month)))}`, location: '', related: '', recurringId: r.id });
  commit('Đã ghi nhận', `“${r.name}” đã được thêm vào ${monthText(month).toLowerCase()}.`);
  warnOverrun(r.category, month, before);
}
function addCategory(kind) {
  const input = $(`#newCat-${kind}`), name = input.value.trim(), list = kind === 'expense' ? state.expenseCats : state.incomeCats;
  if (!name) return;
  if (list.some(c => c.toLowerCase() === name.toLowerCase())) return toast('Danh mục đã tồn tại', 'Hãy chọn một tên khác.');
  list.push(name); commit('Đã thêm danh mục', `Đã thêm “${name}”.`);
}
function removeCategory(kind, index) {
  const list = kind === 'expense' ? state.expenseCats : state.incomeCats, name = list[index];
  const used = state.transactions.some(t => t.category === name) || state.budgets.some(b => b.category === name) || state.recurring.some(r => r.category === name);
  if (list.length <= 1) return toast('Không thể xóa', 'Cần giữ lại ít nhất một danh mục.');
  if (used) return toast('Danh mục đang được dùng', `“${name}” có trong giao dịch, hạn mức chi hoặc lịch định kỳ.`);
  list.splice(index, 1); commit('Đã xóa danh mục', `Đã xóa “${name}”.`);
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function csvText(list) {
  const cell = v => { v = String(v ?? ''); if (/^[=+\-@]/.test(v)) v = `'${v}`; return `"${v.replace(/"/g, '""')}"`; }; // chặn công thức Excel
  const label = { expense: 'Chi tiêu', income: 'Thu nhập', transfer: 'Chuyển tiền' };
  const rows = [['Ngày', 'Loại', 'Danh mục', 'Nội dung', 'Số tiền', 'Tài khoản', 'Đến tài khoản', 'Địa điểm', 'Người liên quan'], ...[...list].sort(byNewest).map(t => [t.date, label[t.type], t.category, t.note, t.amount, accountName(t.account), t.to ? accountName(t.to) : '', t.location, t.related])];
  return '\ufeff' + rows.map(r => r.map(cell).join(',')).join('\n');
}
function exportCsv() {
  download(`so-chi-tieu-${isoOf(new Date())}.csv`, csvText(state.transactions), 'text/csv;charset=utf-8;');
  toast('Đã xuất CSV', 'File đã được tải xuống thiết bị.');
}
// Dọn dẹp dữ liệu cũ để giải phóng bộ nhớ trình duyệt (~5 MB). Số dư tài khoản = số dư ban đầu + mọi giao dịch,
// nên trước khi xóa phải chốt tác động của các giao dịch bị xóa vào số dư ban đầu, nếu không số dư hiện tại sẽ lệch.
function cleanupOld() {
  const cutoff = $('#cleanupDate').value, firstOfMonth = `${monthOf(new Date())}-01`;
  if (!isIsoDate(cutoff) || cutoff < '2000-01-01') return toast('Ngày không hợp lệ', 'Hãy chọn ngày bắt đầu giữ lại dữ liệu.');
  if (cutoff > firstOfMonth) return toast('Chỉ dọn dữ liệu cũ', 'Ngày chọn không được sau đầu tháng hiện tại.');
  const old = state.transactions.filter(t => t.date < cutoff), shown = `${cutoff.slice(8)}/${cutoff.slice(5, 7)}/${cutoff.slice(0, 4)}`;
  if (!old.length) return toast('Không có gì để dọn', `Không có giao dịch nào trước ngày ${shown}.`);
  const next = { ...state, transactions: state.transactions.filter(t => t.date >= cutoff), accounts: state.accounts.map(a => ({ ...a, opening: a.opening + balanceOf(a.id, state, old) })) };
  // Chốt số dư xong phải khớp từng tài khoản; sai một đồng là hủy, dữ liệu giữ nguyên.
  if (state.accounts.some(a => balanceOf(a.id) !== balanceOf(a.id, next))) return toast('Đã hủy dọn dẹp', 'Số dư không khớp sau khi chốt, dữ liệu được giữ nguyên.');
  if (!window.confirm(`Xóa ${old.length} giao dịch trước ngày ${shown}?\n\nGiải phóng khoảng ${Math.round(JSON.stringify(old).length / 1000)} KB. App sẽ tải về bản sao lưu trước khi xóa, và chốt lại số dư ban đầu để số dư hiện tại của mọi tài khoản không đổi.`)) return;
  download(`so-chi-tieu-truoc-don-dep-${isoOf(new Date())}.json`, JSON.stringify(state, null, 2), 'application/json');
  setTimeout(() => download(`so-chi-tieu-da-xoa-truoc-${cutoff}.csv`, csvText(old), 'text/csv;charset=utf-8;'), 500);
  state = next; commit('Đã dọn dẹp dữ liệu cũ', `Đã xóa ${old.length} giao dịch trước ${shown}. Số dư các tài khoản giữ nguyên.`);
}
function restoreFrom(text) {
  let data; try { data = JSON.parse(text); } catch { return toast('File không hợp lệ', 'Không đọc được file JSON.'); }
  if (!validState(data)) return toast('File không hợp lệ', 'Đây không phải file sao lưu của Sổ Chi Tiêu, hoặc dữ liệu trong file bị lỗi.');
  if (!window.confirm('Thay thế toàn bộ dữ liệu hiện tại bằng file sao lưu này?')) return;
  state = { ...freshState(), ...data }; commit('Đã khôi phục', 'Dữ liệu đã được nạp từ file sao lưu.');
}

// Dữ liệu mẫu phủ nhiều tình huống để thử app: nhiều loại tài khoản, chuyển tiền và tiết kiệm, hạn mức ở đủ các mức
// (chưa tới 80%, gần hết, đúng hạn mức, vượt), tổng ngân sách, định kỳ (đã ghi nhận / chưa / tạm dừng),
// dữ liệu năm trước, danh mục tự tạo và ký tự đặc biệt trong ghi chú.
// Dòng: [ngày, loại, danh mục, nội dung, số tiền, tài khoản (bank|cash|momo|save), tài khoản đến (chỉ khi chuyển tiền)]
const SAMPLE_MONTH = [
  [1, 'income', 'Lương', 'Lương công ty', 22000000, 'bank'],
  [2, 'transfer', '', 'Rút tiền mặt', 5000000, 'bank', 'cash'],
  [3, 'transfer', '', 'Gửi tiết kiệm', 2000000, 'bank', 'save'],
  [5, 'expense', 'Nhà ở', 'Tiền thuê nhà', 5000000, 'bank'],
  [6, 'expense', 'Ăn uống', 'Siêu thị cuối tuần', 850000, 'cash'],
  [7, 'expense', 'Ăn uống', 'Cà phê', 65000, 'momo'],
  [8, 'expense', 'Ăn uống', 'Ăn tối gia đình', 480000, 'cash'],
  [8, 'expense', 'Thú cưng', 'Thức ăn cho mèo', 180000, 'momo'],
  [10, 'expense', 'Nhà ở', 'Internet', 250000, 'bank'],
  [11, 'expense', 'Nhà ở', 'Tiền điện', 750000, 'bank'],
  [12, 'income', 'Thưởng', 'Thưởng dự án', 2500000, 'bank'],
  [12, 'expense', 'Đi lại', 'Đổ xăng', 600000, 'cash'],
  [14, 'expense', 'Mua sắm', 'Quà sinh nhật <b>Hoa</b> & bánh "đặc biệt"', 200000, 'momo'],
  [15, 'income', 'Thu nhập khác', 'Bán đồ cũ', 800000, 'momo'],
  [15, 'expense', 'Đi lại', 'Grab đi họp', 380000, 'momo'],
  [17, 'expense', 'Mua sắm', 'Đồ gia dụng', 1300000, 'bank'],
  [18, 'expense', 'Đi lại', 'Sửa xe máy', 520000, 'cash'],
  [19, 'expense', 'Giáo dục', 'Khóa học trực tuyến', 600000, 'bank'],
  [20, 'expense', 'Y tế', 'Khám sức khỏe định kỳ', 350000, 'cash'],
  [21, 'expense', 'Ăn uống', 'Ăn trưa đồng nghiệp', 120000, 'momo'],
  [22, 'expense', 'Ăn uống', 'Tiệc sinh nhật bạn', 900000, 'cash']
];
const SAMPLE_LAST_YEAR = [[1, 'income', 'Lương', 'Lương công ty', 18000000, 'bank'], [5, 'expense', 'Nhà ở', 'Tiền thuê nhà', 4500000, 'bank'], [9, 'expense', 'Ăn uống', 'Ăn uống cả tháng', 2200000, 'cash'], [16, 'expense', 'Mua sắm', 'Quần áo', 900000, 'momo']];
function seedSample() {
  if (!window.confirm('Nạp dữ liệu mẫu? Dữ liệu mẫu cũ sẽ được làm mới, dữ liệu bạn tự nhập vẫn được giữ.')) return;
  removeSample();
  const today = new Date(), cur = monthOf(today), rentId = uid(), netId = uid();
  const ensure = (name, type, opening) => (state.accounts.find(a => a.name === name) ?? (state.accounts.push({ id: uid(), name, type, opening, isSample: true }), state.accounts.at(-1))).id;
  const acc = { cash: (state.accounts.find(a => !a.isSample) ?? state.accounts[0]).id, bank: ensure('Vietcombank', 'Ngân hàng', 25000000), momo: ensure('Ví MoMo', 'Ví điện tử', 3000000), save: ensure('Quỹ khẩn cấp', 'Tiết kiệm', 6000000) };
  const add = (key, rows, factor = 1) => rows.forEach(([day, type, category, note, amount, from, to]) => {
    if (key === cur && day > today.getDate()) return; // không tạo giao dịch ở tương lai
    const scaled = type === 'expense' && category !== 'Nhà ở' ? Math.round(amount * factor / 10000) * 10000 : amount;
    state.transactions.push({ id: uid(), type, amount: scaled, category, account: acc[from], to: to ? acc[to] : '', note, date: `${key}-${pad(Math.min(day, daysIn(key)))}`, location: '', related: '', isSample: true, recurringId: { 'Tiền thuê nhà': rentId, Internet: netId }[note] });
  });
  [[0, 1], [-1, 1.15], [-2, .9]].forEach(([offset, factor]) => add(shiftMonth(cur, offset), offset === -1 ? [...SAMPLE_MONTH, [20, 'transfer', '', 'Rút quỹ khẩn cấp', 500000, 'save', 'bank']] : SAMPLE_MONTH, factor));
  add(shiftMonth(cur, -12), SAMPLE_LAST_YEAR);
  state.sampleCats = [];
  if (!state.expenseCats.includes('Thú cưng')) { state.expenseCats.push('Thú cưng'); state.sampleCats.push('Thú cưng'); }
  [['Ăn uống', 3000000], ['Nhà ở', 6000000], ['Đi lại', 1000000], ['Mua sắm', 2500000], ['Giải trí', 1500000]].forEach(([category, limit]) => { if (!state.budgets.some(b => b.category === category)) state.budgets.push({ id: uid(), category, limit, isSample: true }); });
  if (!state.totalBudget) { state.totalBudget = 15000000; state.sampleTotal = true; }
  state.recurring.push(
    { id: rentId, name: 'Tiền thuê nhà', amount: 5000000, category: 'Nhà ở', day: 5, account: acc.bank, active: true, isSample: true },
    { id: netId, name: 'Internet', amount: 250000, category: 'Nhà ở', day: 10, account: acc.bank, active: true, isSample: true },
    { id: uid(), name: 'Bảo hiểm sức khỏe', amount: 1200000, category: 'Y tế', day: 25, account: acc.bank, active: true, isSample: true },
    { id: uid(), name: 'Netflix', amount: 260000, category: 'Giải trí', day: 20, account: acc.momo, active: false, isSample: true });
  month = cur; commit('Đã nạp dữ liệu mẫu', 'Có 3 tháng gần nhất và một tháng của năm trước.');
}
function removeSample() {
  state.transactions = state.transactions.filter(t => !t.isSample); state.budgets = state.budgets.filter(b => !b.isSample); state.recurring = state.recurring.filter(r => !r.isSample);
  const accountUsed = id => state.transactions.some(t => t.account === id || t.to === id) || state.recurring.some(r => r.account === id);
  state.accounts = state.accounts.filter(a => !a.isSample || accountUsed(a.id)); // giữ lại tài khoản mẫu nếu dữ liệu của bạn đang dùng
  if (!state.accounts.length) state.accounts = freshState().accounts;
  state.expenseCats = state.expenseCats.filter(c => !(state.sampleCats || []).includes(c) || state.transactions.some(t => t.category === c) || state.budgets.some(b => b.category === c) || state.recurring.some(r => r.category === c));
  state.sampleCats = [];
  if (state.sampleTotal) { state.totalBudget = 0; state.sampleTotal = false; }
}

const actions = {
  view: el => { closeModals(); setView(el.dataset.view); },
  'more-menu': () => openModal($('#moreModal')),
  'month-prev': () => { month = shiftMonth(month, -1); render(); },
  'month-next': () => { month = shiftMonth(month, 1); render(); },
  'month-now': () => { month = monthOf(new Date()); render(); },
  'add-tx': () => openTx(),
  'edit-tx': el => openTx(el.dataset.id),
  'dup-tx': el => { const t = state.transactions.find(x => x.id === el.dataset.id); if (!t) return; const copy = { ...t, id: uid(), isSample: undefined, recurringId: undefined }; state.transactions.push(copy); commit('Đã sao chép giao dịch', 'Hãy chỉnh lại thông tin nếu cần.'); openTx(copy.id); },
  'del-tx': el => { const t = state.transactions.find(x => x.id === el.dataset.id); if (t && window.confirm(`Xóa giao dịch “${t.type === 'transfer' ? 'Chuyển tiền' : t.category}” ${vnd(t.amount)}?`)) { state.transactions = state.transactions.filter(x => x !== t); commit('Đã xóa giao dịch', 'Khoản giao dịch đã được xóa khỏi sổ.'); } },
  'tx-type': el => setTxType(el.dataset.type),
  'save-tx': saveTx,
  'close-modal': closeModals,
  'toggle-filter': () => $('#filterPopover').classList.toggle('open'),
  'export-csv': exportCsv,
  cleanup: cleanupOld,
  'goto-cleanup': () => { setView('settings'); settingsTab = 'data'; renderSettings(); setTimeout(() => $('#cleanupDate')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60); },
  'budget-add': () => budgetForm(),
  'total-budget': () => openForm({ eyebrow: 'NGÂN SÁCH THÁNG', title: 'Tổng ngân sách mỗi tháng',
    fields: [{ name: 'total', label: 'Tổng chi tối đa mỗi tháng (để trống = tự cộng từ các nhóm)', type: 'money', value: state.totalBudget, placeholder: '15.000.000' }],
    onSave: v => { state.totalBudget = v.total; state.sampleTotal = false; commit('Đã lưu tổng ngân sách', v.total ? `Tối đa ${vnd(v.total)} mỗi tháng.` : 'Tổng ngân sách được cộng từ các nhóm.'); } }),
  'budget-edit': el => budgetForm(el.dataset.id),
  'budget-del': el => { const b = state.budgets.find(x => x.id === el.dataset.id); if (b && window.confirm(`Xóa hạn mức cho “${b.category}”?`)) { state.budgets = state.budgets.filter(x => x !== b); commit('Đã xóa hạn mức', 'Hạn mức chi đã được xóa.'); } },
  'account-add': () => accountForm(),
  'account-edit': el => accountForm(el.dataset.id),
  'account-del': el => {
    const a = state.accounts.find(x => x.id === el.dataset.id); if (!a) return;
    if (state.accounts.length <= 1) return toast('Không thể xóa', 'Cần giữ lại ít nhất một tài khoản.');
    if (state.transactions.some(t => t.account === a.id || t.to === a.id) || state.recurring.some(r => r.account === a.id)) return toast('Tài khoản đang được dùng', 'Hãy xóa hoặc chuyển các giao dịch của tài khoản này trước.');
    if (window.confirm(`Xóa tài khoản “${a.name}”?`)) { state.accounts = state.accounts.filter(x => x !== a); commit('Đã xóa tài khoản', `Đã xóa “${a.name}”.`); }
  },
  'rec-add': () => recurringForm(),
  'rec-edit': el => recurringForm(el.dataset.id),
  'rec-post': el => postRecurring(el.dataset.id),
  'rec-toggle': el => { const r = state.recurring.find(x => x.id === el.dataset.id); if (r) { r.active = !r.active; commit(); } },
  'rec-del': el => { const r = state.recurring.find(x => x.id === el.dataset.id); if (r && window.confirm(`Xóa lịch “${r.name}”?`)) { state.recurring = state.recurring.filter(x => x !== r); commit('Đã xóa lịch định kỳ', `Đã xóa “${r.name}”.`); } },
  'settings-tab': el => { settingsTab = el.dataset.tab; renderSettings(); },
  'font-size': el => {
    const size = el.dataset.size;
    if (size === 'md') delete document.documentElement.dataset.font; else document.documentElement.dataset.font = size;
    try { localStorage.setItem(FONT_KEY, size); } catch { /* không lưu được thì chỉ áp dụng trong phiên này */ }
    renderSettings();
  },
  'save-profile': () => { state.profile = { name: $('#profileName').value.trim() || 'Bạn', email: $('#profileEmail').value.trim() }; commit('Đã lưu thông tin', 'Thông tin cá nhân đã được cập nhật.'); },
  'cat-add': el => addCategory(el.dataset.kind),
  'cat-del': el => removeCategory(el.dataset.kind, Number(el.dataset.index)),
  backup: () => { download(`so-chi-tieu-sao-luu-${isoOf(new Date())}.json`, JSON.stringify(state, null, 2), 'application/json'); toast('Đã sao lưu', 'Hãy cất file này ở nơi an toàn.'); },
  restore: () => $('#restoreFile').click(),
  seed: seedSample,
  'clear-sample': () => { if (window.confirm('Xóa dữ liệu mẫu? Dữ liệu bạn tự nhập sẽ không bị ảnh hưởng.')) { removeSample(); commit('Đã xóa dữ liệu mẫu', 'Dữ liệu cá nhân vẫn được giữ lại.'); } },
  'clear-all': () => { if (window.confirm('Xóa TOÀN BỘ dữ liệu trên thiết bị này? Không thể hoàn tác.')) { state = freshState(); month = monthOf(new Date()); commit('Đã xóa dữ liệu', 'Sổ đã được đặt lại.'); } }
};

document.addEventListener('click', event => {
  const el = event.target.closest('[data-action]');
  if (el) actions[el.dataset.action]?.(el);
  else if (event.target.classList.contains('modal-backdrop')) closeModals();
  if (!event.target.closest('.filter-bar')) $('#filterPopover').classList.remove('open');
});
document.addEventListener('input', event => {
  const input = event.target;
  if (input.matches('[data-money]')) input.value = formatMoneyInput(digits(input.value));
  if (input.id === 'transactionSearch') { filter.q = input.value; renderTransactions(); }
});
document.addEventListener('change', event => {
  const el = event.target;
  if (el.id === 'filterType') filter.type = el.value;
  if (el.id === 'filterCategory') filter.category = el.value;
  if (el.id === 'filterType' || el.id === 'filterCategory') renderTransactions();
  if (el.id === 'notifyBudget') { state.notifyBudget = el.checked; commit('Đã cập nhật thông báo', 'Tùy chọn của bạn đã được lưu.'); }
  if (el.id === 'restoreFile') { const file = el.files[0]; el.value = ''; file?.text().then(restoreFrom); }
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModals(); });

// Trang có thể mở cả ngày: cập nhật lời chào theo giờ, và vẽ lại hẳn khi sang ngày mới ("Hôm nay", cảnh báo...).
let lastDay = isoOf(new Date());
function tick() {
  renderGreeting();
  if (isoOf(new Date()) !== lastDay) { lastDay = isoOf(new Date()); render(); }
}
setInterval(tick, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

render();

