const CONC_UNITS = ["×", "kM", "M", "mM", "µM", "nM"];
const VOL_UNITS = ["kl", "l", "ml", "µl", "nl"];
const CONC_FACTORS = { "×": 1, "kM": 1e3, "M": 1, "mM": 1e-3, "µM": 1e-6, "nM": 1e-9 };
const VOL_FACTORS = { "kl": 1e3, "l": 1, "ml": 1e-3, "µl": 1e-6, "nl": 1e-9 };
const STORAGE_KEY = "concentrationCalculator.conditions.v1";
const HISTORY_KEY = "concentrationCalculator.generatedHistory.v1";
// v3 avoids silently restoring older defaults and adds output concentration columns.
const DRAFT_KEY = "concentrationCalculator.currentDraft.v3";
const HISTORY_MAX = 50;

const defaultRows = [
  { name: "Aβ", initialValue: 1, initialUnit: "mM", finalValue: 100, finalUnit: "µM", amountUnit: "µl" },
  { name: "PBS", initialValue: 10, initialUnit: "×", finalValue: 1, finalUnit: "×", amountUnit: "µl" }
];

const platePresets = [
  "Aβ + 10% PBS",
  "DMSO + 10% PBS",
  "Aβ + 10% 菌体",
  "DMSO + 10% 菌体",
  "DMSO + 10% 培地"
];

const el = (id) => document.getElementById(id);
let draftTimer = null;
let suppressDraft = false;

function fillSelect(select, values, selected) {
  select.innerHTML = "";
  values.forEach(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    if (value === selected) option.selected = true;
    select.appendChild(option);
  });
}

function parseNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toBaseConcentration(value, unit) {
  const n = parseNum(value);
  if (n === null || !(unit in CONC_FACTORS)) return null;
  return n * CONC_FACTORS[unit];
}

function toLiters(value, unit) {
  const n = parseNum(value);
  if (n === null || !(unit in VOL_FACTORS)) return null;
  return n * VOL_FACTORS[unit];
}

function fromLiters(liters, unit) {
  if (liters === null || !Number.isFinite(liters) || !(unit in VOL_FACTORS)) return null;
  return liters / VOL_FACTORS[unit];
}

function digits() {
  return Math.max(0, Math.min(10, parseInt(el("amountDigits").value || "4", 10)));
}

function formatNumber(value) {
  if (value === null || !Number.isFinite(value)) return "";
  const d = digits();
  const rounded = Number(value.toFixed(d));
  return rounded.toLocaleString(undefined, { maximumFractionDigits: d });
}

function rawNumber(value) {
  if (value === null || !Number.isFinite(value)) return "";
  const d = digits();
  return Number(value.toFixed(d)).toString();
}

function includeConcentrations() {
  return Boolean(el("includeConcentrations")?.checked);
}

function concentrationText(value, unit) {
  if (value === null || value === undefined || value === "") return "";
  const n = parseNum(value);
  if (n === null) return "";
  return `${String(value).trim()} ${unit || ""}`.trim();
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}

function safeFileName(name) {
  return String(name).trim().replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "") || "file";
}

function nowIso() {
  return new Date().toISOString();
}

function createRow(data = {}) {
  const template = el("rowTemplate");
  const tr = template.content.firstElementChild.cloneNode(true);
  fillSelect(tr.querySelector(".initial-unit"), CONC_UNITS, data.initialUnit || "µM");
  fillSelect(tr.querySelector(".final-unit"), CONC_UNITS, data.finalUnit || "µM");
  fillSelect(tr.querySelector(".amount-unit"), VOL_UNITS, data.amountUnit || "µl");
  tr.querySelector(".reagent-name").value = data.name || "";
  tr.querySelector(".initial-value").value = data.initialValue ?? "";
  tr.querySelector(".final-value").value = data.finalValue ?? "";
  tr.querySelectorAll("input, select").forEach(input => input.addEventListener("input", () => {
    calculate();
    scheduleDraftSave();
  }));
  tr.querySelector(".remove-row").addEventListener("click", () => {
    tr.remove();
    updateIndexes();
    calculate();
    scheduleDraftSave();
  });
  el("reagentBody").appendChild(tr);
  updateIndexes();
  calculate();
}

