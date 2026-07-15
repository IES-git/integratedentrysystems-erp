import fs from "node:fs/promises";
import crypto from "node:crypto";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = "/Users/alfredreyes/Desktop/Development/IES/integratedentrysystems-erp/outputs/hardware-pricing-2026-07-13";
const source = JSON.parse(await fs.readFile(`${root}/work/source-values.json`, "utf8")).values;
const outputPath = `${root}/Hardware Pricing - Optimized Database Import.xlsx`;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const upper = (value) => clean(value).toUpperCase();
const idFor = (prefix, value) => `${prefix}-${crypto.createHash("sha1").update(value).digest("hex").slice(0, 12).toUpperCase()}`;
const numericPrice = (value) => {
  if (value === null || value === undefined || clean(value) === "") return null;
  const number = Number(clean(value).replace(/[$,]/g, ""));
  return Number.isFinite(number) ? number : null;
};
const discountParts = (value) => {
  const raw = clean(value);
  if (!raw) return { raw: "", first: null, second: null, recognized: true };
  if (/^\d+(?:\.\d+)?%$/.test(raw)) return { raw, first: Number(raw.slice(0, -1)) / 100, second: null, recognized: true };
  if (/^\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?$/.test(raw)) {
    const [a, b] = raw.split("/").map((x) => Number(x.trim()) / 100);
    return { raw, first: a, second: b, recognized: true };
  }
  const number = Number(raw);
  if (Number.isFinite(number)) return { raw, first: number > 1 ? number / 100 : number, second: null, recognized: true };
  return { raw, first: null, second: null, recognized: false };
};

function canonicalCategory(rawGroup) {
  const group = upper(rawGroup);
  if (group === "HINGES") return "HINGE";
  if (group === "CLOSER") return "CLOSER";
  if (group === "DEADBOLT" || group === "DBOLT") return "DEADBOLT";
  if (group === "CYLINDRICAL LOCK" || group === "MORTISE LOCK") return "LOCK";
  if (group === "MORTISE PANIC" || group === "RIM PANIC") return "EXIT DEVICE";
  if (group.includes("TRIM")) return "PANIC TRIM";
  return group;
}

function applicationFor(rawGroup, category) {
  const group = upper(rawGroup);
  if (group.includes("MORTISE") || /\bMP\b/.test(group)) return "MORTISE";
  if (group.includes("RIM") || /\bRP\b/.test(group)) return "RIM";
  if (category === "LOCK" && group === "CYLINDRICAL LOCK") return "CYLINDRICAL";
  if (category === "LOCK" && group === "MORTISE LOCK") return "MORTISE";
  return "";
}

function subtypeFor(row, category) {
  const family = upper(row.rawFamily);
  const group = upper(row.rawGroup);
  if (category === "HINGE") {
    if (family.includes("POWER TRSFR")) return "POWER TRANSFER HINGE";
    if (family.includes("CONTINUOS PIN")) return "CONTINUOUS PIN HINGE";
    if (family.includes("CONTINUOUS")) return "CONTINUOUS HINGE";
    if (family.includes("SPRING")) return "SPRING BUTT HINGE";
    if (family.includes("HEAVY")) return "HEAVY WEIGHT BUTT HINGE";
    if (family.includes("STANDARD")) return "STANDARD WEIGHT BUTT HINGE";
    if (family.includes("SPECIAL")) return "SPECIAL BUTT HINGE";
    if (family.includes("BUTT")) return "BUTT HINGE";
    return family;
  }
  if (category === "CLOSER") return "SURFACE CLOSER";
  if (category === "DEADBOLT") {
    if (family.includes("PULL PLATE")) return "PULL PLATE";
    if (upper(row.rawFunction).includes("CLASSROOM")) return "CLASSROOM DEADBOLT";
    if (upper(row.rawFunction).includes("SINGLE")) return "SINGLE CYLINDER DEADBOLT";
    return "DEADBOLT";
  }
  if (category === "LOCK") return group === "MORTISE LOCK" ? "MORTISE LOCK" : "CYLINDRICAL LOCK";
  if (category === "EXIT DEVICE") return "PANIC / EXIT DEVICE";
  if (category === "PANIC TRIM") {
    if (group.includes("LEVER")) return "LEVER ESCUTCHEON TRIM";
    if (group.includes("TP TRIM")) return "THUMBPIECE PULL TRIM";
    if (group.includes(" P TRIM") || family.includes("CYLINDER")) return "PULL TRIM WITH CYLINDER";
    if (family.includes("ESC")) return "ESCUTCHEON TRIM";
    return "PANIC DEVICE TRIM";
  }
  return family;
}

function canonicalFunction(row, category) {
  const text = upper(`${row.rawFunction} ${row.rawFamily}`);
  if (category === "HINGE") {
    if (/FULL\s+MORT/.test(text)) return "FULL MORTISE";
    if (/FULL\s+SURF/.test(text)) return "FULL SURFACE";
    if (/\bNRP\b/.test(text)) return "NON-REMOVABLE PIN";
    if (/WIRE|\d-\d{2}|\d\s*X\s*\d{2}/.test(text)) return "ELECTRIFIED POWER TRANSFER";
    return "";
  }
  if (/DORM|CORRIDOR|CORIDOR/.test(text)) return "DORMITORY / CORRIDOR";
  if (/STORAGE|STOREROOM|S_ROOM/.test(text)) return "STOREROOM";
  if (/CLASSROOM/.test(text)) return "CLASSROOM";
  if (/ENTRY|ENTRANCE/.test(text)) return "ENTRY";
  if (/SINGLE/.test(text) && category === "DEADBOLT") return "SINGLE CYLINDER";
  if (/KEY\s+RETRACTS\s+LATCH/.test(text)) return "KEY RETRACTS LATCH";
  if (/KEY\s+LOCKS[\s/]+UNLOCKS\s+LEVER\s+CLUTCH/.test(text)) return "KEY LOCKS / UNLOCKS LEVER - CLUTCH";
  if (/KEY\s+LOCKS[\s/]+UNLOCKS\s+LEVER/.test(text)) return "KEY LOCKS / UNLOCKS LEVER";
  if (/KEY\s+LOCKS\s+UNLOCKS\s+THUMB/.test(text)) return "KEY LOCKS / UNLOCKS THUMBPIECE";
  if (category === "CLOSER") return "DOOR CLOSER";
  if (category === "EXIT DEVICE") return "EXIT DEVICE";
  return upper(row.rawFunction);
}

function keyingFor(row, category) {
  const text = upper(`${row.rawGroup} ${row.rawFamily} ${row.rawSizeModel} ${row.rawFunction} ${row.rawPartNumber}`);
  if (/LFIC|\bICS\b/.test(text)) return "LFIC";
  if (/SFIC|\bICB\b/.test(text)) return "SFIC";
  if (category === "LOCK" || category === "DEADBOLT" || category === "PANIC TRIM") return "STANDARD";
  return "NOT APPLICABLE";
}

