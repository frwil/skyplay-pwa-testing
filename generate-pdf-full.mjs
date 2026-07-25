import { readFileSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";

const md = readFileSync("D:/Skyplay/SKYPLAY-PROJECT-STATUS.md", "utf-8");

function escapeHTML(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function renderInline(s) {
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return s;
}

function renderMD(text) {
  const lines = text.split("\n");
  let out = "", inCode = false, inTable = false, inList = false;
  let codeContent = "", tableRows = [], listItems = [];

  function flushTable() {
    if (!tableRows.length) return;
    let h = "<table>\n<thead><tr>";
    for (const c of tableRows[0]) h += "<th>" + c.trim() + "</th>";
    h += "</tr></thead>\n<tbody>\n";
    for (let i = 1; i < tableRows.length; i++) {
      h += "<tr>";
      for (const c of tableRows[i]) h += "<td>" + c.trim() + "</td>";
      h += "</tr>\n";
    }
    h += "</tbody></table>\n";
    out += h; tableRows = [];
  }
  function flushList() {
    if (!listItems.length) return;
    out += "<ul>\n";
    for (const i of listItems) out += "<li>" + i + "</li>\n";
    out += "</ul>\n"; listItems = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    if (line.startsWith("```")) {
      if (inCode) {
        out += "<pre><code>" + escapeHTML(codeContent) + "</code></pre>\n";
        codeContent = ""; inCode = false;
      } else {
        flushTable(); flushList(); inCode = true;
      }
      continue;
    }
    if (inCode) { codeContent += (codeContent ? "\n" : "") + raw; continue; }

    if (line.startsWith("|") && line.endsWith("|")) {
      if (!inTable) { flushList(); inTable = true; }
      if (/^\|[\s\-:|]+\|$/.test(line)) continue;
      tableRows.push(line.slice(1, -1).split("|").map(c => renderInline(c)));
      continue;
    } else if (inTable) flushTable();

    if (line === "") { flushTable(); flushList(); out += "\n"; continue; }

    if (/^[-*]\s/.test(line)) { if (!inList) { flushTable(); inList = true; } listItems.push(renderInline(line.replace(/^[-*]\s+/, ""))); continue; }
    if (inList) { flushList(); }

    if (line.startsWith("#### ")) { flushTable(); out += "<h4>" + renderInline(line.slice(5)) + "</h4>\n"; continue; }
    if (line.startsWith("### ")) { flushTable(); out += "<h3>" + renderInline(line.slice(4)) + "</h3>\n"; continue; }
    if (line.startsWith("## ")) { flushTable(); out += "<h2>" + renderInline(line.slice(3)) + "</h2>\n"; continue; }
    if (line.startsWith("# ")) { flushTable(); out += "<h1>" + renderInline(line.slice(2)) + "</h1>\n"; continue; }
    if (line === "---" || line === "___") { out += "<hr>\n"; continue; }

    out += "<p>" + renderInline(line) + "</p>\n";
  }
  if (inCode) out += "<pre><code>" + escapeHTML(codeContent) + "</code></pre>\n";
  flushTable(); flushList();
  return out;
}

const htmlContent = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; max-width: 960px; margin: 0 auto; padding: 48px 32px; color: #1a1a2e; line-height: 1.7; background: #fafafa; }
  h1 { color: #1a1a2e; border-bottom: 4px solid #2563eb; padding-bottom: 12px; font-size: 2.2em; margin-top: 0; }
  h2 { color: #2563eb; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; margin-top: 40px; font-size: 1.5em; }
  h3 { color: #374151; margin-top: 28px; font-size: 1.15em; }
  h4 { color: #4b5563; margin-top: 20px; }
  p { margin: 8px 0; }
  code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 0.88em; color: #1e293b; }
  pre { background: #1e293b; color: #e2e8f0; padding: 16px 20px; border-radius: 8px; overflow-x: auto; font-size: 0.82em; line-height: 1.5; }
  pre code { background: none; padding: 0; color: inherit; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; font-size: 0.92em; }
  th, td { border: 1px solid #d1d5db; padding: 7px 12px; text-align: left; vertical-align: top; }
  th { background: #f0f4ff; font-weight: 600; color: #1e3a5f; }
  tr:nth-child(even) td { background: #f8fafc; }
  ul, ol { padding-left: 24px; margin: 8px 0; }
  li { margin: 3px 0; }
  hr { border: none; border-top: 2px solid #e2e8f0; margin: 32px 0; }
  strong { color: #1e3a5f; }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  blockquote { border-left: 4px solid #2563eb; margin: 16px 0; padding: 8px 20px; background: #f0f4ff; border-radius: 0 8px 8px 0; }
  .header { text-align: center; margin-bottom: 40px; }
  .header h1 { border: none; margin-bottom: 4px; }
  .header p { color: #6b7280; font-size: 0.95em; }
  .summary-grid { display: flex; gap: 12px; flex-wrap: wrap; margin: 16px 0; }
  .summary-box { flex: 1; min-width: 180px; padding: 16px; border-radius: 10px; border: 1px solid #e2e8f0; }
  .summary-box h3 { margin: 0 0 8px; font-size: 0.95em; }
  .summary-box .count { font-size: 2em; font-weight: 700; }
  .box-committed { background: #f0fdf4; border-color: #bbf7d0; } .box-committed .count { color: #16a34a; }
  .box-wip { background: #fffbeb; border-color: #fde68a; } .box-wip .count { color: #d97706; }
  .box-todo { background: #fef2f2; border-color: #fecaca; } .box-todo .count { color: #dc2626; }
  .box-docs { background: #f0f4ff; border-color: #bfdbfe; } .box-docs .count { color: #2563eb; }
</style>
</head>
<body>
<div class="header">
<h1>SKY PLAY — État d&rsquo;avancement complet</h1>
<p>2026-07-22 &middot; Branche <code>main</code> &middot; SFA2 complet + cleanup escrow + pick order KOF98 câblé</p>
</div>

<div class="summary-grid">
<div class="summary-box box-committed">
<h3>&#x2705; Commités</h3>
<div class="count">85+</div>
<div>commits depuis juin</div>
</div>
<div class="summary-box box-wip">
<h3>&#x1F527; En cours (WD)</h3>
<div class="count">~30</div>
<div>fichiers modifiés/nouveaux</div>
</div>
<div class="summary-box box-todo">
<h3>&#x274C; Reste à faire</h3>
<div class="count">~10</div>
<div>tâches identifiées</div>
</div>
<div class="summary-box box-docs">
<h3>&#x1F4C4; Docs</h3>
<div class="count">14</div>
<div>memory files + status</div>
</div>
</div>

${renderMD(md)}
</body>
</html>`;

writeFileSync("D:/Skyplay/SKYPLAY-PROJECT-STATUS.html", htmlContent);
console.log("HTML written.");

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const r = spawnSync(chrome, [
  "--headless", "--disable-gpu", "--no-sandbox",
  "--print-to-pdf=D:/Skyplay/SKYPLAY-PROJECT-STATUS.pdf",
  "file:///D:/Skyplay/SKYPLAY-PROJECT-STATUS.html",
], { timeout: 30000 });

if (r.error) { console.error("Chrome error:", r.error); process.exit(1); }
console.log("PDF generated.");