function updateIndexes() {
  [...el("reagentBody").children].forEach((tr, idx) => tr.querySelector(".row-index").textContent = idx + 1);
}

function getRows() {
  return [...el("reagentBody").children].map(tr => ({
    name: tr.querySelector(".reagent-name").value.trim(),
    initialValue: tr.querySelector(".initial-value").value,
    initialUnit: tr.querySelector(".initial-unit").value,
    finalValue: tr.querySelector(".final-value").value,
    finalUnit: tr.querySelector(".final-unit").value,
    amountUnit: tr.querySelector(".amount-unit").value,
    tr
  }));
}

function calculate() {
  const totalL = toLiters(el("totalValue").value, el("totalUnit").value);
  const output = [];
  let usedL = 0;
  let warning = "";

  for (const row of getRows()) {
    const initialBase = toBaseConcentration(row.initialValue, row.initialUnit);
    const finalBase = toBaseConcentration(row.finalValue, row.finalUnit);
    const amountBox = row.tr.querySelector(".amount-value");

    if (!row.name && row.initialValue === "" && row.finalValue === "") {
      amountBox.value = "";
      continue;
    }

    if (totalL === null || initialBase === null || finalBase === null || initialBase === 0) {
      amountBox.value = "";
      if (row.name || row.initialValue !== "" || row.finalValue !== "") warning = "未入力または0の初濃度があるため、一部の行は計算していません。";
      continue;
    }

    const amountL = finalBase * totalL / initialBase;
    const amountShown = fromLiters(amountL, row.amountUnit);
    amountBox.value = formatNumber(amountShown);
    usedL += amountL;
    output.push({
      name: row.name || "(no name)",
      initialText: concentrationText(row.initialValue, row.initialUnit),
      finalText: concentrationText(row.finalValue, row.finalUnit),
      amountL,
      amount: amountShown,
      amountText: rawNumber(amountShown),
      unit: row.amountUnit
    });
  }

  if (totalL !== null && el("includeWater").checked) {
    const waterL = totalL - usedL;
    if (waterL < -1e-15) warning = "添加量の合計がTotalを超えています。H₂O量が負になります。";
    const waterAmount = fromLiters(waterL, el("totalUnit").value);
    output.push({ name: el("waterName").value || "H₂O", initialText: "", finalText: "", amountL: waterL, amount: waterAmount, amountText: rawNumber(waterAmount), unit: el("totalUnit").value, water: true });
  }

  if (totalL !== null) {
    const totalAmount = parseNum(el("totalValue").value);
    output.push({ name: "Total", initialText: "", finalText: "", amountL: totalL, amount: totalAmount, amountText: rawNumber(totalAmount), unit: el("totalUnit").value, total: true });
  }

  renderOutput(output, warning);
  return output;
}

function renderOutput(rows, warning = "") {
  el("outputTitle").textContent = el("projectName").value.trim() || "Generated table";
  const showConcs = includeConcentrations();
  el("outputHead").innerHTML = showConcs
    ? "<tr><th>Reagent</th><th>Initial con.</th><th>Final con.</th><th>Amount</th><th>Unit</th></tr>"
    : "<tr><th>Reagent</th><th>Amount</th><th>Unit</th></tr>";
  el("outputBody").innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    if (row.water) tr.classList.add("water-row");
    if (row.total) tr.classList.add("total-row");
    tr.innerHTML = showConcs
      ? `<td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.initialText || "")}</td><td>${escapeHtml(row.finalText || "")}</td><td class="amount-cell">${formatNumber(row.amount)}</td><td>${escapeHtml(row.unit)}</td>`
      : `<td>${escapeHtml(row.name)}</td><td class="amount-cell">${formatNumber(row.amount)}</td><td>${escapeHtml(row.unit)}</td>`;
    el("outputBody").appendChild(tr);
  }
  const status = el("status");
  status.textContent = warning || "Calculated.";
  status.classList.toggle("warning", Boolean(warning));
}