function sizeFor(row, category) {
  const primary = upper(`${row.rawSizeModel} ${row.rawFamily}`);
  const all = upper(`${row.rawSizeModel} ${row.rawFamily} ${row.rawPartNumber}`);
  let match = primary.match(/(4\.5|5(?:\.0)?)\s*[X*]\s*(4\.5|5(?:\.0)?)/);
  if (match) return `${Number(match[1]).toFixed(1)}\" x ${Number(match[2]).toFixed(1)}\"`;
  if (category === "HINGE") {
    if (/6\s*['’]?\s*8/.test(primary)) return "6'8\"";
    match = primary.match(/\b([78])\s*['’]\b/);
    if (match) return `${match[1]}'0\"`;
  }
  if (category === "EXIT DEVICE") {
    match = primary.match(/\b(33|36|42|48)\s*\"/);
    if (!match) match = all.match(/\b(33|36|42|48)\s*\"/);
    if (match) return `${match[1]}\"`;
  }
  if (category === "DEADBOLT") {
    match = primary.match(/2\.75\s*BS/);
    if (match) return "2.75\" BACKSET";
  }
  return "";
}

function dutyFor(row, category) {
  const text = upper(`${row.rawFunction} ${row.rawThicknessWt} ${row.rawSizeModel}`);
  if (category !== "CLOSER") return "";
  if (/INSTITUTION/.test(text)) return "INSTITUTIONAL";
  if (/MED[_\s-]*H?DUTY|\bSD\b/.test(text)) return "MEDIUM DUTY";
  if (/LIGHT|\bLT\b/.test(text)) return "LIGHT COMMERCIAL";
  if (/\bHD\b|HEAVY/.test(text)) return "HEAVY DUTY";
  return "";
}

function mountingArmFor(row, category) {
  const text = upper(`${row.rawFamily} ${row.rawSizeModel} ${row.rawFunction} ${row.rawThicknessWt}`);
  if (category === "HINGE") {
    if (/FULL\s+MORT/.test(text)) return "FULL MORTISE";
    if (/FULL\s+SURF/.test(text)) return "FULL SURFACE";
    return "";
  }
  if (category !== "CLOSER") return "";
  if (/SLIDE TRACK.*HOLD OPEN/.test(text)) return "SLIDE TRACK HOLD OPEN";
  if (/HO\s+SPRING\s+CUSH|SHCUSH/.test(text)) return "HOLD OPEN SPRING CUSHION";
  if (/HO[_\s-]*(CUSH|CUSHION)|HCUSH/.test(text)) return "HOLD OPEN CUSHION";
  if (/NO\s*HO\s*CUSH|NO\s*HOLD\s*CUSH|DOOR SAVER|\bDS\b/.test(text)) return "CUSHION STOP";
  if (/HO\s*ARM|HOLD OPEN|H-OPEN|\bDST\b/.test(text)) return "HOLD OPEN ARM";
  if (/STD\s*ARM|REG\s*ARM|STANDARD ARM|REGULAR ARM|TRIPAC/.test(text)) return "REGULAR ARM";
  return "";
}

function ratingFor(row, category) {
  if (category !== "EXIT DEVICE") return "";
  const text = upper(`${row.rawFamily} ${row.rawSizeModel} ${row.rawFunction}`);
  const fire = /FIRE|F\+W|: F\b/.test(text);
  const wind = /WIND|F\+W|: W\b/.test(text);
  const tdi = /\bTDI\b/.test(text);
  if (fire && wind) return "FIRE + WIND";
  if (fire) return "FIRE";
  if (wind) return "WIND";
  if (tdi) return "TDI";
  if (/PANIC|\bNR\b/.test(text)) return "PANIC";
  return "";
}

function electricalFor(row) {
  const text = upper(`${row.rawFamily} ${row.rawSizeModel} ${row.rawFunction} ${row.rawPartNumber}`);
  if (/FAIL\s+SECURE|\bEU\b/.test(text)) return "FAIL SECURE";
  if (/FAIL\s+SAFE|\bEL\b/.test(text)) return "FAIL SAFE";
  if (/MLR|MORTORIZED LATCH RETRACTION|MOTORIZED LATCH RETRACTION/.test(text)) return "MOTORIZED LATCH RETRACTION";
  if (/EL[_\s-]*(DOG|DOGGED|DOGGING)|BASE EL LOCK/.test(text)) return "ELECTRIC DOGGING";
  if (/LATCH BOLT MONITOR/.test(text)) return "LATCH BOLT MONITOR";
  return "";
}

function materialFinish(row) {
  const raw = upper(row.rawMaterialFinish);
  if (/^304\s*SS$/.test(raw)) return { material: "304 STAINLESS STEEL", finish: "" };
  if (/^316\s*SS$/.test(raw)) return { material: "316 STAINLESS STEEL", finish: "" };
  if (/CAST BODY|CST BODY/.test(raw)) return { material: "CAST BODY", finish: "" };
  if (/AL BODY/.test(raw)) return { material: "ALUMINUM BODY", finish: "" };
  if (/CLEAR AN/.test(raw)) return { material: "", finish: "CLEAR ANODIZED" };
  if (/AL SPRAY/.test(raw)) return { material: "", finish: "ALUMINUM SPRAY" };
  if (/^\d{3}$/.test(raw)) return { material: "", finish: raw };
  if (raw === "ACC") return { material: "", finish: "" };
  return { material: raw, finish: "" };
}

function thicknessFor(row) {
  const value = upper(row.rawThicknessWt);
  if (!value || value === "-") return "";
  if (/GRADE/.test(value)) return "";
  return value.replace(/^\./, "0.");
}

function otherRequirements(row, category) {
  const text = upper(`${row.rawFamily} ${row.rawFunction} ${row.rawMaterialFinish}`);
  const requirements = [];
  if (/\bNRP\b/.test(text)) requirements.push("NON-REMOVABLE PIN");
  if (/NFHD/.test(text)) requirements.push("NFHD");
  if (/ADDER|\bACC\b/.test(text)) requirements.push("ACCESSORY / ADDER");
  if (category === "HINGE") {
    const wire = text.match(/(?:\b(\d)[-\s]?(\d{2})\b|\b(\d)\s*WIRE\b)/);
    if (wire) requirements.push(wire[3] ? `${wire[3]} WIRE` : `${wire[1]} x ${wire[2]} GA WIRE`);
  }
  return [...new Set(requirements)].join("; ");
}

function extractPartNumber(rawValue) {
  const raw = clean(rawValue);
  if (!raw) return "";
  if (/\*{3,}/.test(raw)) return raw;
  if (/^9K-/i.test(raw)) return raw;
  const numbered = raw.match(/^([A-Z0-9-]{4,})\s+-\s+/i);
  if (numbered) return numbered[1];
  if (/^[A-Z0-9*_.:-]+$/i.test(raw)) return raw;
  const first = raw.split(/\s+/)[0];
  return first || raw;
}

function vendorFunctionCode(row, category) {
  if (category !== "LOCK" && category !== "DEADBOLT") return "";
  const value = upper(row.rawSizeModel).replace(/-(SFIC|LFIC)$/, "");
  return /^(?:F\d+(?:-\d+)?|E\d+|T|D|R|AB)$/.test(value) ? value : "";
}

function matchConfidence(record) {
  let required = [];
  if (record.category === "HINGE") required = [record.subtype, record.size, record.function || record.otherRequirements];
  else if (record.category === "CLOSER") required = [record.dutyGrade || record.mountingArm, record.mountingArm || record.vendorModel];
  else if (record.category === "LOCK") required = [record.application, record.function, record.keying, record.finish];
  else if (record.category === "DEADBOLT") required = [record.function || record.subtype, record.keying, record.finish];
  else if (record.category === "EXIT DEVICE") required = [record.application, record.rating || record.electrical || record.otherRequirements, record.finish];
  else if (record.category === "PANIC TRIM") required = [record.application, record.subtype, record.function, record.finish];
  else required = [record.category, record.subtype || record.function];
  const present = required.filter(Boolean).length;
  if (present === required.length) return "HIGH";
  if (present >= Math.max(2, required.length - 1)) return "MEDIUM";
  return "REVIEW";
}

function specKeyFor(record) {
  let parts;
  if (record.category === "HINGE") parts = [record.category, record.subtype, record.size, record.mountingArm, record.function, record.thicknessWeight, record.material, record.finish, record.otherRequirements];
  else if (record.category === "CLOSER") parts = [record.category, record.subtype, record.dutyGrade, record.mountingArm, record.finish, record.otherRequirements];
  else if (record.category === "LOCK") parts = [record.category, record.subtype, record.application, record.function, record.keying, record.finish, record.electrical, record.size];
  else if (record.category === "DEADBOLT") parts = [record.category, record.subtype, record.function, record.keying, record.size, record.finish];
  else if (record.category === "EXIT DEVICE") parts = [record.category, record.application, record.size, record.rating, record.finish, record.electrical, record.otherRequirements];
  else if (record.category === "PANIC TRIM") parts = [record.category, record.application, record.subtype, record.function, record.keying, record.finish];
  else parts = [record.category, record.subtype, record.application, record.function, record.size, record.finish];
  if (record.matchConfidence === "REVIEW") parts.push(`SOURCE:${record.sourceRow}`);
  return parts.map((x) => upper(x) || "-").join("|");
}

const sourceRows = source.slice(2).map((values, index) => ({
  sourceRow: index + 3,
  values,
  rawGroup: clean(values[0]),
  rawFamily: clean(values[1]),
  rawVendor: clean(values[2]),
  rawSizeModel: clean(values[3]),
  rawFunction: clean(values[4]),
  rawThicknessWt: clean(values[5]),
  rawMaterialFinish: clean(values[6]),
  rawPartNumber: clean(values[7]),
  rawCustomerPartNumber: clean(values[8]),
  rawListPrice: values[9],
  rawDiscount: values[10],
})).filter((row) => row.values.some((value) => clean(value)) && upper(row.rawGroup) !== "LESS USED WILL BUILD OUT");

const firstBySignature = new Map();
const duplicates = [];
const activeSourceRows = [];
for (const row of sourceRows) {
  const signature = row.values.map(clean).join("\u241F");
  if (firstBySignature.has(signature)) duplicates.push({ row, duplicateOf: firstBySignature.get(signature) });
  else {
    firstBySignature.set(signature, row.sourceRow);
    activeSourceRows.push(row);
  }
}

const records = activeSourceRows.map((row) => {
  const category = canonicalCategory(row.rawGroup);
  const application = applicationFor(row.rawGroup, category);
  const materialFinishValue = materialFinish(row);
  const discount = discountParts(row.rawDiscount);
  const record = {
    ...row,
    category,
    subtype: subtypeFor(row, category),
    application,
    function: canonicalFunction(row, category),
    keying: keyingFor(row, category),
    size: sizeFor(row, category),
    rating: ratingFor(row, category),
    dutyGrade: dutyFor(row, category),
    mountingArm: mountingArmFor(row, category),
    thicknessWeight: thicknessFor(row),
    material: materialFinishValue.material,
    finish: materialFinishValue.finish,
    electrical: electricalFor(row),
    otherRequirements: otherRequirements(row, category),
    vendor: upper(row.rawVendor),
    vendorSeries: upper(row.rawFamily),
    vendorModel: upper(row.rawSizeModel),
    vendorFunctionCode: vendorFunctionCode(row, category),
    manufacturerPartNumber: extractPartNumber(row.rawPartNumber),
    productDescription: clean(row.rawPartNumber),
    customerPartNumber: clean(row.rawCustomerPartNumber),
    listPrice: numericPrice(row.rawListPrice),
    discountRaw: discount.raw,
    discount1: discount.first,
    discount2: discount.second,
    discountRecognized: discount.recognized,
    currency: "USD",
    qaFlags: [],
  };
  record.matchConfidence = matchConfidence(record);
  record.specKey = specKeyFor(record);
  record.specId = idFor("SPEC", record.specKey);
  record.offerId = idFor("OFFER", [record.specId, record.vendor, record.manufacturerPartNumber, record.vendorModel, record.finish, record.listPrice ?? "", row.values.map(clean).join("|")].join("|"));
  return record;
});

const byPart = new Map();
for (const record of records) {
  const part = upper(record.manufacturerPartNumber);
  if (!part || /\*{3,}/.test(part)) continue;
  if (!byPart.has(part)) byPart.set(part, []);
  byPart.get(part).push(record);
}

for (const record of records) {
  if (!record.vendor || record.vendor === "***") record.qaFlags.push("MISSING_VENDOR");
  if (record.listPrice === null) record.qaFlags.push("MISSING_PRICE");
  if (!record.manufacturerPartNumber) record.qaFlags.push("MISSING_PART_NUMBER");
  if (/\*{3,}/.test(record.manufacturerPartNumber)) record.qaFlags.push("PLACEHOLDER_PART_NUMBER");
  if (!record.discountRecognized) record.qaFlags.push("UNRECOGNIZED_DISCOUNT");
  if (record.matchConfidence === "REVIEW") record.qaFlags.push("MISSING_REQUIRED_SPEC");
  if (upper(record.rawGroup) === "DBOLT") record.qaFlags.push("CATEGORY_ALIAS_NORMALIZED");
  const partGroup = byPart.get(upper(record.manufacturerPartNumber)) || [];
  if (partGroup.length > 1) {
    const specs = new Set(partGroup.map((x) => x.specId));
    const prices = new Set(partGroup.map((x) => x.listPrice).filter((x) => x !== null));
    if (specs.size > 1 || prices.size > 1) record.qaFlags.push("PART_NUMBER_CONFLICT");
  }
  if (record.category === "EXIT DEVICE") {
    const specWidth = upper(`${record.rawFamily} ${record.rawSizeModel}`).match(/\b(33|36|42|48)\s*\"/);
    const partWidth = upper(record.rawPartNumber).match(/\b(33|36|42|48)\s*\"/);
    if (specWidth && partWidth && specWidth[1] !== partWidth[1]) record.qaFlags.push("SIZE_PART_MISMATCH");
  }
}

const priceGroups = new Map();
for (const record of records) {
  if (record.listPrice === null || !["LOCK", "DEADBOLT"].includes(record.category)) continue;
  const key = `${record.vendor}|${record.category}|${record.subtype}`;
  if (!priceGroups.has(key)) priceGroups.set(key, []);
  priceGroups.get(key).push(record);
}
for (const group of priceGroups.values()) {
  if (group.length < 6) continue;
  const prices = group.map((x) => x.listPrice).sort((a, b) => a - b);
  const median = prices.length % 2 ? prices[(prices.length - 1) / 2] : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2;
  for (const record of group) {
    if (record.listPrice < median * 0.35 || record.listPrice > median * 2.8) record.qaFlags.push("POSSIBLE_PRICE_OUTLIER");
  }
}

records.sort((a, b) => [a.category, a.subtype, a.application, a.function, a.keying, a.size, a.rating, a.finish, a.vendor, a.vendorSeries, a.sourceRow].join("|").localeCompare([b.category, b.subtype, b.application, b.function, b.keying, b.size, b.rating, b.finish, b.vendor, b.vendorSeries, b.sourceRow].join("|")));

const specMap = new Map();
for (const record of records) {
  if (!specMap.has(record.specId)) specMap.set(record.specId, {
    specId: record.specId,
    category: record.category,
    subtype: record.subtype,
    application: record.application,
    function: record.function,
    keying: record.keying,
    size: record.size,
    rating: record.rating,
    dutyGrade: record.dutyGrade,
    mountingArm: record.mountingArm,
    thicknessWeight: record.thicknessWeight,
    material: record.material,
    finish: record.finish,
    electrical: record.electrical,
    otherRequirements: record.otherRequirements,
    matchConfidence: record.matchConfidence,
  });
}
const specs = [...specMap.values()].sort((a, b) => [a.category, a.subtype, a.application, a.function, a.keying, a.size, a.rating, a.finish, a.specId].join("|").localeCompare([b.category, b.subtype, b.application, b.function, b.keying, b.size, b.rating, b.finish, b.specId].join("|")));

const recordBySourceRow = new Map(records.map((record) => [record.sourceRow, record]));
const duplicateBySourceRow = new Map(duplicates.map((item) => [item.row.sourceRow, item.duplicateOf]));
for (const item of duplicates) {
  const original = recordBySourceRow.get(item.duplicateOf);
  if (original) recordBySourceRow.set(item.row.sourceRow, original);
}

const reviewRows = [];
const recommendations = {
  MISSING_VENDOR: "Assign a valid manufacturer/vendor code before publishing this offer.",
  MISSING_PRICE: "Add a current vendor list price and effective date; keep staged until priced.",
  MISSING_PART_NUMBER: "Add an orderable manufacturer part/configuration number.",
  PLACEHOLDER_PART_NUMBER: "Replace the asterisk placeholder with a confirmed part number.",
  UNRECOGNIZED_DISCOUNT: "Convert the discount to decimal fields discount_1 and discount_2.",
  MISSING_REQUIRED_SPEC: "Complete the required spec dimensions before allowing automated matching.",
  PART_NUMBER_CONFLICT: "Confirm whether the same part number legitimately maps to multiple specs/prices.",
  SIZE_PART_MISMATCH: "Verify device width against the part-number description.",
  POSSIBLE_PRICE_OUTLIER: "Verify list price; it is materially outside its comparable vendor/product group.",
  CATEGORY_ALIAS_NORMALIZED: "No action required; DBOLT was normalized to DEADBOLT.",
  EXACT_DUPLICATE_EXCLUDED: "Do not ingest this row; the first identical source row is retained.",
};
const severityFor = (flag) => ["MISSING_VENDOR", "PART_NUMBER_CONFLICT", "SIZE_PART_MISMATCH", "POSSIBLE_PRICE_OUTLIER", "EXACT_DUPLICATE_EXCLUDED"].includes(flag) ? "ERROR" : flag === "CATEGORY_ALIAS_NORMALIZED" ? "INFO" : "WARNING";
for (const record of records) {
  for (const flag of record.qaFlags) {
    reviewRows.push([severityFor(flag), flag, record.offerId, record.specId, record.sourceRow, `${record.category} | ${record.subtype || "Unspecified"} | ${record.vendor || "No vendor"} | ${record.manufacturerPartNumber || "No part number"}`, recommendations[flag]]);
  }
}
for (const item of duplicates) {
  const record = recordBySourceRow.get(item.row.sourceRow);
  reviewRows.push(["ERROR", "EXACT_DUPLICATE_EXCLUDED", record?.offerId || "", record?.specId || "", item.row.sourceRow, `Exact duplicate of source row ${item.duplicateOf}`, recommendations.EXACT_DUPLICATE_EXCLUDED]);
}
reviewRows.sort((a, b) => ({ ERROR: 0, WARNING: 1, INFO: 2 }[a[0]] - { ERROR: 0, WARNING: 1, INFO: 2 }[b[0]]) || a[1].localeCompare(b[1]) || a[4] - b[4]);

const manufacturerCounts = new Map();
for (const record of records) {
  if (!manufacturerCounts.has(record.specId)) manufacturerCounts.set(record.specId, new Set());
  if (record.vendor) manufacturerCounts.get(record.specId).add(record.vendor);
}
const pricedCount = records.filter((record) => record.listPrice !== null).length;
const activePriceCoverage = records.length ? pricedCount / records.length : 0;
const multiVendorSpecs = [...manufacturerCounts.values()].filter((set) => set.size > 1).length;

const workbook = Workbook.create();
const overview = workbook.worksheets.add("Overview");
const specsSheet = workbook.worksheets.add("Specs");
const vendorSheet = workbook.worksheets.add("Vendor Options");
const flatSheet = workbook.worksheets.add("Import Flat");
const reviewSheet = workbook.worksheets.add("Review Queue");
const crosswalkSheet = workbook.worksheets.add("Source Crosswalk");
const dictionarySheet = workbook.worksheets.add("Data Dictionary");
const aliasesSheet = workbook.worksheets.add("Aliases");
for (const sheet of [overview, specsSheet, vendorSheet, flatSheet, reviewSheet, crosswalkSheet, dictionarySheet, aliasesSheet]) sheet.showGridLines = false;

const navy = "#17365D";
const teal = "#0F6B78";
const blue = "#DCE6F1";
const pale = "#F3F6F9";
const green = "#E2F0D9";
const amber = "#FFF2CC";
const red = "#F4CCCC";
const gray = "#667085";
const white = "#FFFFFF";
const headerFormat = { fill: navy, font: { bold: true, color: white }, verticalAlignment: "center", wrapText: true, borders: { bottom: { style: "medium", color: "#9FBAD0" } } };
const bodyBorder = { bottom: { style: "thin", color: "#D9E2F3" } };

function addTable(sheet, range, name) {
  const table = sheet.tables.add(range, true, name);
  table.style = "TableStyleMedium2";
  table.showBandedRows = true;
  table.showFilterButton = true;
  return table;
}

overview.getRange("A1:H1").merge();
overview.getRange("A1").values = [["Hardware Pricing — Optimized Spec-First Model"]];
overview.getRange("A1:H1").format = { fill: navy, font: { bold: true, color: white, size: 18 }, rowHeight: 34, verticalAlignment: "center" };
overview.getRange("A2:H2").merge();
overview.getRange("A2").values = [["The estimate builder selects the required specification first, then returns every matching manufacturer/vendor option for final price selection."]];
overview.getRange("A2:H2").format = { fill: blue, font: { color: navy, italic: true }, rowHeight: 28, verticalAlignment: "center", wrapText: true };
overview.getRange("A4:H4").values = [["UNIQUE VENDOR OPTIONS", "", "DISTINCT SPECS", "", "PRICED OPTIONS", "", "UNPRICED OPTIONS", ""]];
overview.getRange("A4:H4").format = { fill: teal, font: { bold: true, color: white }, horizontalAlignment: "center" };
for (const range of ["A5:B6", "C5:D6", "E5:F6", "G5:H6"]) overview.getRange(range).merge();
overview.getRange("A5").formulas = [[`=COUNTA('Vendor Options'!$A$2:$A$${records.length + 1})`]];
overview.getRange("C5").formulas = [[`=COUNTA('Specs'!$A$2:$A$${specs.length + 1})`]];
overview.getRange("E5").formulas = [[`=COUNTIF('Vendor Options'!$P$2:$P$${records.length + 1},"PRICED")`]];
overview.getRange("G5").formulas = [[`=COUNTIF('Vendor Options'!$P$2:$P$${records.length + 1},"UNPRICED")`]];
overview.getRange("A5:H6").format = { fill: pale, font: { bold: true, color: navy, size: 18 }, horizontalAlignment: "center", verticalAlignment: "center", borders: { preset: "outside", style: "thin", color: "#A9BCD0" } };
overview.getRange("A8:H8").values = [["DUPLICATE ROWS REMOVED", "", "MULTI-VENDOR SPECS", "", "OPTIONS REQUIRING REVIEW", "", "QA ISSUE RECORDS", ""]];
overview.getRange("A8:H8").format = { fill: teal, font: { bold: true, color: white }, horizontalAlignment: "center" };
for (const range of ["A9:B10", "C9:D10", "E9:F10", "G9:H10"]) overview.getRange(range).merge();
overview.getRange("A9").values = [[duplicates.length]];
overview.getRange("C9").formulas = [[`=COUNTIF('Specs'!$R$2:$R$${specs.length + 1},">1")`]];
overview.getRange("E9").formulas = [[`=COUNTIF('Vendor Options'!$Q$2:$Q$${records.length + 1},"REVIEW")`]];
overview.getRange("G9").formulas = [[`=COUNTA('Review Queue'!$A$2:$A$${reviewRows.length + 1})`]];
overview.getRange("A9:H10").format = { fill: pale, font: { bold: true, color: navy, size: 18 }, horizontalAlignment: "center", verticalAlignment: "center", borders: { preset: "outside", style: "thin", color: "#A9BCD0" } };

overview.getRange("A12:H12").merge();
overview.getRange("A12").values = [["Estimate Builder Selection Flow"]];
overview.getRange("A12:H12").format = headerFormat;
const flow = [
  ["1. CATEGORY\nHinge, closer, lock, exit device, trim", "2. REQUIRED SPEC\nFunction, size, rating, finish, keying, duty", "3. MATCHING OPTIONS\nQuery Vendor Options by spec_id", "4. FINAL SELECTION\nUser selects manufacturer/product and price"],
];
overview.getRange("A13:B15").merge(); overview.getRange("A13").values = [[flow[0][0]]];
overview.getRange("C13:D15").merge(); overview.getRange("C13").values = [[flow[0][1]]];
overview.getRange("E13:F15").merge(); overview.getRange("E13").values = [[flow[0][2]]];
overview.getRange("G13:H15").merge(); overview.getRange("G13").values = [[flow[0][3]]];
overview.getRange("A13:H15").format = { fill: blue, font: { bold: true, color: navy }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true, borders: { preset: "all", style: "thin", color: "#A9BCD0" } };

overview.getRange("A17:H17").merge(); overview.getRange("A17").values = [["Analysis Findings"]]; overview.getRange("A17:H17").format = headerFormat;
const findings = [
  ["Source cleanup", `${sourceRows.length} populated product rows were identified; ${duplicates.length} exact duplicate rows were excluded from the active import.`],
  ["Price completeness", `${pricedCount} of ${records.length} unique vendor options (${(activePriceCoverage * 100).toFixed(1)}%) have a list price. Unpriced rows remain staged and traceable.`],
  ["Spec-first matching", `${multiVendorSpecs} canonical specs currently return options from more than one vendor. Vendor series/model/part fields are excluded from the spec key.`],
  ["Discount handling", "Decimal discounts and chained discounts such as 50/70 are split into discount_1 and discount_2; net price is formula-driven."],
  ["High-risk source issues", "The review queue flags missing vendors/parts/prices, conflicting reuse of part numbers, a 48-inch/36-inch part-description mismatch, and possible pricing outliers."],
];
overview.getRange(`A18:B${17 + findings.length}`).values = findings;
overview.getRange(`A18:A${17 + findings.length}`).format = { fill: blue, font: { bold: true, color: navy }, wrapText: true, borders: bodyBorder };
overview.getRange(`B18:H${17 + findings.length}`).merge(true);
overview.getRange(`B18:H${17 + findings.length}`).format = { wrapText: true, verticalAlignment: "top", borders: bodyBorder };

const ingestionStart = 19 + findings.length;
overview.getRange(`A${ingestionStart}:H${ingestionStart}`).merge(); overview.getRange(`A${ingestionStart}`).values = [["Recommended Database Ingestion"]]; overview.getRange(`A${ingestionStart}:H${ingestionStart}`).format = headerFormat;
const ingestion = [
  ["1", "Load Specs", "Use spec_id as the stable primary key for the user's specification selections."],
  ["2", "Load Vendor Options", "Use offer_id as the primary key and spec_id as the foreign key. Publish only data_status = ACTIVE; keep REVIEW rows in staging."],
  ["3", "Estimate query", "Filter Specs by selections, then return Vendor Options for the chosen spec_id. Sort final options by net_price, vendor, and series."],
  ["4", "Price maintenance", "Add price_effective_date and source_document/version in production. Never overwrite price history; close the prior record and insert a new one."],
];
overview.getRange(`A${ingestionStart + 1}:H${ingestionStart + ingestion.length}`).values = ingestion.map((row) => [row[0], row[1], row[2], "", "", "", "", ""]);
overview.getRange(`C${ingestionStart + 1}:H${ingestionStart + ingestion.length}`).merge(true);
overview.getRange(`A${ingestionStart + 1}:H${ingestionStart + ingestion.length}`).format = { wrapText: true, verticalAlignment: "top", borders: bodyBorder };
overview.getRange(`A${ingestionStart + 1}:A${ingestionStart + ingestion.length}`).format.fill = blue;
overview.getRange(`B${ingestionStart + 1}:B${ingestionStart + ingestion.length}`).format.font = { bold: true, color: navy };
overview.getRange("A:H").format.columnWidth = 15;
overview.getRange("B:B").format.columnWidth = 22;
overview.getRange("A:H").format.autofitRows();
overview.freezePanes.freezeRows(2);

const specHeaders = ["Spec_ID", "Product_Category", "Product_Subtype", "Application", "Function", "Keying", "Size", "Rating", "Duty_Grade", "Mounting_Arm", "Thickness_Weight", "Material", "Finish", "Electrical", "Other_Requirements", "Match_Confidence", "Vendor_Option_Count", "Manufacturer_Count", "Priced_Option_Count", "Active_Option_Count", "Min_Net_Price", "Max_Net_Price", "Spec_Status"];
specsSheet.getRange(`A1:W${specs.length + 1}`).values = [specHeaders, ...specs.map((spec) => [spec.specId, spec.category, spec.subtype, spec.application, spec.function, spec.keying, spec.size, spec.rating, spec.dutyGrade, spec.mountingArm, spec.thicknessWeight, spec.material, spec.finish, spec.electrical, spec.otherRequirements, spec.matchConfidence, null, null, null, null, null, null, null])];
const vendorEnd = records.length + 1;
const specsEnd = specs.length + 1;
if (specs.length) {
  specsSheet.getRange("Q2").formulas = [[`=COUNTIF('Vendor Options'!$B$2:$B$${vendorEnd},A2)`]];
  specsSheet.getRange(`Q2:Q${specsEnd}`).fillDown();
  specsSheet.getRange("R2").formulas = [[`=COUNTA(UNIQUE(FILTER('Vendor Options'!$C$2:$C$${vendorEnd},'Vendor Options'!$B$2:$B$${vendorEnd}=A2)))`]];
  specsSheet.getRange(`R2:R${specsEnd}`).fillDown();
  specsSheet.getRange("S2").formulas = [[`=COUNTIFS('Vendor Options'!$B$2:$B$${vendorEnd},A2,'Vendor Options'!$P$2:$P$${vendorEnd},"PRICED")`]];
  specsSheet.getRange(`S2:S${specsEnd}`).fillDown();
  specsSheet.getRange("T2").formulas = [[`=COUNTIFS('Vendor Options'!$B$2:$B$${vendorEnd},A2,'Vendor Options'!$Q$2:$Q$${vendorEnd},"ACTIVE")`]];
  specsSheet.getRange(`T2:T${specsEnd}`).fillDown();
  specsSheet.getRange("U2").formulas = [[`=IF(S2=0,"",MIN(FILTER('Vendor Options'!$N$2:$N$${vendorEnd},('Vendor Options'!$B$2:$B$${vendorEnd}=A2)*('Vendor Options'!$P$2:$P$${vendorEnd}="PRICED"))))`]];
  specsSheet.getRange(`U2:U${specsEnd}`).fillDown();
  specsSheet.getRange("V2").formulas = [[`=IF(S2=0,"",MAXIFS('Vendor Options'!$N$2:$N$${vendorEnd},'Vendor Options'!$B$2:$B$${vendorEnd},A2,'Vendor Options'!$P$2:$P$${vendorEnd},"PRICED"))`]];
  specsSheet.getRange(`V2:V${specsEnd}`).fillDown();
  specsSheet.getRange("W2").formulas = [[`=IF(P2="REVIEW","REVIEW",IF(T2=0,"REVIEW",IF(S2=0,"NEEDS PRICE","READY")))`]];
  specsSheet.getRange(`W2:W${specsEnd}`).fillDown();
}
addTable(specsSheet, `A1:W${specsEnd}`, "HardwareSpecs");
specsSheet.getRange("A1:W1").format = headerFormat;
specsSheet.getRange(`Q2:T${specsEnd}`).format.numberFormat = "0";
specsSheet.getRange(`U2:V${specsEnd}`).format.numberFormat = "$#,##0.00";
specsSheet.getRange(`A2:W${specsEnd}`).format.borders = bodyBorder;
specsSheet.getRange(`P2:P${specsEnd}`).conditionalFormats.add("containsText", { text: "REVIEW", format: { fill: amber, font: { color: "#7F6000", bold: true } } });
specsSheet.getRange(`W2:W${specsEnd}`).conditionalFormats.add("containsText", { text: "READY", format: { fill: green, font: { color: "#375623", bold: true } } });
specsSheet.getRange(`W2:W${specsEnd}`).conditionalFormats.add("containsText", { text: "REVIEW", format: { fill: red, font: { color: "#9C0006", bold: true } } });
specsSheet.freezePanes.freezeRows(1); specsSheet.freezePanes.freezeColumns(2);

const vendorHeaders = ["Offer_ID", "Spec_ID", "Manufacturer_Vendor", "Vendor_Series", "Vendor_Model", "Vendor_Function_Code", "Manufacturer_Part_Number", "Product_Description_Raw", "Customer_Part_Number", "List_Price", "Discount_Raw", "Discount_1", "Discount_2", "Net_Price", "Currency", "Price_Status", "Data_Status", "QA_Flags", "Source_Row"];
vendorSheet.getRange(`A1:S${vendorEnd}`).values = [vendorHeaders, ...records.map((record) => [record.offerId, record.specId, record.vendor, record.vendorSeries, record.vendorModel, record.vendorFunctionCode, record.manufacturerPartNumber, record.productDescription, record.customerPartNumber, record.listPrice, record.discountRaw, record.discount1, record.discount2, null, record.currency, null, null, record.qaFlags.join("; "), record.sourceRow])];
if (records.length) {
  vendorSheet.getRange("N2").formulas = [["=IF(J2=\"\",\"\",J2*(1-IF(L2=\"\",0,L2))*(1-IF(M2=\"\",0,M2)))"]];
  vendorSheet.getRange(`N2:N${vendorEnd}`).fillDown();
  vendorSheet.getRange("P2").formulas = [["=IF(J2=\"\",\"UNPRICED\",\"PRICED\")"]];
  vendorSheet.getRange(`P2:P${vendorEnd}`).fillDown();
  vendorSheet.getRange("Q2").formulas = [["=IF(OR(ISNUMBER(SEARCH(\"MISSING_VENDOR\",R2)),ISNUMBER(SEARCH(\"MISSING_PART_NUMBER\",R2)),ISNUMBER(SEARCH(\"PLACEHOLDER_PART_NUMBER\",R2)),ISNUMBER(SEARCH(\"MISSING_REQUIRED_SPEC\",R2)),ISNUMBER(SEARCH(\"PART_NUMBER_CONFLICT\",R2)),ISNUMBER(SEARCH(\"SIZE_PART_MISMATCH\",R2)),ISNUMBER(SEARCH(\"POSSIBLE_PRICE_OUTLIER\",R2))),\"REVIEW\",\"ACTIVE\")"]];
  vendorSheet.getRange(`Q2:Q${vendorEnd}`).fillDown();
}
addTable(vendorSheet, `A1:S${vendorEnd}`, "HardwareVendorOptions");
vendorSheet.getRange("A1:S1").format = headerFormat;
vendorSheet.getRange(`J2:J${vendorEnd}`).format.numberFormat = "$#,##0.00";
vendorSheet.getRange(`L2:M${vendorEnd}`).format.numberFormat = "0.0%";
vendorSheet.getRange(`N2:N${vendorEnd}`).format.numberFormat = "$#,##0.00";
vendorSheet.getRange(`P2:Q${vendorEnd}`).conditionalFormats.add("containsText", { text: "REVIEW", format: { fill: red, font: { color: "#9C0006", bold: true } } });
vendorSheet.getRange(`P2:P${vendorEnd}`).conditionalFormats.add("containsText", { text: "UNPRICED", format: { fill: amber, font: { color: "#7F6000" } } });
vendorSheet.freezePanes.freezeRows(1); vendorSheet.freezePanes.freezeColumns(2);

const flatHeaders = ["Spec_ID", "Product_Category", "Product_Subtype", "Application", "Function", "Keying", "Size", "Rating", "Duty_Grade", "Mounting_Arm", "Thickness_Weight", "Material", "Finish", "Electrical", "Other_Requirements", "Match_Confidence", "Vendor_Option_Count", "Manufacturer_Count", "Offer_ID", "Manufacturer_Vendor", "Vendor_Series", "Vendor_Model", "Vendor_Function_Code", "Manufacturer_Part_Number", "Product_Description_Raw", "Customer_Part_Number", "List_Price", "Discount_Raw", "Discount_1", "Discount_2", "Net_Price", "Currency", "Price_Status", "Data_Status", "QA_Flags", "Source_Row"];
flatSheet.getRange(`A1:AJ${vendorEnd}`).values = [flatHeaders, ...records.map(() => Array(flatHeaders.length).fill(null))];
if (records.length) {
  flatSheet.getRange("A2").formulas = [["='Vendor Options'!B2"]]; flatSheet.getRange(`A2:A${vendorEnd}`).fillDown();
  const specColumnLetters = ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R"];
  for (let index = 0; index < specColumnLetters.length; index++) {
    const letter = specColumnLetters[index];
    const specReturnColumn = String.fromCharCode("B".charCodeAt(0) + index);
    flatSheet.getRange(`${letter}2`).formulas = [[`=XLOOKUP($A2,'Specs'!$A$2:$A$${specsEnd},'Specs'!$${specReturnColumn}$2:$${specReturnColumn}$${specsEnd},"")`]];
    flatSheet.getRange(`${letter}2:${letter}${vendorEnd}`).fillDown();
  }
  const vendorMap = { S: "A", T: "C", U: "D", V: "E", W: "F", X: "G", Y: "H", Z: "I", AA: "J", AB: "K", AC: "L", AD: "M", AE: "N", AF: "O", AG: "P", AH: "Q", AI: "R", AJ: "S" };
  for (const [flatCol, vendorCol] of Object.entries(vendorMap)) {
    flatSheet.getRange(`${flatCol}2`).formulas = [[`='Vendor Options'!${vendorCol}2`]];
    flatSheet.getRange(`${flatCol}2:${flatCol}${vendorEnd}`).fillDown();
  }
}
addTable(flatSheet, `A1:AJ${vendorEnd}`, "HardwareImportFlat");
flatSheet.getRange("A1:AJ1").format = headerFormat;
flatSheet.getRange(`Q2:R${vendorEnd}`).format.numberFormat = "0";
flatSheet.getRange(`AA2:AA${vendorEnd}`).format.numberFormat = "$#,##0.00";
flatSheet.getRange(`AC2:AD${vendorEnd}`).format.numberFormat = "0.0%";
flatSheet.getRange(`AE2:AE${vendorEnd}`).format.numberFormat = "$#,##0.00";
flatSheet.freezePanes.freezeRows(1); flatSheet.freezePanes.freezeColumns(2);

const reviewHeaders = ["Severity", "Issue_Type", "Offer_ID", "Spec_ID", "Source_Row", "Record_Summary", "Recommended_Action"];
reviewSheet.getRange(`A1:G${reviewRows.length + 1}`).values = [reviewHeaders, ...reviewRows];
addTable(reviewSheet, `A1:G${reviewRows.length + 1}`, "HardwareReviewQueue");
reviewSheet.getRange("A1:G1").format = headerFormat;
reviewSheet.getRange(`A2:A${reviewRows.length + 1}`).conditionalFormats.add("containsText", { text: "ERROR", format: { fill: red, font: { color: "#9C0006", bold: true } } });
reviewSheet.getRange(`A2:A${reviewRows.length + 1}`).conditionalFormats.add("containsText", { text: "WARNING", format: { fill: amber, font: { color: "#7F6000", bold: true } } });
reviewSheet.getRange(`A2:A${reviewRows.length + 1}`).conditionalFormats.add("containsText", { text: "INFO", format: { fill: blue, font: { color: navy } } });
reviewSheet.getRange(`F2:G${reviewRows.length + 1}`).format.wrapText = true;
reviewSheet.freezePanes.freezeRows(1);

const crosswalkHeaders = ["Source_Row", "Included_In_Import", "Duplicate_Of_Source_Row", "Offer_ID", "Spec_ID", "GROUP", "FAMILY_FUNCTION", "VENDOR", "SIZE_MODEL", "FUNCTION", "THICKNESS_WT", "MATERIAL_FINISH", "PART_NUMBER_RAW", "CUSTOMER_PART_NUMBER", "VENDOR_LIST_PRICE", "DISCOUNT_RAW"];
const crosswalkRows = sourceRows.map((row) => {
  const record = recordBySourceRow.get(row.sourceRow);
  const duplicateOf = duplicateBySourceRow.get(row.sourceRow) || "";
  return [row.sourceRow, duplicateOf ? "NO" : "YES", duplicateOf, record?.offerId || "", record?.specId || "", row.rawGroup, row.rawFamily, row.rawVendor, row.rawSizeModel, row.rawFunction, row.rawThicknessWt, row.rawMaterialFinish, row.rawPartNumber, row.rawCustomerPartNumber, numericPrice(row.rawListPrice), clean(row.rawDiscount)];
});
crosswalkSheet.getRange(`A1:P${crosswalkRows.length + 1}`).values = [crosswalkHeaders, ...crosswalkRows];
addTable(crosswalkSheet, `A1:P${crosswalkRows.length + 1}`, "HardwareSourceCrosswalk");
crosswalkSheet.getRange("A1:P1").format = headerFormat;
crosswalkSheet.getRange(`O2:O${crosswalkRows.length + 1}`).format.numberFormat = "$#,##0.00";
crosswalkSheet.getRange(`B2:B${crosswalkRows.length + 1}`).conditionalFormats.add("containsText", { text: "NO", format: { fill: red, font: { color: "#9C0006", bold: true } } });
crosswalkSheet.freezePanes.freezeRows(1); crosswalkSheet.freezePanes.freezeColumns(5);

const dictionaryRows = [
  ["Specs", "Spec_ID", "text", "Yes", "Stable primary key derived from canonical spec dimensions.", "hardware_specs.id"],
  ["Specs", "Product_Category", "text", "Yes", "Top-level user selection: HINGE, CLOSER, LOCK, DEADBOLT, EXIT DEVICE, PANIC TRIM.", "hardware_specs.category"],
  ["Specs", "Product_Subtype", "text", "Yes", "Vendor-neutral product form/type.", "hardware_specs.subtype"],
  ["Specs", "Application", "text", "Conditional", "Mounting/application such as CYLINDRICAL, MORTISE, or RIM.", "hardware_specs.application"],
  ["Specs", "Function", "text", "Conditional", "Operational function such as ENTRY, CLASSROOM, STOREROOM, or KEY RETRACTS LATCH.", "hardware_specs.function"],
  ["Specs", "Keying", "text", "Conditional", "STANDARD, SFIC, LFIC, or NOT APPLICABLE.", "hardware_specs.keying"],
  ["Specs", "Size", "text", "Conditional", "Vendor-neutral physical size or backset.", "hardware_specs.size"],
  ["Specs", "Rating", "text", "Conditional", "PANIC, FIRE, WIND, TDI, or combined rating.", "hardware_specs.rating"],
  ["Specs", "Duty_Grade", "text", "Conditional", "Closer duty/grade requirement.", "hardware_specs.duty_grade"],
  ["Specs", "Mounting_Arm", "text", "Conditional", "Mounting or closer-arm requirement.", "hardware_specs.mounting_arm"],
  ["Specs", "Thickness_Weight", "text", "Conditional", "Gauge/thickness/weight requirement when applicable.", "hardware_specs.thickness_weight"],
  ["Specs", "Material", "text", "Conditional", "Vendor-neutral material requirement.", "hardware_specs.material"],
  ["Specs", "Finish", "text", "Conditional", "Finish code/name, e.g. 626, 630, 689, CLEAR ANODIZED.", "hardware_specs.finish"],
  ["Specs", "Electrical", "text", "Conditional", "Fail mode, electric dogging, latch retraction, or monitoring option.", "hardware_specs.electrical"],
  ["Vendor Options", "Offer_ID", "text", "Yes", "Stable vendor-offer primary key.", "hardware_vendor_options.id"],
  ["Vendor Options", "Spec_ID", "text", "Yes", "Foreign key to the vendor-neutral spec.", "hardware_vendor_options.spec_id"],
  ["Vendor Options", "Manufacturer_Vendor", "text", "Yes", "Manufacturer/vendor code selected only after a spec match.", "hardware_vendor_options.vendor_code"],
  ["Vendor Options", "Vendor_Series", "text", "No", "Manufacturer-specific series/family.", "hardware_vendor_options.series"],
  ["Vendor Options", "Vendor_Model", "text", "No", "Manufacturer-specific model/configuration.", "hardware_vendor_options.model"],
  ["Vendor Options", "Manufacturer_Part_Number", "text", "Yes", "Orderable manufacturer part/configuration number.", "hardware_vendor_options.part_number"],
  ["Vendor Options", "List_Price", "decimal(12,2)", "Conditional", "Vendor list price in Currency.", "hardware_vendor_prices.list_price"],
  ["Vendor Options", "Discount_1", "decimal(6,5)", "No", "First sequential discount as a decimal.", "hardware_vendor_prices.discount_1"],
  ["Vendor Options", "Discount_2", "decimal(6,5)", "No", "Second sequential discount for chains such as 50/70.", "hardware_vendor_prices.discount_2"],
  ["Vendor Options", "Net_Price", "decimal(12,2)", "Derived", "List_Price × (1 − Discount_1) × (1 − Discount_2).", "hardware_vendor_prices.net_price"],
  ["Vendor Options", "Price_Status", "text", "Derived", "PRICED or UNPRICED.", "staging only"],
  ["Vendor Options", "Data_Status", "text", "Derived", "ACTIVE or REVIEW based on blocking QA flags.", "staging only"],
  ["Vendor Options", "Source_Row", "integer", "Yes", "Original Numbers workbook row for audit traceability.", "staging.source_row"],
];
dictionarySheet.getRange(`A1:F${dictionaryRows.length + 1}`).values = [["Sheet", "Field", "Data_Type", "Required", "Definition", "Recommended_Database_Field"], ...dictionaryRows];
addTable(dictionarySheet, `A1:F${dictionaryRows.length + 1}`, "HardwareDataDictionary");
dictionarySheet.getRange("A1:F1").format = headerFormat;
dictionarySheet.getRange(`E2:F${dictionaryRows.length + 1}`).format.wrapText = true;
dictionarySheet.freezePanes.freezeRows(1);

const aliasRows = [
  ["Category", "HINGES", "HINGE", "Plural source label normalized."],
  ["Category", "DBOLT", "DEADBOLT", "Source abbreviation normalized."],
  ["Category", "CYLINDRICAL LOCK", "LOCK / CYLINDRICAL LOCK", "Category and subtype separated."],
  ["Category", "MORTISE LOCK", "LOCK / MORTISE LOCK", "Category and application separated."],
  ["Category", "MORTISE PANIC", "EXIT DEVICE / MORTISE", "Vendor-neutral category and application separated."],
  ["Category", "RIM PANIC", "EXIT DEVICE / RIM", "Vendor-neutral category and application separated."],
  ["Subtype", "CONTINUOS PIN", "CONTINUOUS PIN HINGE", "Spelling corrected."],
  ["Subtype", "POWER TRSFR", "POWER TRANSFER HINGE", "Abbreviation expanded."],
  ["Function", "DORMITORY; DORM/CORRIDOR; CORIDOR/DORM", "DORMITORY / CORRIDOR", "Equivalent function descriptions grouped."],
  ["Function", "ENTRANCE", "ENTRY", "Equivalent lock function descriptions grouped."],
  ["Keying", "ICB", "SFIC", "Source suffix mapped to its stated core format."],
  ["Keying", "ICS", "LFIC", "Source suffix mapped to its stated core format."],
  ["Material", "304SS; 304 SS", "304 STAINLESS STEEL", "Whitespace and abbreviation normalized."],
  ["Material", "316 SS", "316 STAINLESS STEEL", "Abbreviation expanded."],
  ["Finish", "CLEAR AN", "CLEAR ANODIZED", "Abbreviation expanded."],
];
aliasesSheet.getRange(`A1:D${aliasRows.length + 1}`).values = [["Field", "Source_Value", "Canonical_Value", "Rule_Note"], ...aliasRows];
addTable(aliasesSheet, `A1:D${aliasRows.length + 1}`, "HardwareAliases");
aliasesSheet.getRange("A1:D1").format = headerFormat;
aliasesSheet.getRange(`B2:D${aliasRows.length + 1}`).format.wrapText = true;
aliasesSheet.freezePanes.freezeRows(1);

const widths = {
  "Specs": { A: 21, B: 17, C: 27, D: 14, E: 24, F: 16, G: 15, H: 14, I: 18, J: 23, K: 18, L: 23, M: 16, N: 25, O: 26, P: 18, Q: 16, R: 17, S: 16, T: 16, U: 16, V: 16, W: 16 },
  "Vendor Options": { A: 22, B: 22, C: 17, D: 25, E: 30, F: 20, G: 25, H: 48, I: 24, J: 14, K: 16, L: 13, M: 13, N: 14, O: 10, P: 14, Q: 14, R: 42, S: 12 },
  "Import Flat": { A: 22, B: 17, C: 27, D: 14, E: 24, F: 16, G: 15, H: 14, I: 18, J: 23, K: 18, L: 23, M: 16, N: 25, O: 26, P: 18, Q: 16, R: 17, S: 22, T: 17, U: 25, V: 30, W: 20, X: 25, Y: 48, Z: 24, AA: 14, AB: 16, AC: 13, AD: 13, AE: 14, AF: 10, AG: 14, AH: 14, AI: 42, AJ: 12 },
  "Review Queue": { A: 12, B: 30, C: 22, D: 22, E: 12, F: 55, G: 65 },
  "Source Crosswalk": { A: 12, B: 16, C: 19, D: 22, E: 22, F: 22, G: 30, H: 12, I: 28, J: 35, K: 18, L: 22, M: 55, N: 24, O: 16, P: 16 },
  "Data Dictionary": { A: 18, B: 30, C: 18, D: 14, E: 70, F: 36 },
  "Aliases": { A: 18, B: 38, C: 38, D: 60 },
};
for (const [sheetName, mapping] of Object.entries(widths)) {
  const sheet = workbook.worksheets.getItem(sheetName);
  for (const [column, width] of Object.entries(mapping)) sheet.getRange(`${column}:${column}`).format.columnWidth = width;
  sheet.getUsedRange().format.autofitRows();
  sheet.getRange("1:1").format.rowHeight = 34;
}

await fs.mkdir(`${root}/preview/final`, { recursive: true });
for (const sheet of [overview, specsSheet, vendorSheet, flatSheet, reviewSheet, crosswalkSheet, dictionarySheet, aliasesSheet]) {
  const preview = await workbook.render({ sheetName: sheet.name, autoCrop: "all", scale: sheet.name === "Overview" ? 1.5 : 1, format: "png" });
  await fs.writeFile(`${root}/preview/final/${sheet.name.replace(/[^a-z0-9_-]+/gi, "_")}.png`, new Uint8Array(await preview.arrayBuffer()));
}

const inspectSpecs = await workbook.inspect({ kind: "table", range: `Specs!A1:W${Math.min(specsEnd, 12)}`, include: "values,formulas", tableMaxRows: 12, tableMaxCols: 23, maxChars: 12000 });
const inspectVendor = await workbook.inspect({ kind: "table", range: `Vendor Options!A1:S${Math.min(vendorEnd, 12)}`, include: "values,formulas", tableMaxRows: 12, tableMaxCols: 19, maxChars: 12000 });
const formulaErrors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!", options: { useRegex: true, maxResults: 300 }, summary: "final formula error scan", maxChars: 12000 });
await fs.writeFile(`${root}/work/final-inspection.txt`, `${inspectSpecs.ndjson}\n${inspectVendor.ndjson}\n${formulaErrors.ndjson}\n`);
console.log(JSON.stringify({ sourceRows: sourceRows.length, duplicatesExcluded: duplicates.length, activeOffers: records.length, specs: specs.length, pricedOffers: pricedCount, multiVendorSpecs, reviewIssues: reviewRows.length }));
console.log(formulaErrors.ndjson);

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(outputPath);
