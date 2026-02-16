const CONTENT_PATH = "./content.json";
const titleNode = document.getElementById("dataViewTitle");
const subtitleNode = document.getElementById("dataViewSubtitle");
const backLinkNode = document.getElementById("backLink");
const tablesRoot = document.getElementById("tablesRoot");

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
  section.className = "panel";

  const heading = document.createElement("h2");
  heading.textContent = sectionName;
  section.appendChild(heading);

  const table = document.createElement("table");
  table.className = "data-table";

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

async function bootstrap() {
  const response = await fetch(CONTENT_PATH, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Failed to load content.json (${response.status}).`);
  }

  const content = await response.json();

  document.title = content?.dataView?.pageTitle ?? "Content Data View";
  titleNode.textContent = content?.dataView?.pageTitle ?? "Content Data View";
  subtitleNode.textContent = content?.dataView?.pageSubtitle ?? "";
  backLinkNode.textContent = content?.dataView?.backLink ?? "Back";

  const keyHeader = content?.dataView?.table?.keyColumn ?? "Key";
  const valueHeader = content?.dataView?.table?.valueColumn ?? "Value";

  for (const [sectionName, sectionData] of Object.entries(content)) {
    renderTable(sectionName, sectionData, keyHeader, valueHeader);
  }
}

bootstrap().catch((err) => {
  tablesRoot.innerHTML = "";
  const error = document.createElement("section");
  error.className = "panel error";
  error.innerHTML = `<h2>Error</h2><pre>${typeof err === "string" ? err : JSON.stringify(err, null, 2)}</pre>`;
  tablesRoot.appendChild(error);
});