function normalizeOutputRows(rows) {
  return rows.map(row => ({
    name: row.name || "",
    initialText: row.initialText || "",
    finalText: row.finalText || "",
    amount: Number.isFinite(row.amount) ? row.amount : parseNum(row.amountText),
    amountText: row.amountText ?? (Number.isFinite(row.amount) ? rawNumber(row.amount) : ""),
    unit: row.unit || "",
    water: Boolean(row.water),
    total: Boolean(row.total)
  }));
}

function tableLines(rows = calculate(), showConcs = includeConcentrations()) {
  const normalized = normalizeOutputRows(rows);
  if (showConcs) {
    return [["Reagent", "Initial con.", "Final con.", "Amount", "Unit"], ...normalized.map(row => [row.name, row.initialText || "", row.finalText || "", row.amountText, row.unit])];
  }
  return [["Reagent", "Amount", "Unit"], ...normalized.map(row => [row.name, row.amountText, row.unit])];
}

function outputAsTsv(rows = calculate(), showConcs = includeConcentrations()) {
  return tableLines(rows, showConcs).map(line => line.join("\t")).join("\n");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function outputAsCsv(rows = calculate(), showConcs = includeConcentrations()) {
  return tableLines(rows, showConcs).map(line => line.map(csvEscape).join(",")).join("\n");
}

function outputAsHtmlTable(rows = calculate(), title = el("projectName").value.trim() || "Generated table", showConcs = includeConcentrations()) {
  const normalized = normalizeOutputRows(rows);
  const body = normalized.map(row => {
    const rowStyle = row.total ? ' style="font-weight:700;background:#f1f4f9;"' : (row.water ? ' style="background:#fbfdff;"' : "");
    const prefix = showConcs ? `<td>${escapeHtml(row.initialText || "")}</td><td>${escapeHtml(row.finalText || "")}</td>` : "";
    return `<tr${rowStyle}><td>${escapeHtml(row.name)}</td>${prefix}<td style="text-align:right;">${escapeHtml(row.amountText)}</td><td>${escapeHtml(row.unit)}</td></tr>`;
  }).join("");
  const headers = showConcs
    ? "<th>Reagent</th><th>Initial con.</th><th>Final con.</th><th>Amount</th><th>Unit</th>"
    : "<th>Reagent</th><th>Amount</th><th>Unit</th>";
  return `
    <div>
      <h3>${escapeHtml(title)}</h3>
      <table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:12pt;">
        <thead><tr>${headers.replaceAll("<th>", '<th style="border:1px solid #d8dee9;background:#f1f4f9;padding:6px 10px;">')}</tr></thead>
        <tbody>${body.replaceAll("<td>", '<td style="border:1px solid #d8dee9;padding:6px 10px;">').replaceAll('<td style="text-align:right;">', '<td style="border:1px solid #d8dee9;padding:6px 10px;text-align:right;">')}</tbody>
      </table>
    </div>`;
}

async function copyText(text, message = "Copied to clipboard.") {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(message);
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    setStatus(message);
  }
}

async function copyTable(rows = calculate(), title = el("projectName").value.trim() || "Generated table", showConcs = includeConcentrations()) {
  const html = outputAsHtmlTable(rows, title, showConcs);
  const plain = outputAsTsv(rows, showConcs);
  try {
    if (navigator.clipboard?.write && window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" })
        })
      ]);
      setStatus("Copied as table. Word/Excel/PowerPointに表として貼り付けできます。");
    } else {
      await copyText(plain, "Copied as TSV table.");
    }
  } catch (e) {
    await copyText(plain, "Copied as TSV table. HTML table copy was not available in this browser.");
  }
}

function setStatus(text, warning = false) {
  el("status").textContent = text;
  el("status").classList.toggle("warning", warning);
}

