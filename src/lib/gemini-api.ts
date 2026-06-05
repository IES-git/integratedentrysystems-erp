const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface QuoteSummaryItem {
  label: string;
  quantity: number;
  lineTotal: number;
}

export interface QuoteSummaryInput {
  companyName: string | null;
  items: QuoteSummaryItem[];
  total: number;
  currency: string;
  notes?: string | null;
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
        generationConfig: { maxOutputTokens: 300, temperature: 0.2, responseMimeType: 'application/json' },
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
