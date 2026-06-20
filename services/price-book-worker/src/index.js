// Price-book ingestion worker (Render web service).
//
// Endpoints (all require a valid Supabase user access token in
// `Authorization: Bearer <token>`):
//   GET  /health                     -> liveness
//   POST /catalog     { priceBookId }   -> kicks off cataloging in the background, returns 202
//   POST /extract-all { priceBookId }   -> extracts ALL pending grids in the background, returns 202 (poll price_books.extract_*)
//   POST /extract     { extractionId }  -> extracts one table's grid (synchronous), returns counts
//
// Runs the long Gemini passes without the Edge Function wall-clock limit.

import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { runCatalog, runExtractTable, runExtractAll } from './jobs.js';
import { runCompileTable, runCompileAll } from './compile.js';
import { runIngestHardware } from './hardware.js';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY,
  GEMINI_API_KEY,
  ALLOWED_ORIGINS,
  PORT,
} = process.env;

for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, GEMINI_API_KEY })) {
  if (!v) {
    console.error(`Missing required env var: ${k}`);
    process.exit(1);
  }
}

// Service-role client for all DB/storage work (bypasses RLS).
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
// Anon client only for verifying caller access tokens.
const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const app = express();
app.use(express.json({ limit: '1mb' }));

const origins = (ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim());
app.use(cors({ origin: origins.includes('*') ? true : origins }));

app.get('/health', (_req, res) => res.json({ ok: true }));

// Auth: require a valid Supabase user token.
async function requireUser(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Missing Authorization bearer token' });
    const { data, error } = await anon.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Invalid or expired token' });
    req.user = data.user;
    next();
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : 'Auth failed' });
  }
}

// Catalog: respond immediately, run in the background (no timeout pressure).
app.post('/catalog', requireUser, async (req, res) => {
  const { priceBookId } = req.body || {};
  if (!priceBookId) return res.status(400).json({ error: 'Missing priceBookId' });
  const { data: book, error } = await admin.from('price_books').select('id').eq('id', priceBookId).single();
  if (error || !book) return res.status(404).json({ error: 'Price book not found' });

  await admin.from('price_books').update({ ocr_status: 'processing', ocr_error: null }).eq('id', priceBookId);
  res.status(202).json({ success: true, started: true, priceBookId });

  // Fire-and-forget; runCatalog sets ocr_status done/error. The frontend polls.
  runCatalog(admin, GEMINI_API_KEY, priceBookId).catch((e) => console.error('[catalog] background error:', e));
});

// Extract ALL pending grids for a book: respond immediately, run in the
// background (no timeout pressure), record progress on the price_books row.
app.post('/extract-all', requireUser, async (req, res) => {
  const { priceBookId } = req.body || {};
  if (!priceBookId) return res.status(400).json({ error: 'Missing priceBookId' });
  const { data: book, error } = await admin.from('price_books').select('id').eq('id', priceBookId).single();
  if (error || !book) return res.status(404).json({ error: 'Price book not found' });

  await admin.from('price_books').update({ extract_status: 'processing', extract_error: null }).eq('id', priceBookId);
  res.status(202).json({ success: true, started: true, priceBookId });

  // Fire-and-forget; runExtractAll sets extract_status done/error. The frontend polls.
  runExtractAll(admin, GEMINI_API_KEY, priceBookId).catch((e) => console.error('[extract-all] background error:', e));
});

// Extract one table's grid (synchronous — Render has no request wall-clock cap).
app.post('/extract', requireUser, async (req, res) => {
  const { extractionId } = req.body || {};
  if (!extractionId) return res.status(400).json({ error: 'Missing extractionId' });
  try {
    const result = await runExtractTable(admin, GEMINI_API_KEY, extractionId);
    res.json({ success: true, extractionId, ...result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Compile ONE extracted table into canonical price/dependency rules (synchronous).
app.post('/compile', requireUser, async (req, res) => {
  const { extractionId } = req.body || {};
  if (!extractionId) return res.status(400).json({ error: 'Missing extractionId' });
  try {
    const result = await runCompileTable(admin, extractionId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Compile EVERY extracted table for a book into rules (synchronous; bounded by table count).
app.post('/compile-all', requireUser, async (req, res) => {
  const { priceBookId } = req.body || {};
  if (!priceBookId) return res.status(400).json({ error: 'Missing priceBookId' });
  const { data: book, error } = await admin.from('price_books').select('id').eq('id', priceBookId).single();
  if (error || !book) return res.status(404).json({ error: 'Price book not found' });
  try {
    const result = await runCompileAll(admin, priceBookId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Phase 2b — ingest a hardware catalog workbook (Hardware.xlsx) via the
// source-specific parser. Background (can touch hundreds of rows); poll
// price_books.extract_status.
app.post('/ingest-hardware', requireUser, async (req, res) => {
  const { priceBookId } = req.body || {};
  if (!priceBookId) return res.status(400).json({ error: 'Missing priceBookId' });
  const { data: book, error } = await admin.from('price_books').select('id').eq('id', priceBookId).single();
  if (error || !book) return res.status(404).json({ error: 'Price book not found' });

  await admin.from('price_books').update({ extract_status: 'processing', extract_error: null }).eq('id', priceBookId);
  res.status(202).json({ success: true, started: true, priceBookId });

  runIngestHardware(admin, priceBookId).catch(async (e) => {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[ingest-hardware] background error:', message);
    await admin.from('price_books').update({ extract_status: 'error', extract_error: message }).eq('id', priceBookId);
  });
});

const port = Number(PORT) || 8080;
// Bind explicitly to 0.0.0.0 (IPv4). Without a host, Node may bind IPv6-only
// (`::`), which Render's port scan can't detect → "no open ports detected" and
// the new deploy never takes over routing (stale build keeps serving).
const routes = app._router.stack
  .filter((l) => l.route)
  .map((l) => `${Object.keys(l.route.methods).join(',').toUpperCase()} ${l.route.path}`);
app.listen(port, '0.0.0.0', () => {
  console.log(`price-book-worker listening on 0.0.0.0:${port}`);
  console.log(`registered routes: ${routes.join(' | ')}`);
});