function download(filename, content, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  downloadBlob(filename, blob);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function getState() {
  return {
    name: el("projectName").value,
    totalValue: el("totalValue").value,
    totalUnit: el("totalUnit").value,
    amountDigits: el("amountDigits").value,
    includeWater: el("includeWater").checked,
    includeConcentrations: includeConcentrations(),
    waterName: el("waterName").value,
    rows: getRows().map(({ tr, ...row }) => row),
    plate: getPlateData(),
    updatedAt: nowIso()
  };
}

function setState(state, options = {}) {
  const { saveDraft = true } = options;
  suppressDraft = !saveDraft;
  el("projectName").value = state.name || "";
  el("totalValue").value = state.totalValue ?? 160;
  el("totalUnit").value = state.totalUnit || "µl";
  el("amountDigits").value = state.amountDigits ?? 4;
  el("includeWater").checked = state.includeWater ?? true;
  el("includeConcentrations").checked = state.includeConcentrations ?? false;
  el("waterName").value = state.waterName || "H₂O";
  el("reagentBody").innerHTML = "";
  (state.rows?.length ? state.rows : defaultRows).forEach(createRow);
  if (state.plate) setPlateData(state.plate);
  updateIndexes();
  calculate();
  suppressDraft = false;
  if (saveDraft) saveDraftNow();
}

function loadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || ""); }
  catch { return fallback; }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadSavedMap() {
  return loadJson(STORAGE_KEY, {}) || {};
}

function saveSavedMap(map) {
  saveJson(STORAGE_KEY, map);
}

function saveCurrent() {
  const state = getState();
  const key = state.name?.trim() || `condition-${Date.now()}`;
  const map = loadSavedMap();
  map[key] = state;
  saveSavedMap(map);
  renderSavedList();
  setStatus(`Saved condition: ${key}`);
}

function renderSavedList() {
  const map = loadSavedMap();
  const list = el("savedList");
  list.innerHTML = "";
  const entries = Object.entries(map).sort((a, b) => (b[1].updatedAt || "").localeCompare(a[1].updatedAt || ""));
  if (!entries.length) {
    list.textContent = "No saved conditions.";
    return;
  }
  for (const [key, state] of entries) {
    const item = document.createElement("div");
    item.className = "saved-item";
    const date = state.updatedAt ? new Date(state.updatedAt).toLocaleString() : "";
    item.innerHTML = `<div><strong>${escapeHtml(key)}</strong><div class="meta">${escapeHtml(date)} / ${state.rows?.length || 0} reagents</div></div>`;
    const actions = document.createElement("div");
    actions.className = "button-row";
    const load = document.createElement("button");
    load.type = "button";
    load.textContent = "Load";
    load.onclick = () => { setState(state); switchTab("calc"); };
    const del = document.createElement("button");
    del.type = "button";
    del.className = "danger";
    del.textContent = "Delete";
    del.onclick = () => { const m = loadSavedMap(); delete m[key]; saveSavedMap(m); renderSavedList(); };
    actions.append(load, del);
    item.appendChild(actions);
    list.appendChild(item);
  }
}

function saveDraftNow() {
  if (suppressDraft) return;
  saveJson(DRAFT_KEY, getState());
}

function scheduleDraftSave() {
  if (suppressDraft) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraftNow, 250);
}

function loadDraft() {
  return loadJson(DRAFT_KEY, null);
}

function loadHistory() {
  const history = loadJson(HISTORY_KEY, []);
  return Array.isArray(history) ? history : [];
}

function saveHistory(history) {
  saveJson(HISTORY_KEY, history.slice(0, HISTORY_MAX));
}

function addHistoryRecord(rows = calculate()) {
  const state = getState();
  const title = state.name?.trim() || "Generated table";
  const record = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: title,
    createdAt: nowIso(),
    state,
    outputRows: normalizeOutputRows(rows),
    includeConcentrations: state.includeConcentrations ?? includeConcentrations()
  };
  const history = [record, ...loadHistory()].slice(0, HISTORY_MAX);
  saveHistory(history);
  renderHistoryList();
  return record;
}

