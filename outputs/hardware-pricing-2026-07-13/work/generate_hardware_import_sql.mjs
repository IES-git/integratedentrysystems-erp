import fs from "node:fs/promises";

const repo = "/Users/alfredreyes/Desktop/Development/IES/integratedentrysystems-erp";
const sourceFile = "Hardware Pricing - Optimized Database Import.xlsx";
const data = JSON.parse(await fs.readFile(`${repo}/outputs/hardware-pricing-2026-07-13/work/hardware-database-rows.json`, "utf8"));
const output = `${repo}/db/migrations/20260713121000_import_optimized_hardware_pricing.sql`;

const rowsToObjects = (rows) => {
  const [headers, ...values] = rows;
  return values.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null])));
};

const specs = rowsToObjects(data.specs);
const offers = rowsToObjects(data.vendorOptions);
const specByExternalId = new Map(specs.map((spec) => [spec.Spec_ID, spec]));

const sql = (value) => value == null || value === "" ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
const num = (value) => value == null || value === "" || !Number.isFinite(Number(value)) ? "NULL" : String(Number(value));
const bool = (value) => value ? "true" : "false";
const json = (value) => `${sql(JSON.stringify(value))}::jsonb`;

function categorySlug(spec) {
  if (spec.Product_Category === "HINGE") {
    if (String(spec.Product_Subtype ?? "").includes("CONTINUOUS")) return "continuous_hinges";
    if (String(spec.Product_Subtype ?? "").includes("POWER TRANSFER")) return "electric_hinges_ept_loops";
    return "butt_hinges";
  }
  if (spec.Product_Category === "CLOSER") return "closers_and_arms";
  if (["LOCK", "DEADBOLT"].includes(spec.Product_Category)) return "cylindrical_mortise_locks_and_deadbolts";
  if (spec.Product_Category === "EXIT DEVICE") return "exit_devices";
  if (spec.Product_Category === "PANIC TRIM") return "exit_trim_pulls";
  return "unclassified";
}

function subcategorySlug(spec) {
  if (spec.Product_Category === "HINGE") {
    if (String(spec.Product_Subtype ?? "").includes("CONTINUOUS")) return "continuous_hinge";
    if (String(spec.Product_Subtype ?? "").includes("POWER TRANSFER")) return "electric_hinge";
    return "butt_hinge";
  }
  if (spec.Product_Category === "CLOSER") return "surface_closer";
  if (spec.Product_Category === "DEADBOLT") return "deadbolt";
  if (spec.Product_Category === "LOCK") return spec.Application === "MORTISE" ? "mortise_lock" : "cylindrical_lock";
  if (spec.Product_Category === "EXIT DEVICE") return spec.Application === "MORTISE" ? "mortise_exit_device" : "rim_exit_device";
  if (spec.Product_Category === "PANIC TRIM") return spec.Application === "MORTISE" ? "mortise_exit_trim" : "rim_exit_trim";
  return "unclassified";
}

const productGroups = new Map();
for (const offer of offers) {
  const spec = specByExternalId.get(offer.Spec_ID);
  const key = [categorySlug(spec), offer.Manufacturer_Vendor, offer.Vendor_Series].join("|");
  const existing = productGroups.get(key) ?? { key, spec, offers: [] };
  existing.offers.push(offer);
  productGroups.set(key, existing);
}

const lines = [];
lines.push(`-- Generated from ${sourceFile}.`);
lines.push("-- Additive/idempotent optimized hardware import: 163 neutral specs, 283 vendor offers.");
lines.push("-- ACTIVE offers are estimator-selectable; REVIEW offers remain staged for admin review.");

