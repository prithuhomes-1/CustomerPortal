const CONTENT_PATH = "./content.json";
const titleNode = document.getElementById("dataViewTitle");
const subtitleNode = document.getElementById("dataViewSubtitle");
const backLinkNode = document.getElementById("backLink");
const tablesRoot = document.getElementById("tablesRoot");
const downloadButton = document.getElementById("download-json-btn");
let pageContent = null;

function flattenObject(obj, prefix = "") {
  const rows = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      rows.push(...flattenObject(value, path));
    } else {
      rows.push({
        key: path,
        value,
        valueType: Array.isArray(value) ? "array" : value === null ? "null" : typeof value
      });
    }
  }
  return rows;
}

function parseEditedValue(rawValue, valueType) {
  if (valueType === "string") {
    return rawValue;
  }

  if (valueType === "number") {
    const parsed = Number(rawValue);
    if (Number.isNaN(parsed)) {
      throw new Error("Expected number");
    }
    return parsed;
  }

  if (valueType === "boolean") {
    const normalized = String(rawValue).trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
    throw new Error("Expected true/false");
  }

  if (valueType === "null") {
    return null;
  }

  if (valueType === "array" || valueType === "object") {
    return JSON.parse(rawValue);
  }

  return rawValue;
}

function setValueByPath(target, path, value) {
  const keys = path.split(".");
  let cursor = target;

  for (let i = 0; i < keys.length - 1; i += 1) {
    cursor = cursor[keys[i]];
  }

  cursor[keys[keys.length - 1]] = value;
}

function renderTable(sectionName, sectionData, keyHeader, valueHeader) {
  const section = document.createElement("section");
  section.className = "data-section";

  const heading = document.createElement("h2");
  heading.textContent = sectionName;
  section.appendChild(heading);

  const table = document.createElement("table");

  const thead = document.createElement("thead");
  thead.innerHTML = `<tr><th>${keyHeader}</th><th>${valueHeader}</th></tr>`;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  const rows = flattenObject(sectionData);
  for (const row of rows) {
    const tr = document.createElement("tr");
    const keyCell = document.createElement("td");
    const valueCell = document.createElement("td");

    const fullPath = `${sectionName}.${row.key}`;
    const editor = document.createElement("textarea");
    editor.className = "value-editor";
    editor.value =
      row.valueType === "object" || row.valueType === "array"
        ? JSON.stringify(row.value, null, 2)
        : row.value === null
          ? "null"
          : String(row.value);
    editor.rows = row.valueType === "object" || row.valueType === "array" ? 4 : 1;
    editor.addEventListener("change", () => {
      try {
        const parsed = parseEditedValue(editor.value, row.valueType);
        setValueByPath(pageContent, fullPath, parsed);
        editor.classList.remove("editor-invalid");
      } catch {
        editor.classList.add("editor-invalid");
      }
    });

    keyCell.textContent = row.key;
    valueCell.appendChild(editor);
    tr.appendChild(keyCell);
    tr.appendChild(valueCell);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  section.appendChild(table);
  tablesRoot.appendChild(section);
}

function wireDownload() {
  if (!downloadButton) {
    return;
  }

  downloadButton.addEventListener("click", () => {
    if (!pageContent) {
      return;
    }

    const data = JSON.stringify(pageContent, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "content.json";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  });
}

async function bootstrap() {
  const response = await fetch(CONTENT_PATH, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Failed to load content.json (${response.status}).`);
  }

  const content = await response.json();
  pageContent = content;

  document.title = content?.dataView?.pageTitle ?? "Content Data View";
  titleNode.textContent = content?.dataView?.pageTitle ?? "Content Data View";
  subtitleNode.textContent = content?.dataView?.pageSubtitle ?? "";
  backLinkNode.textContent = content?.dataView?.backLink ?? "Back to Home";
  downloadButton.textContent = content?.dataView?.downloadButton ?? "Download JSON";

  const keyHeader = content?.dataView?.table?.keyColumn ?? "Key";
  const valueHeader = content?.dataView?.table?.valueColumn ?? "Value";

  for (const [sectionName, sectionData] of Object.entries(content)) {
    renderTable(sectionName, sectionData, keyHeader, valueHeader);
  }

  wireDownload();
}

bootstrap().catch((err) => {
  tablesRoot.innerHTML = "";
  const error = document.createElement("section");
  error.className = "data-section";
  error.innerHTML = `<h2>Error</h2><pre>${typeof err === "string" ? err : JSON.stringify(err, null, 2)}</pre>`;
  tablesRoot.appendChild(error);
});
