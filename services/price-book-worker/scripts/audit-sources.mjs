#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  auditPriceBookSource,
  summarizeSourceAudit,
} from '../src/source-audit.js';

function parseArgs(argv) {
  const files = [];
  let output = null;
  let includePaths = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--output') {
      output = argv[++i] ?? null;
    } else if (arg === '--include-paths') {
      includePaths = true;
    } else if (arg === '--help' || arg === '-h') {
      return { help: true, files: [], output: null, includePaths: false };
    } else {
      files.push(arg);
    }
  }
  return { help: false, files, output, includePaths };
}

function usage() {
  return [
    'Usage: npm run audit:sources -- [--output report.json] [--include-paths] <source files...>',
    '',
    'Audits PDF fingerprints/page counts and normalized hardware/NGP workbook contracts.',
    'Exits non-zero when a source is corrupt, incomplete, or a production input uses the wrong lane.',
  ].join('\n');
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args.files.length === 0) {
  console.log(usage());
  process.exitCode = args.help ? 0 : 2;
} else {
  const entries = [];
  for (const inputPath of args.files) {
    const bytes = new Uint8Array(await fs.readFile(inputPath));
    const entry = await auditPriceBookSource({
      bytes,
      fileName: path.basename(inputPath),
    });
    entries.push(args.includePaths ? { ...entry, inputPath: path.resolve(inputPath) } : entry);
  }
  const report = summarizeSourceAudit(entries);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args.output) {
    const outputPath = path.resolve(args.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, json);
  }
  process.stdout.write(json);
  if (!report.passed) process.exitCode = 1;
}