const specValues = specs.map((spec) => {
  const active = Number(spec.Active_Option_Count ?? 0) > 0;
  const approved = active && spec.Spec_Status !== "REVIEW";
  return `(${sql(spec.Spec_ID)}, ${sql(categorySlug(spec))}, ${sql(spec.Product_Subtype)}, ${sql(spec.Application)}, ${sql(spec.Function)}, ${sql(spec.Keying)}, ${sql(spec.Size)}, ${sql(spec.Rating)}, ${sql(spec.Duty_Grade)}, ${sql(spec.Mounting_Arm)}, ${sql(spec.Thickness_Weight)}, ${sql(spec.Material)}, ${sql(spec.Finish)}, ${sql(spec.Electrical)}, ${sql(spec.Other_Requirements)}, ${sql(spec.Match_Confidence)}, ${bool(active)}, ${sql(approved ? "approved" : "needs_review")}, ${sql(sourceFile)}, ${json({
    vendorOptionCount: spec.Vendor_Option_Count,
    manufacturerCount: spec.Manufacturer_Count,
    pricedOptionCount: spec.Priced_Option_Count,
    activeOptionCount: spec.Active_Option_Count,
    minNetPrice: spec.Min_Net_Price,
    maxNetPrice: spec.Max_Net_Price,
    workbookStatus: spec.Spec_Status,
  })}, ${approved ? "now()" : "NULL"})`;
});
lines.push(`INSERT INTO public.hardware_spec (external_spec_id, category, product_subtype, application, function, keying, size, rating, duty_grade, mounting_arm, thickness_weight, material, finish, electrical, other_requirements, match_confidence, active, approval_state, source_file, source_metadata, last_reviewed_at) VALUES\n${specValues.join(",\n")}\nON CONFLICT (external_spec_id) DO UPDATE SET category = EXCLUDED.category, product_subtype = EXCLUDED.product_subtype, application = EXCLUDED.application, function = EXCLUDED.function, keying = EXCLUDED.keying, size = EXCLUDED.size, rating = EXCLUDED.rating, duty_grade = EXCLUDED.duty_grade, mounting_arm = EXCLUDED.mounting_arm, thickness_weight = EXCLUDED.thickness_weight, material = EXCLUDED.material, finish = EXCLUDED.finish, electrical = EXCLUDED.electrical, other_requirements = EXCLUDED.other_requirements, match_confidence = EXCLUDED.match_confidence, active = EXCLUDED.active, approval_state = EXCLUDED.approval_state, source_file = EXCLUDED.source_file, source_metadata = EXCLUDED.source_metadata, last_reviewed_at = EXCLUDED.last_reviewed_at, updated_at = now();`);

const productValues = [...productGroups.values()].map(({ key, spec, offers: productOffers }) => {
  const active = productOffers.some((offer) => offer.Data_Status === "ACTIVE");
  const sourceRows = productOffers.map((offer) => Number(offer.Source_Row)).filter(Number.isFinite);
  const vendor = productOffers[0].Manufacturer_Vendor;
  const series = productOffers[0].Vendor_Series;
  const descriptions = productOffers.map((offer) => offer.Product_Description_Raw).filter(Boolean);
  return `(${sql(key)}, ${sql(categorySlug(spec))}, ${sql(subcategorySlug(spec))}, NULL, ${sql(vendor)}, ${sql(series)}, NULL, ${sql(descriptions[0] ?? `${vendor} ${series}`)}, ${bool(active)}, ${sql(`${sourceFile} rows ${Math.min(...sourceRows)}-${Math.max(...sourceRows)}`)}, ${num(active ? 0.95 : 0.5)}, ${sql(active ? "approved" : "needs_review")}, ${num(Math.min(...sourceRows))}, ${sql(active ? null : "All imported offers require review")}, ${active ? "now()" : "NULL"})`;
});
lines.push(`INSERT INTO public.hardware_product (source_import_key, category, subcategory, manufacturer_id, manufacturer_name, product_family, model, description, active, source_row_ref, source_confidence, approval_state, source_row_number, taxonomy_notes, last_reviewed_at) VALUES\n${productValues.join(",\n")}\nON CONFLICT (source_import_key) WHERE source_import_key IS NOT NULL DO UPDATE SET category = EXCLUDED.category, subcategory = EXCLUDED.subcategory, manufacturer_name = EXCLUDED.manufacturer_name, product_family = EXCLUDED.product_family, model = EXCLUDED.model, description = EXCLUDED.description, active = EXCLUDED.active, source_row_ref = EXCLUDED.source_row_ref, source_confidence = EXCLUDED.source_confidence, approval_state = EXCLUDED.approval_state, source_row_number = EXCLUDED.source_row_number, taxonomy_notes = EXCLUDED.taxonomy_notes, last_reviewed_at = EXCLUDED.last_reviewed_at, updated_at = now();`);

