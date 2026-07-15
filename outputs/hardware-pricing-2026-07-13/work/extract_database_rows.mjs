import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const root = "/Users/alfredreyes/Desktop/Development/IES/integratedentrysystems-erp/outputs/hardware-pricing-2026-07-13";
const inputPath = `${root}/Hardware Pricing - Optimized Database Import.xlsx`;
const outputPath = `${root}/work/hardware-database-rows.json`;

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const specsSheet = workbook.worksheets.getItem("Specs");
const vendorSheet = workbook.worksheets.getItem("Vendor Options");

const specs = specsSheet.getRange("A1:W164").values;
const vendorOptions = vendorSheet.getRange("A1:S284").values;

await fs.writeFile(outputPath, `${JSON.stringify({ specs, vendorOptions }, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, specs: specs.length - 1, vendorOptions: vendorOptions.length - 1 }));
