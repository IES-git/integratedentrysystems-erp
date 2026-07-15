import { Workbook } from "@oai/artifact-tool";
const workbook = Workbook.create();
workbook.worksheets.add("Sheet1");
console.log(workbook.help("fx.XLOOKUP", { include: "index,examples,notes", maxChars: 2000 }).ndjson);
console.log(workbook.help("fx.MINIFS", { include: "index,examples,notes", maxChars: 2000 }).ndjson);
console.log(workbook.help("fx.AGGREGATE", { include: "index,examples,notes", maxChars: 2000 }).ndjson);
console.log(workbook.help("fx.FILTER", { include: "index,examples,notes", maxChars: 2000 }).ndjson);