const variantValues = offers.map((offer) => {
  const spec = specByExternalId.get(offer.Spec_ID);
  const productKey = [categorySlug(spec), offer.Manufacturer_Vendor, offer.Vendor_Series].join("|");
  const active = offer.Data_Status === "ACTIVE";
  const qaFlags = String(offer.QA_Flags ?? "").split(/\s*;\s*/).filter(Boolean);
  const optionAttributes = {
    application: spec.Application,
    product_subtype: spec.Product_Subtype,
    keying: spec.Keying,
    duty_grade: spec.Duty_Grade,
    mounting_arm: spec.Mounting_Arm,
    thickness_weight: spec.Thickness_Weight,
    electrical: spec.Electrical,
    other_requirements: spec.Other_Requirements,
    vendor_model: offer.Vendor_Model,
    vendor_function_code: offer.Vendor_Function_Code,
    customer_part_number: offer.Customer_Part_Number,
    product_description_raw: offer.Product_Description_Raw,
    price_status: offer.Price_Status,
    data_status: offer.Data_Status,
    qa_flags: qaFlags,
  };
  return `(${sql(offer.Offer_ID)}, ${sql(productKey)}, ${sql(offer.Spec_ID)}, ${sql(offer.Manufacturer_Part_Number || offer.Offer_ID)}, ${sql(spec.Function)}, ${sql(spec.Finish)}, ${sql(spec.Size)}, NULL, ${sql(spec.Electrical)}, ${sql(spec.Rating)}, ${sql(spec.Material)}, ${json(optionAttributes)}, ${bool(active)}, ${sql(active ? "approved" : "needs_review")}, ${num(offer.Source_Row)}, ${sql(qaFlags.length ? qaFlags.join("; ") : null)}, ${active ? "now()" : "NULL"})`;
});
lines.push(`INSERT INTO public.hardware_variant (hardware_product_id, hardware_spec_id, source_offer_id, sku, function, finish, size, hand, voltage, rating, material, option_attributes, active, approval_state, source_row_number, taxonomy_notes, last_reviewed_at)
SELECT product.id, spec.id, incoming.source_offer_id, incoming.sku, incoming.function, incoming.finish, incoming.size, incoming.hand, incoming.voltage, incoming.rating, incoming.material, incoming.option_attributes, incoming.active, incoming.approval_state, incoming.source_row_number, incoming.taxonomy_notes, incoming.last_reviewed_at
FROM (VALUES\n${variantValues.join(",\n")}
) AS incoming(source_offer_id, source_product_key, external_spec_id, sku, function, finish, size, hand, voltage, rating, material, option_attributes, active, approval_state, source_row_number, taxonomy_notes, last_reviewed_at)
JOIN public.hardware_product product ON product.source_import_key = incoming.source_product_key
JOIN public.hardware_spec spec ON spec.external_spec_id = incoming.external_spec_id
ON CONFLICT (source_offer_id) WHERE source_offer_id IS NOT NULL DO UPDATE SET hardware_product_id = EXCLUDED.hardware_product_id, hardware_spec_id = EXCLUDED.hardware_spec_id, sku = EXCLUDED.sku, function = EXCLUDED.function, finish = EXCLUDED.finish, size = EXCLUDED.size, hand = EXCLUDED.hand, voltage = EXCLUDED.voltage, rating = EXCLUDED.rating, material = EXCLUDED.material, option_attributes = EXCLUDED.option_attributes, active = EXCLUDED.active, approval_state = EXCLUDED.approval_state, source_row_number = EXCLUDED.source_row_number, taxonomy_notes = EXCLUDED.taxonomy_notes, last_reviewed_at = EXCLUDED.last_reviewed_at, updated_at = now();`);

