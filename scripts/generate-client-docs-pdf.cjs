const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "deliverables", "Autocare24-Client-Handover", "01-Client-Documents");
const htmlDir = path.join(outputDir, "_html");

const documents = [
  {
    title: "Customer Documentation",
    source: path.join(root, "docs", "CUSTOMER_DOCUMENTATION.md"),
    pdf: "Customer-Documentation.pdf"
  },
  {
    title: "Billing Calculations",
    source: path.join(root, "docs", "BILLING_CALCULATIONS.md"),
    pdf: "Billing-Calculations.pdf"
  },
  {
    title: "Quick Start Guide",
    source: path.join(root, "docs", "QUICK_START_GUIDE.md"),
    pdf: "Quick-Start-Guide.pdf"
  },
  {
    title: "Training Checklist",
    source: path.join(root, "docs", "TRAINING_CHECKLIST.md"),
    pdf: "Training-Checklist.pdf"
  }
];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInline(value) {
  let html = escapeHtml(value);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, href) => {
    const safeHref = href.startsWith("http") ? href : "#";
    return `<a href="${escapeHtml(safeHref)}">${text}</a>`;
  });
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return html;
}

function closeList(state, out) {
  if (!state.inList) return;
  out.push("</ul>");
  state.inList = false;
}

function renderTable(rows) {
  const normalized = rows
    .filter((line) => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line))
    .map((line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => renderInline(cell.trim())));
  if (!normalized.length) return "";
  const [head, ...body] = normalized;
  return [
    "<table>",
    "<thead><tr>",
    ...head.map((cell) => `<th>${cell}</th>`),
    "</tr></thead>",
    "<tbody>",
    ...body.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`),
    "</tbody>",
    "</table>"
  ].join("");
}

function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  const state = { inList: false, inCode: false };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (/^```/.test(line.trim())) {
      closeList(state, out);
      if (!state.inCode) {
        state.inCode = true;
        out.push("<pre><code>");
      } else {
        state.inCode = false;
        out.push("</code></pre>");
      }
      continue;
    }

    if (state.inCode) {
      out.push(`${escapeHtml(line)}\n`);
      continue;
    }

    if (!line.trim()) {
      closeList(state, out);
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      closeList(state, out);
      const level = Math.min(heading[1].length, 4);
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^\s*\|.+\|\s*$/.test(line)) {
      closeList(state, out);
      const tableRows = [];
      while (index < lines.length && /^\s*\|.+\|\s*$/.test(lines[index])) {
        tableRows.push(lines[index]);
        index += 1;
      }
      index -= 1;
      out.push(renderTable(tableRows));
      continue;
    }

    const bullet = /^\s*-\s+(.+)$/.exec(line);
    if (bullet) {
      if (!state.inList) {
        out.push("<ul>");
        state.inList = true;
      }
      out.push(`<li>${renderInline(bullet[1])}</li>`);
      continue;
    }

    closeList(state, out);
    out.push(`<p>${renderInline(line)}</p>`);
  }

  closeList(state, out);
  return out.join("\n");
}

function htmlDocument(title, body) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4; margin: 17mm 15mm; }
    * { box-sizing: border-box; }
    body {
      color: #1f2933;
      font-family: "Segoe UI", Arial, sans-serif;
      font-size: 10.5pt;
      line-height: 1.48;
      margin: 0;
    }
    .cover {
      border-bottom: 2px solid #166534;
      margin-bottom: 18px;
      padding-bottom: 12px;
    }
    .brand {
      color: #166534;
      font-size: 10pt;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    h1 {
      color: #0f172a;
      font-size: 25pt;
      line-height: 1.12;
      margin: 6px 0 8px;
      page-break-after: avoid;
    }
    h2 {
      border-bottom: 1px solid #d8dee4;
      color: #0f172a;
      font-size: 16pt;
      margin: 24px 0 8px;
      padding-bottom: 4px;
      page-break-after: avoid;
    }
    h3 {
      color: #1e3a8a;
      font-size: 12.5pt;
      margin: 16px 0 6px;
      page-break-after: avoid;
    }
    h4 {
      color: #334155;
      font-size: 11pt;
      margin: 12px 0 4px;
      page-break-after: avoid;
    }
    p { margin: 5px 0 8px; }
    ul { margin: 6px 0 10px 20px; padding: 0; }
    li { margin: 2px 0; }
    table {
      border-collapse: collapse;
      margin: 9px 0 14px;
      page-break-inside: avoid;
      width: 100%;
    }
    th {
      background: #edf7ef;
      color: #0f172a;
      font-weight: 700;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 5px 6px;
      text-align: left;
      vertical-align: top;
    }
    code {
      background: #f1f5f9;
      border-radius: 3px;
      color: #0f172a;
      font-family: Consolas, "Courier New", monospace;
      font-size: 9.5pt;
      padding: 1px 3px;
    }
    pre {
      background: #f8fafc;
      border: 1px solid #d8dee4;
      border-radius: 6px;
      overflow-wrap: anywhere;
      padding: 9px;
      white-space: pre-wrap;
    }
    pre code {
      background: transparent;
      padding: 0;
    }
    a { color: #166534; text-decoration: none; }
    .footer-note {
      color: #64748b;
      font-size: 9pt;
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <section class="cover">
    <div class="brand">Autocare24 Billing</div>
    <h1>${escapeHtml(title)}</h1>
    <p>Client handover document</p>
  </section>
  ${body}
  <p class="footer-note">Generated for Autocare24 Billing client handover.</p>
</body>
</html>`;
}

function findBrowser() {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function writePdf(browserPath, htmlPath, pdfPath) {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "autocare24-pdf-"));
  const result = spawnSync(browserPath, [
    "--headless",
    "--disable-gpu",
    "--disable-extensions",
    `--user-data-dir=${profileDir}`,
    `--print-to-pdf=${pdfPath}`,
    "--print-to-pdf-no-header",
    pathToFileURL(htmlPath).href
  ], {
    encoding: "utf8",
    windowsHide: true
  });

  fs.rmSync(profileDir, { recursive: true, force: true });
  if (result.status !== 0) {
    throw new Error(`PDF generation failed for ${path.basename(pdfPath)}: ${result.stderr || result.stdout}`);
  }
  const stat = fs.statSync(pdfPath);
  if (stat.size < 1024) throw new Error(`PDF generation produced an unexpectedly small file: ${pdfPath}`);
}

function main() {
  fs.mkdirSync(htmlDir, { recursive: true });
  const browserPath = findBrowser();
  if (!browserPath) throw new Error("Microsoft Edge or Google Chrome was not found for PDF generation.");

  for (const document of documents) {
    if (!fs.existsSync(document.source)) throw new Error(`Missing source document: ${document.source}`);
    const markdown = fs.readFileSync(document.source, "utf8");
    const html = htmlDocument(document.title, markdownToHtml(markdown));
    const htmlPath = path.join(htmlDir, document.pdf.replace(/\.pdf$/i, ".html"));
    const pdfPath = path.join(outputDir, document.pdf);
    fs.writeFileSync(htmlPath, html, "utf8");
    writePdf(browserPath, htmlPath, pdfPath);
    console.log(`${document.pdf} (${fs.statSync(pdfPath).size} bytes)`);
  }
  fs.rmSync(htmlDir, { recursive: true, force: true });
}

main();