function renderHistoryList() {
  const history = loadHistory();
  const list = el("historyList");
  list.innerHTML = "";
  if (!history.length) {
    list.textContent = "No generated history.";
    return;
  }
  for (const record of history) {
    const item = document.createElement("div");
    item.className = "saved-item";
    const date = record.createdAt ? new Date(record.createdAt).toLocaleString() : "";
    const previewRows = (record.outputRows || []).filter(r => !r.total).slice(0, 4);
    const preview = previewRows.map(r => `<span>${escapeHtml(r.name)}: ${escapeHtml(r.amountText)} ${escapeHtml(r.unit)}</span>`).join("");
    item.innerHTML = `<div><strong>${escapeHtml(record.name || "Generated table")}</strong><div class="meta">${escapeHtml(date)} / ${(record.outputRows || []).length} rows</div><div class="history-preview">${preview}</div></div>`;

    const actions = document.createElement("div");
    actions.className = "button-row";

    const load = document.createElement("button");
    load.type = "button";
    load.textContent = "Load input";
    load.onclick = () => { if (record.state) setState(record.state); switchTab("calc"); };

    const copyTbl = document.createElement("button");
    copyTbl.type = "button";
    copyTbl.textContent = "Copy table";
    copyTbl.onclick = () => copyTable(record.outputRows || [], record.name || "Generated table", record.includeConcentrations ?? includeConcentrations());

    const copyImg = document.createElement("button");
    copyImg.type = "button";
    copyImg.textContent = "Copy image";
    copyImg.onclick = () => copyImage(record.outputRows || [], record.name || "Generated table", record.includeConcentrations ?? includeConcentrations());

    const csv = document.createElement("button");
    csv.type = "button";
    csv.textContent = "CSV";
    csv.onclick = () => download(`${safeFileName(record.name || "preparation")}_${record.createdAt?.slice(0, 10) || "history"}.csv`, outputAsCsv(record.outputRows || [], record.includeConcentrations ?? includeConcentrations()), "text/csv;charset=utf-8");

    const del = document.createElement("button");
    del.type = "button";
    del.className = "danger";
    del.textContent = "Delete";
    del.onclick = () => {
      saveHistory(loadHistory().filter(x => x.id !== record.id));
      renderHistoryList();
    };

    actions.append(load, copyTbl, copyImg, csv, del);
    item.appendChild(actions);
    list.appendChild(item);
  }
}

function buildImageHtml(rows, title, showConcs = includeConcentrations()) {
  const normalized = normalizeOutputRows(rows);
  const headers = showConcs
    ? "<th>Reagent</th><th>Initial con.</th><th>Final con.</th><th>Amount</th><th>Unit</th>"
    : "<th>Reagent</th><th>Amount</th><th>Unit</th>";
  const styledHeaders = headers.replaceAll("<th>", '<th style="border:1px solid #d8dee9;background:#f1f4f9;padding:8px 12px;text-align:center;">');
  const trHtml = normalized.map(row => {
    const bg = row.total ? "background:#f1f4f9;font-weight:700;" : (row.water ? "background:#fbfdff;" : "background:#ffffff;");
    const prefix = showConcs ? `<td style="border:1px solid #d8dee9;padding:8px 12px;">${escapeHtml(row.initialText || "")}</td><td style="border:1px solid #d8dee9;padding:8px 12px;">${escapeHtml(row.finalText || "")}</td>` : "";
    return `<tr style="${bg}"><td style="border:1px solid #d8dee9;padding:8px 12px;">${escapeHtml(row.name)}</td>${prefix}<td style="border:1px solid #d8dee9;padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums;">${escapeHtml(row.amountText)}</td><td style="border:1px solid #d8dee9;padding:8px 12px;">${escapeHtml(row.unit)}</td></tr>`;
  }).join("");
  const width = showConcs ? 900 : 700;
  return `
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;background:#ffffff;color:#172033;font-family:Arial,'Helvetica Neue',sans-serif;padding:24px;box-sizing:border-box;">
      <h3 style="margin:0 0 12px;font-size:18px;line-height:1.25;">${escapeHtml(title)}</h3>
      <table style="width:100%;border-collapse:collapse;font-size:15px;">
        <thead><tr>${styledHeaders}</tr></thead>
        <tbody>${trHtml}</tbody>
      </table>
    </div>`;
}

