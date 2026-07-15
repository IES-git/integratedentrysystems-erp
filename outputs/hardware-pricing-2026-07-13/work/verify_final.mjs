import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const path = "/Users/alfredreyes/Desktop/Development/IES/integratedentrysystems-erp/outputs/hardware-pricing-2026-07-13/Hardware Pricing - Optimized Database Import.xlsx";
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(path));
const overview = await workbook.inspect({ kind: "table", range: "Overview!A1:H28", include: "values,formulas", tableMaxRows: 28, tableMaxCols: 8, maxChars: 12000 });
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!", options: { useRegex: true, maxResults: 300 }, maxChars: 12000 });
const sheets = await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 6000 });
console.log(sheets.ndjson);
console.log(overview.ndjson);
console.log(errors.ndjson);