const priceBookId = "HARDWARE-OPTIMIZED-2026-07-13";
lines.push(`INSERT INTO public.hardware_price_book (source_import_id, supplier_id, supplier_name, title, effective_date, expiry_date, currency_code, source_file, review_status) VALUES (${sql(priceBookId)}, NULL, 'MULTI-VENDOR', 'Optimized Hardware Pricing 2026-07-13', DATE '2026-07-13', NULL, 'USD', ${sql(sourceFile)}, 'APPROVED') ON CONFLICT (source_import_id) WHERE source_import_id IS NOT NULL DO UPDATE SET title = EXCLUDED.title, effective_date = EXCLUDED.effective_date, currency_code = EXCLUDED.currency_code, source_file = EXCLUDED.source_file, review_status = EXCLUDED.review_status, updated_at = now();`);

const pricedOffers = offers.filter((offer) => offer.List_Price != null && offer.Net_Price != null);
const priceValues = pricedOffers.map((offer) => {
  const active = offer.Data_Status === "ACTIVE";
  const multiplier = Number(offer.List_Price) > 0 ? Number(offer.Net_Price) / Number(offer.List_Price) : null;
  return `(${sql(`${priceBookId}:${offer.Offer_ID}`)}, ${sql(offer.Offer_ID)}, ${num(offer.List_Price)}, ${num(multiplier)}, ${num(offer.Net_Price)}, 'EACH', DATE '2026-07-13', NULL, 1, ${sql(`${sourceFile}#row-${offer.Source_Row}`)}, ${sql(active ? "APPROVED" : "NEEDS_REVIEW")}, ${bool(active)}, ${sql(active ? "approved" : "needs_review")}, ${sql(offer.Discount_Raw)}, ${active ? "now()" : "NULL"})`;
});
lines.push(`INSERT INTO public.hardware_price (source_price_id, hardware_variant_id, hardware_price_book_id, list_price, discount_multiplier, net_cost, uom, effective_from, effective_to, minimum_quantity, source_row_ref, review_status, active, approval_state, discount_chain, last_reviewed_at)
SELECT incoming.source_price_id, variant.id, price_book.id, incoming.list_price, incoming.discount_multiplier, incoming.net_cost, incoming.uom, incoming.effective_from, incoming.effective_to::date, incoming.minimum_quantity, incoming.source_row_ref, incoming.review_status, incoming.active, incoming.approval_state, incoming.discount_chain, incoming.last_reviewed_at
FROM (VALUES\n${priceValues.join(",\n")}
) AS incoming(source_price_id, source_offer_id, list_price, discount_multiplier, net_cost, uom, effective_from, effective_to, minimum_quantity, source_row_ref, review_status, active, approval_state, discount_chain, last_reviewed_at)
JOIN public.hardware_variant variant ON variant.source_offer_id = incoming.source_offer_id
JOIN public.hardware_price_book price_book ON price_book.source_import_id = ${sql(priceBookId)}
ON CONFLICT (source_price_id) WHERE source_price_id IS NOT NULL DO UPDATE SET hardware_variant_id = EXCLUDED.hardware_variant_id, hardware_price_book_id = EXCLUDED.hardware_price_book_id, list_price = EXCLUDED.list_price, discount_multiplier = EXCLUDED.discount_multiplier, net_cost = EXCLUDED.net_cost, uom = EXCLUDED.uom, effective_from = EXCLUDED.effective_from, effective_to = EXCLUDED.effective_to, minimum_quantity = EXCLUDED.minimum_quantity, source_row_ref = EXCLUDED.source_row_ref, review_status = EXCLUDED.review_status, active = EXCLUDED.active, approval_state = EXCLUDED.approval_state, discount_chain = EXCLUDED.discount_chain, last_reviewed_at = EXCLUDED.last_reviewed_at, updated_at = now();`);

lines.push("");

await fs.writeFile(output, lines.join("\n\n"));
console.log(JSON.stringify({ output, specs: specs.length, products: productGroups.size, offers: offers.length, prices: pricedOffers.length }));