async function outputImageBlob(rows = calculate(), title = el("projectName").value.trim() || "Generated table", showConcs = includeConcentrations()) {
  const normalized = normalizeOutputRows(rows);
  const width = showConcs ? 900 : 700;
  const height = Math.max(140, 84 + 40 * (normalized.length + 1));
  const html = buildImageHtml(normalized, title, showConcs);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${html}</foreignObject></svg>`;
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0);
  return await new Promise(resolve => canvas.toBlob(resolve, "image/png", 1));
}

async function copyImage(rows = calculate(), title = el("projectName").value.trim() || "Generated table", showConcs = includeConcentrations()) {
  try {
    const blob = await outputImageBlob(rows, title, showConcs);
    if (!blob) throw new Error("Could not create image.");
    if (navigator.clipboard?.write && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setStatus("Copied as PNG image.");
    } else {
      throw new Error("Image clipboard is not supported.");
    }
  } catch (e) {
    try {
      const blob = await outputImageBlob(rows, title, showConcs);
      downloadBlob(`${safeFileName(title)}.png`, blob);
      setStatus("画像コピーがブラウザで許可されなかったため、PNGとして保存しました。", true);
    } catch (downloadError) {
      setStatus("画像の作成に失敗しました。このブラウザでは画像コピーが制限されている可能性があります。", true);
    }
  }
}

async function downloadOutputPng(rows = calculate(), title = el("projectName").value.trim() || "Generated table", showConcs = includeConcentrations()) {
  try {
    const blob = await outputImageBlob(rows, title, showConcs);
    downloadBlob(`${safeFileName(title)}.png`, blob);
    setStatus("Downloaded PNG.");
  } catch (e) {
    setStatus("PNG作成に失敗しました。", true);
  }
}

function buildPlate() {
  const table = el("plateTable");
  table.innerHTML = "";
  const head = document.createElement("tr");
  head.appendChild(document.createElement("th"));
  for (let c = 1; c <= 12; c++) {
    const th = document.createElement("th");
    th.textContent = c;
    head.appendChild(th);
  }
  table.appendChild(head);
  for (const rowName of "ABCDEFGH") {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = rowName;
    tr.appendChild(th);
    for (let c = 1; c <= 12; c++) {
      const td = document.createElement("td");
      td.contentEditable = "true";
      td.dataset.well = `${rowName}${c}`;
      td.addEventListener("click", () => td.classList.toggle("selected"));
      td.addEventListener("input", scheduleDraftSave);
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
}

function getPlateCells() {
  return [...el("plateTable").querySelectorAll("td[data-well]")];
}

function getPlateData() {
  const data = {};
  for (const cell of getPlateCells()) if (cell.textContent.trim()) data[cell.dataset.well] = cell.textContent.trim();
  return data;
}

function setPlateData(data) {
  for (const cell of getPlateCells()) {
    cell.textContent = data[cell.dataset.well] || "";
    cell.classList.remove("selected");
  }
}

function plateAsTsv() {
  const lines = [["", ...Array.from({ length: 12 }, (_, i) => String(i + 1))]];
  for (const rowName of "ABCDEFGH") {
    const line = [rowName];
    for (let c = 1; c <= 12; c++) {
      const cell = el("plateTable").querySelector(`[data-well="${rowName}${c}"]`);
      line.push((cell?.textContent || "").replace(/\n/g, " "));
    }
    lines.push(line);
  }
  return lines.map(line => line.join("\t")).join("\n");
}

function initEvents() {
  ["totalValue", "totalUnit", "amountDigits", "includeWater", "includeConcentrations", "waterName", "projectName"].forEach(id => {
    el(id).addEventListener("input", () => {
      calculate();
      scheduleDraftSave();
    });
  });
  el("addRowBtn").onclick = () => { createRow({ initialUnit: "µM", finalUnit: "µM", amountUnit: "µl" }); scheduleDraftSave(); };
  el("sampleBtn").onclick = () => setState({ name: "Aβ preparation", totalValue: 160, totalUnit: "µl", amountDigits: 4, includeWater: true, includeConcentrations: false, waterName: "H₂O", rows: defaultRows });
  el("clearBtn").onclick = () => { el("reagentBody").innerHTML = ""; createRow(); calculate(); scheduleDraftSave(); };
  el("generateBtn").onclick = () => {
    const rows = calculate();
    addHistoryRecord(rows);
    setStatus("Generated and saved to history.");
  };
  el("copyTableBtn").onclick = () => copyTable();
  el("copyImageBtn").onclick = () => copyImage();
  el("downloadPngBtn").onclick = () => downloadOutputPng();
  el("downloadCsvBtn").onclick = () => download(`${safeFileName(el("projectName").value || "preparation")}.csv`, outputAsCsv(), "text/csv;charset=utf-8");
  el("printBtn").onclick = () => window.print();
  el("saveBtn").onclick = saveCurrent;
  el("loadBtn").onclick = () => { switchTab("saved"); renderSavedList(); };
  el("refreshSavedBtn").onclick = renderSavedList;
  el("refreshHistoryBtn").onclick = renderHistoryList;
  el("clearHistoryBtn").onclick = () => {
    if (confirm("Generated historyをすべて削除しますか？")) {
      saveHistory([]);
      renderHistoryList();
      setStatus("History cleared.");
    }
  };
  el("exportJsonBtn").onclick = () => download(`${safeFileName(el("projectName").value || "condition")}.json`, JSON.stringify(getState(), null, 2), "application/json;charset=utf-8");
  el("importJsonInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setState(JSON.parse(text));
      setStatus("Imported JSON.");
    } catch (e) {
      setStatus("JSONの読み込みに失敗しました。", true);
    }
    event.target.value = "";
  });
  document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => {
    switchTab(tab.dataset.tab);
    if (tab.dataset.tab === "history") renderHistoryList();
    if (tab.dataset.tab === "saved") renderSavedList();
  }));

  fillSelect(el("platePreset"), platePresets, platePresets[0]);
  el("fillSelectedBtn").onclick = () => {
    const value = el("platePreset").value;
    const selected = getPlateCells().filter(cell => cell.classList.contains("selected"));
    for (const cell of selected) cell.textContent = value;
    scheduleDraftSave();
  };
  el("clearPlateBtn").onclick = () => {
    for (const cell of getPlateCells()) { cell.textContent = ""; cell.classList.remove("selected"); }
    scheduleDraftSave();
  };
  el("copyPlateBtn").onclick = () => copyText(plateAsTsv(), "Copied plate as table text.");
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach(tab => tab.classList.toggle("active", tab.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.remove("active"));
  el(`${name}Tab`).classList.add("active");
}

function init() {
  fillSelect(el("totalUnit"), VOL_UNITS, "µl");
  buildPlate();
  initEvents();
  const draft = loadDraft();
  if (draft?.rows?.length) {
    setState(draft, { saveDraft: false });
  } else {
    defaultRows.forEach(createRow);
    calculate();
  }
  renderSavedList();
  renderHistoryList();
}

document.addEventListener("DOMContentLoaded", init);

// PWA registration and optional Android/desktop install prompt.
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  const btn = document.getElementById('installBtn');
  if (btn) btn.hidden = false;
});
window.addEventListener('appinstalled', () => {
  const btn = document.getElementById('installBtn');
  if (btn) btn.hidden = true;
  deferredInstallPrompt = null;
});
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('installBtn');
  if (btn) {
    btn.addEventListener('click', async () => {
      if (!deferredInstallPrompt) {
        alert('iPhone/iPadではSafariの共有ボタンから「ホーム画面に追加」を選んでください。');
        return;
      }
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      btn.hidden = true;
    });
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }
});
