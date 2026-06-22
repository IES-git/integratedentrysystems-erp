const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface QuoteSummaryItem {
  label: string;
  quantity: number;
  lineTotal: number;
}

export type QuoteCopyTarget = 'overview' | 'scope' | 'terms' | 'custom';

export interface QuoteCopyLineItem {
  label: string;
  quantity: number;
  lineTotal: number;
  unitPrice?: number;
  canonicalCode?: string | null;
  category?: string | null;
}

export interface QuoteCopyOpening {
  name: string;
  quantity: number;
  summary?: string | null;
  door?: Record<string, string>;
  frame?: Record<string, string>;
}

export interface QuoteSummaryInput {
  companyName: string | null;
  items: QuoteSummaryItem[];
  total: number;
  currency: string;
  notes?: string | null;
}

export interface QuoteCopyInput {
  target: QuoteCopyTarget;
  audience: 'customer' | 'manufacturer';
  companyName: string | null;
  quoteType: string;
  items: QuoteCopyLineItem[];
  openings?: QuoteCopyOpening[];
  total: number;
  currency: string;
  notes?: string | null;
  currentText?: string;
  userPrompt?: string;
}

function fmtCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

export async function generateQuoteSummary(input: QuoteSummaryInput): Promise<string> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  if (!apiKey) {
    throw new Error('Gemini API key is not configured (VITE_GEMINI_API_KEY).');
  }

  const itemLines = input.items
    .map((i) => `- ${i.quantity}x ${i.label} (${fmtCurrency(i.lineTotal, input.currency)})`)
    .join('\n');

  const notesClause = input.notes
    ? `\nAdditional notes from the sales rep: "${input.notes}"`
    : '';

  const prompt = `You are helping a customer understand a quote they received from Integrated Entry Systems, a commercial door and hardware company.

Write exactly 2 short, friendly sentences in plain, simple English (no technical jargon) for the customer. The first sentence should explain what this quote is for. The second sentence should briefly summarize what products or services are included.

Quote details:
Customer: ${input.companyName ?? 'the customer'}
Total: ${fmtCurrency(input.total, input.currency)}
Items:
${itemLines}${notesClause}

Write only the 2 sentences, nothing else.`;

  const response = await fetch(
    `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 160,
          temperature: 0.35,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Gemini API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const text: string | undefined =
    data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('Gemini returned an empty response.');
  }

  return text.trim();
}

const QUOTE_COPY_INSTRUCTIONS: Record<QuoteCopyTarget, string> = {
  overview:
    'Write exactly 2 complete customer-ready sentences. Sentence 1 must identify the customer or project and mention the primary opening count/spec. Sentence 2 must mention the main included categories and the quote total.',
  scope:
    'Write 2-3 concise complete sentences for the scope of work. Mention the opening quantity, door/frame spec, hardware, preparations, freight/delivery, install labor, or tax lines when those details are provided.',
  terms:
    'Write concise quote terms. Keep or improve any existing validity/payment/lead-time language, but do not invent legal terms, warranties, lead times, exclusions, or payment requirements that are not provided.',
  custom:
    'Write a brief custom message appropriate for the selected audience. Keep it practical, polished, and specific to this quote.',
};

function summarizeSpecs(specs?: Record<string, string>) {
  if (!specs) return '';
  return Object.entries(specs)
    .filter(([, value]) => value)
    .slice(0, 12)
    .map(([key, value]) => `${humanizeSpecKey(key)}: ${value}`)
    .join('; ');
}

function humanizeSpecKey(key: string) {
  return key
    .replace(/^(door|frame)\./, '')
    .replace(/_/g, ' ')
    .replace(/\bga\b/gi, 'gauge')
    .trim();
}

function firstSpec(specs: Record<string, string> | undefined, keys: string[]) {
  if (!specs) return null;
  for (const key of keys) {
    const value = specs[key];
    if (value) return value;
  }
  return null;
}

function formatOpeningBrief(opening: QuoteCopyOpening) {
  const door = opening.door ?? {};
  const frame = opening.frame ?? {};
  const width =
    firstSpec(door, ['door.nominal_door_width']) ??
    firstSpec(frame, ['frame.nominal_frame_width']);
  const height =
    firstSpec(door, ['door.nominal_door_height']) ??
    firstSpec(frame, ['frame.nominal_frame_height']);
  const size = width && height ? `${width} x ${height}` : null;
  const doorSeries = firstSpec(door, ['door.door_series_construction']);
  const doorMaterial = firstSpec(door, ['door.door_material']);
  const doorGauge = firstSpec(door, ['door.door_gauge']);
  const doorCore = firstSpec(door, ['door.core_type']);
  const frameSeries = firstSpec(frame, ['frame.frame_series', 'frame.frame_series_construction']);
  const frameType = firstSpec(frame, ['frame.frame_type']);
  const frameGauge = firstSpec(frame, ['frame.frame_gauge']);
  const jamb = firstSpec(frame, ['frame.jamb_depth']);
  const fireLabel =
    firstSpec(door, ['door.door_label_required_specific_designation']) ??
    firstSpec(frame, ['frame.frame_label_required_designation']);
  const hand =
    firstSpec(door, ['door.door_hand']) ??
    firstSpec(frame, ['frame.frame_hand']);
  const hingeQty =
    firstSpec(door, ['door.hinge_quantity']) ??
    firstSpec(frame, ['frame.hinge_quantity']);
  const hingePrep =
    firstSpec(door, ['door.hinge_preparation_type']) ??
    firstSpec(frame, ['frame.hinge_preparation_type']);
  const lockPrep = firstSpec(door, ['door.primary_lock_exit_device_preparation']);
  const strikePrep = firstSpec(frame, ['frame.primary_strike_preparation']);
  const closerPrep =
    firstSpec(door, ['door.closer_holder_preparation']) ??
    firstSpec(frame, ['frame.closer_holder_coordinator_preparation']);

  const doorParts = [
    doorSeries ? `Series ${doorSeries}` : null,
    size,
    doorGauge ? `${doorGauge}ga` : null,
    doorMaterial,
    doorCore,
  ].filter(Boolean);
  const frameParts = [
    frameSeries ? `Frame ${frameSeries}` : null,
    frameType,
    frameGauge ? `${frameGauge}ga` : null,
    jamb ? `${jamb} jamb` : null,
  ].filter(Boolean);
  const prepParts = [
    fireLabel ? `${fireLabel} fire label` : null,
    hand ? `${hand} handing` : null,
    hingeQty ? `${hingeQty} hinges${hingePrep ? ` (${hingePrep})` : ''}` : null,
    lockPrep ? `lock/exit prep ${lockPrep}` : null,
    strikePrep ? `strike prep ${strikePrep}` : null,
    closerPrep ? `closer prep ${closerPrep}` : null,
  ].filter(Boolean);

  const parts = [
    `${opening.quantity}x ${opening.name}`,
    opening.summary,
    doorParts.length ? `door: ${doorParts.join(', ')}` : null,
    frameParts.length ? `frame: ${frameParts.join(', ')}` : null,
    prepParts.length ? `preps: ${prepParts.join(', ')}` : null,
  ].filter(Boolean);

  return parts.join(' | ');
}

function summarizeQuoteContext(input: QuoteCopyInput) {
  const openingBriefs = (input.openings ?? []).slice(0, 8).map(formatOpeningBrief);
  const categories = Array.from(
    new Set(input.items.map((item) => item.category).filter((category): category is string => Boolean(category))),
  );
  const meaningfulItems = input.items
    .filter((item) => item.lineTotal > 0 || !/tax/i.test(item.label))
    .slice(0, 14)
    .map((item) => `${item.quantity}x ${item.label}`);
  const services = input.items
    .filter((item) => /freight|delivery|install|labor|tax/i.test(`${item.label} ${item.category ?? ''}`))
    .map((item) => `${item.quantity}x ${item.label}`)
    .slice(0, 8);

  return [
    openingBriefs.length ? `Opening/spec highlights:\n${openingBriefs.map((line) => `- ${line}`).join('\n')}` : '',
    meaningfulItems.length ? `Included line highlights:\n${meaningfulItems.map((line) => `- ${line}`).join('\n')}` : '',
    categories.length ? `Included categories: ${categories.join(', ')}` : '',
    services.length ? `Service/freight/tax lines: ${services.join('; ')}` : '',
  ].filter(Boolean).join('\n\n');
}

const TARGET_OUTPUT_RULES: Record<QuoteCopyTarget, string> = {
  overview: [
    '- Use 35-70 words total.',
    '- Include at least 3 concrete details from the context, such as size, material, frame series, hinge count, freight, install labor, or total.',
    '- Do not start with "This quote provides" or "This quote includes".',
  ].join('\n'),
  scope: [
    '- Use 45-90 words total.',
    '- Include at least 4 concrete scope details from the context.',
    '- Prefer plain customer-facing prose over generic sales language.',
    '- Do not start with "This quote includes one (1)" unless the rest of the sentence immediately names the specific opening and scope.',
  ].join('\n'),
  terms: [
    '- Use 1-3 sentences.',
    '- Do not add payment, warranty, or legal language unless it appears in the current text, notes, or prompt.',
  ].join('\n'),
  custom: [
    '- Use 1-2 sentences.',
    '- Make the note specific to the available estimate details when possible.',
  ].join('\n'),
};

function cleanGeneratedCopy(text: string) {
  return text
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\n{3,}/g, '\n\n');
}

export async function generateQuoteCopy(input: QuoteCopyInput): Promise<string> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  if (!apiKey) {
    throw new Error('Gemini API key is not configured (VITE_GEMINI_API_KEY).');
  }

  const itemLines =
    input.items
      .slice(0, 40)
      .map((item) => {
        const code = item.canonicalCode ? `, code ${item.canonicalCode}` : '';
        const category = item.category ? `, category ${item.category}` : '';
        const unit = item.unitPrice !== undefined ? `, unit ${fmtCurrency(item.unitPrice, input.currency)}` : '';
        return `- ${item.quantity}x ${item.label}${code}${category}${unit}, line total ${fmtCurrency(item.lineTotal, input.currency)}`;
      })
      .join('\n') || '- No quote lines provided';

  const openingLines =
    input.openings
      ?.slice(0, 12)
      .map((opening) => {
        const door = summarizeSpecs(opening.door);
        const frame = summarizeSpecs(opening.frame);
        const parts = [
          `${opening.quantity}x ${opening.name}`,
          opening.summary ? `summary: ${opening.summary}` : '',
          door ? `door: ${door}` : '',
          frame ? `frame: ${frame}` : '',
        ].filter(Boolean);
        return `- ${parts.join(' | ')}`;
      })
      .join('\n') || '- No opening details provided';

  const currentText = input.currentText?.trim()
    ? `\nCurrent ${input.target} text to improve or replace:\n${input.currentText.trim()}`
    : '';
  const userPrompt = input.userPrompt?.trim()
    ? `\nSales rep direction:\n${input.userPrompt.trim()}`
    : '';
  const notesClause = input.notes?.trim()
    ? `\nQuote notes:\n${input.notes.trim()}`
    : '';

  const audienceRule =
    input.audience === 'customer'
      ? 'This is customer-facing copy. Do not reveal internal costs, markups, pricing mechanics, or implementation notes.'
      : 'This is manufacturer/internal fulfillment copy. Technical details are appropriate, but keep the text concise.';
  const contextBrief = summarizeQuoteContext(input);

  const prompt = `You are drafting quote copy for Integrated Entry Systems, a commercial door, frame, and hardware company.

Task:
${QUOTE_COPY_INSTRUCTIONS[input.target]}

Output rules:
${TARGET_OUTPUT_RULES[input.target]}

Audience:
${input.audience}
${audienceRule}

Constraints:
- Write only the replacement text for this one ${input.target} field.
- Keep it concise and professional.
- Base the copy only on the provided estimate and quote details.
- Do not add markdown headings.
- Do not change pricing, quantities, or scope.
- Do not use vague filler such as "comprehensive estimate" or "all necessary components" unless you immediately name the actual components.
- Every sentence must be complete.

Quote details:
Customer: ${input.companyName ?? 'the customer'}
Quote type: ${input.quoteType}
Total: ${fmtCurrency(input.total, input.currency)}

Context brief:
${contextBrief || 'No context brief available. Use the line items and openings below.'}

Openings:
${openingLines}

Quote lines:
${itemLines}${notesClause}${currentText}${userPrompt}`;

  const response = await fetch(
    `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: input.target === 'terms' ? 320 : 280,
          temperature: 0.25,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Gemini API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const text: string | undefined =
    data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('Gemini returned an empty response.');
  }

  return cleanGeneratedCopy(text);
}

