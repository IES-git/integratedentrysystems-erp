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
