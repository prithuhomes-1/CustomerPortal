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
        value: JSON.stringify(value)
      });
    }
  }
  return rows;
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
    keyCell.textContent = row.key;
    valueCell.textContent = row.value;
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
