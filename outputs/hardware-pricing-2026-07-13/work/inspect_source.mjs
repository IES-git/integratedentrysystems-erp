import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const root = "/Users/alfredreyes/Desktop/Development/IES/integratedentrysystems-erp/outputs/hardware-pricing-2026-07-13";
const input = await FileBlob.load(`${root}/source/Hardware pricing.xlsx`);
const workbook = await SpreadsheetFile.importXlsx(input);

const summary = await workbook.inspect({
  kind: "workbook,sheet,table,region,drawing",
  maxChars: 20000,
  tableMaxRows: 12,
  tableMaxCols: 20,
  tableMaxCellChars: 120,
});
await fs.writeFile(`${root}/work/source-summary.ndjson`, summary.ndjson);
console.log(summary.ndjson);

const sheets = await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 10000 });
const names = [];
for (const line of sheets.ndjson.split("\n")) {
  if (!line.trim()) continue;
  try {
    const row = JSON.parse(line);
    if (row.name) names.push(row.name);
  } catch {}
}

for (const sheetName of names) {
  const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1.5, format: "png" });
  const safeName = sheetName.replace(/[^a-z0-9_-]+/gi, "_");
  await fs.writeFile(`${root}/preview/source-${safeName}.png`, new Uint8Array(await preview.arrayBuffer()));
}
console.log(JSON.stringify({ renderedSheets: names }));