// ---------------------------------------------------------------------------
// CPQ — pricing exception agent (Phase 2)
// ---------------------------------------------------------------------------

export interface PricingExceptionContext {
  itemLabel: string;
  itemType: string | null;
  status: string;
  fields: { key: string; value: string }[];
  /** Candidate rows from the resolved table, when one was found. */
  availableRows?: { id: string; label: string }[];
  /** Candidate columns from the resolved table, when one was found. */
  availableColumns?: { id: string; label: string }[];
  warning?: string;
}

export interface PricingExceptionAgentResult {
  kind: 'closest_cell' | 'fuzzy_series' | 'add_adder' | 'manual' | 'none';
  suggestedRowId: string | null;
  suggestedColumnId: string | null;
  reason: string;
}

/**
 * Given a failed pricing lookup, asks Gemini to propose the closest valid
 * row/column (or explain why none fits). Suggestion only — never writes prices.
 */
export async function explainPricingException(
  ctx: PricingExceptionContext,
): Promise<PricingExceptionAgentResult> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  if (!apiKey) {
    throw new Error('Gemini API key is not configured (VITE_GEMINI_API_KEY).');
  }

  const fieldsList = ctx.fields.map((f) => `- ${f.key}: ${f.value}`).join('\n') || '(none)';
  const rowsList = (ctx.availableRows ?? []).map((r) => `  - id=${r.id} label="${r.label}"`).join('\n') || '  (none)';
  const colsList = (ctx.availableColumns ?? []).map((c) => `  - id=${c.id} label="${c.label}"`).join('\n') || '  (none)';

  const prompt = `You are a pricing assistant for a commercial door/frame/hardware CPQ system. A pricing lookup FAILED and you must propose the CLOSEST valid match from the available pricing-table rows and columns, or say none fits.

Item: "${ctx.itemLabel}" (type: ${ctx.itemType ?? 'unknown'})
Failure status: ${ctx.status}${ctx.warning ? `\nDetail: ${ctx.warning}` : ''}

Item spec fields:
${fieldsList}

Available rows (sizes):
${rowsList}

Available columns (variants such as gauge/material/depth):
${colsList}

Decide the best action:
- "closest_cell": pick the row id and column id whose labels best match the item's dimensions/specs.
- "fuzzy_series": the failure is a missing table/series; no row/column can be chosen.
- "none": nothing is a reasonable match.

Respond ONLY with minified JSON of the form:
{"kind":"closest_cell|fuzzy_series|add_adder|manual|none","suggestedRowId":"<id or null>","suggestedColumnId":"<id or null>","reason":"<one short sentence>"}
Use null (not empty string) when a row or column cannot be chosen.`;

  const response = await fetch(
    `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 300,
          temperature: 0.2,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Gemini API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned an empty response.');

  let parsed: Partial<PricingExceptionAgentResult>;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: 'none', suggestedRowId: null, suggestedColumnId: null, reason: text.trim().slice(0, 200) };
  }

  return {
    kind: (parsed.kind as PricingExceptionAgentResult['kind']) ?? 'none',
    suggestedRowId: parsed.suggestedRowId ?? null,
    suggestedColumnId: parsed.suggestedColumnId ?? null,
    reason: parsed.reason ?? 'No reason provided.',
  };
}
