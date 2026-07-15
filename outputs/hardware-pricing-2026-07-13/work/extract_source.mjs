import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const root = "/Users/alfredreyes/Desktop/Development/IES/integratedentrysystems-erp/outputs/hardware-pricing-2026-07-13";
const input = await FileBlob.load(`${root}/source/Hardware pricing.xlsx`);
const workbook = await SpreadsheetFile.importXlsx(input);
const sheet = workbook.worksheets.getItem("Hardware Pricing table - Table");
const values = sheet.getRange("A1:K349").values;
const formulas = sheet.getRange("A1:K349").formulas;
await fs.writeFile(`${root}/work/source-values.json`, JSON.stringify({ values, formulas }, null, 2));
console.log(JSON.stringify({ rows: values.length, columns: Math.max(...values.map((row) => row.length)) }));
