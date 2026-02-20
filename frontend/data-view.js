const CONTENT_PATH = "./content.json";
const titleNode = document.getElementById("dataViewTitle");
const subtitleNode = document.getElementById("dataViewSubtitle");
const backLinkNode = document.getElementById("backLink");
const tablesRoot = document.getElementById("tablesRoot");
const downloadButton = document.getElementById("download-json-btn");
const expandAllButton = document.getElementById("expand-all-btn");
const collapseAllButton = document.getElementById("collapse-all-btn");
const shortcutTitleNode = document.getElementById("shortcut-title");
const shortcutListNode = document.getElementById("shortcut-list");
let pageContent = null;
const sectionIds = [];

const recordPathLinkMap = {
  "projects.title": "./index.html#projects-title",
  "projects.subtitle": "./index.html#projects-subtitle",
  "projects.actions.loadProjects": "./index.html#load-projects-btn",
  "projects.actions.loadAgreements": "./index.html#load-agreements-btn",
  "projects.actions.loadMilestones": "./index.html#load-milestones-btn",
  "hero.title": "./index.html#hero-title",
  "hero.subtitle": "./index.html#hero-subtitle",
  "features.title": "./index.html#features-title",
  "features.subtitle": "./index.html#features-subtitle",
  "footer.text": "./index.html#footer-text"
};

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

function getRecordLink(fullPath) {
  if (recordPathLinkMap[fullPath]) {
    return recordPathLinkMap[fullPath];
  }

  const sectionName = fullPath.split(".")[0];
  if (sectionName === "projects") {
    return "./index.html#projects";
  }
  if (sectionName === "features") {
    return "./index.html#trainings";
  }
  if (sectionName === "hero" || sectionName === "brand" || sectionName === "auth" || sectionName === "navigation" || sectionName === "site") {
    return "./index.html#top";
  }
  if (sectionName === "footer") {
    return "./index.html#footer-text";
  }
  if (sectionName === "dataView") {
    return "./data-view.html#top";
  }

  return "./index.html#top";
}

function renderTable(sectionName, sectionData, keyHeader, valueHeader, linkHeader, linkLabel) {
  const section = document.createElement("section");
  section.className = "data-section";
  const sectionId = `section-${sectionName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  section.id = sectionId;
  sectionIds.push({ id: sectionId, name: sectionName });

  const details = document.createElement("details");
  details.open = true;
  const summary = document.createElement("summary");
  summary.className = "section-summary";
  const title = document.createElement("span");
  title.textContent = sectionName;
  const link = document.createElement("a");
  link.className = "summary-link";
  link.href = `#${sectionId}`;
  link.textContent = "Link";
  summary.appendChild(title);
  summary.appendChild(link);
  details.appendChild(summary);

  const table = document.createElement("table");

  const thead = document.createElement("thead");
  thead.innerHTML = `<tr><th>${keyHeader}</th><th>${valueHeader}</th><th>${linkHeader}</th></tr>`;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  const rows = flattenObject(sectionData);
  for (const row of rows) {
    const tr = document.createElement("tr");
    const keyCell = document.createElement("td");
    const valueCell = document.createElement("td");
    const linkCell = document.createElement("td");

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
    const rowLink = document.createElement("a");
    rowLink.href = getRecordLink(fullPath);
    rowLink.textContent = linkLabel;
    rowLink.className = "summary-link";
    linkCell.appendChild(rowLink);
    tr.appendChild(keyCell);
    tr.appendChild(valueCell);
    tr.appendChild(linkCell);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  details.appendChild(table);
  section.appendChild(details);
  tablesRoot.appendChild(section);
}

function wireExpandCollapseControls() {
  const allDetails = () => Array.from(tablesRoot.querySelectorAll("details"));

  if (expandAllButton) {
    expandAllButton.addEventListener("click", () => {
      allDetails().forEach((item) => { item.open = true; });
    });
  }

  if (collapseAllButton) {
    collapseAllButton.addEventListener("click", () => {
      allDetails().forEach((item) => { item.open = false; });
    });
  }
}

function renderShortcuts(title) {
  if (!shortcutListNode) {
    return;
  }

  if (shortcutTitleNode) {
    shortcutTitleNode.textContent = title;
  }

  shortcutListNode.innerHTML = "";
  sectionIds.forEach((item) => {
    const li = document.createElement("li");
    const anchor = document.createElement("a");
    anchor.href = `#${item.id}`;
    anchor.textContent = item.name;
    li.appendChild(anchor);
    shortcutListNode.appendChild(li);
  });
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
  expandAllButton.textContent = content?.dataView?.expandAllButton ?? "Expand All";
  collapseAllButton.textContent = content?.dataView?.collapseAllButton ?? "Collapse All";

  const keyHeader = content?.dataView?.table?.keyColumn ?? "Key";
  const valueHeader = content?.dataView?.table?.valueColumn ?? "Value";
  const linkHeader = content?.dataView?.table?.linkColumn ?? "Link";
  const linkLabel = content?.dataView?.recordLinkLabel ?? "Go";

  for (const [sectionName, sectionData] of Object.entries(content)) {
    renderTable(sectionName, sectionData, keyHeader, valueHeader, linkHeader, linkLabel);
  }

  renderShortcuts(content?.dataView?.sectionShortcutsTitle ?? "Section Shortcuts");
  wireDownload();
  wireExpandCollapseControls();
}

bootstrap().catch((err) => {
  tablesRoot.innerHTML = "";
  const error = document.createElement("section");
  error.className = "data-section";
  error.innerHTML = `<h2>Error</h2><pre>${typeof err === "string" ? err : JSON.stringify(err, null, 2)}</pre>`;
  tablesRoot.appendChild(error);
});
