import { createHash } from 'node:crypto';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { getPdfPageCount } from './pdf.js';
import {
  getPriceBookProfile,
  identifyPriceBookProfile,
} from './profiles.js';
import {
  isNormalizedHardwareWorkbook,
  summarizeNormalizedHardwareWorkbook,
} from './hardware.js';
import {
  isNormalizedNgpWorkbook,
  summarizeNgpWorkbook,
} from './ngp.js';

const WORKBOOK_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);

function fileTypeFromName(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === '.pdf') return 'pdf';
  if (extension === '.csv') return 'csv';
  if (extension === '.xlsx' || extension === '.xls') return 'xlsx';
  return 'unknown';
}

function workbookFromBytes(bytes, fileType) {
  if (fileType === 'csv') {
    return XLSX.read(new TextDecoder('utf-8', { fatal: false }).decode(bytes), {
      type: 'string',
      raw: false,
    });
  }
  return XLSX.read(bytes, { type: 'buffer', raw: false, cellDates: false });
}

/**
 * Pure source audit over file bytes. It proves source identity/integrity and,
 * for normalized workbooks, runs the same preflight used immediately before DB
 * writes.
 */
export async function auditPriceBookSource({ bytes, fileName }) {
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const sourceSha256 = createHash('sha256').update(buffer).digest('hex');
  const fileType = fileTypeFromName(fileName);
  const profile = identifyPriceBookProfile({ sha256: sourceSha256, fileName });
  const knownSource = profile?.knownSources.find((source) => source.sha256 === sourceSha256) ?? null;
  const errors = [];
  const warnings = [];
  let pageCount = null;
  let workbookKind = null;
  let preflight = null;

  if (fileType === 'pdf') {
    try {
      pageCount = await getPdfPageCount(buffer);
    } catch (error) {
      errors.push(`PDF could not be opened: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (knownSource?.pageCount != null && pageCount !== knownSource.pageCount) {
      errors.push(`Known source expects ${knownSource.pageCount} pages; file contains ${pageCount ?? 'none'}.`);
    }
  } else if (WORKBOOK_EXTENSIONS.has(path.extname(fileName).toLowerCase())) {
    try {
      const wb = workbookFromBytes(buffer, fileType);
      if (isNormalizedHardwareWorkbook(wb)) {
        workbookKind = 'hardware_normalized_workbook';
        preflight = summarizeNormalizedHardwareWorkbook(wb);
      } else if (isNormalizedNgpWorkbook(wb)) {
        workbookKind = 'ngp_normalized_workbook';
        preflight = summarizeNgpWorkbook(wb);
      } else {
        errors.push('Workbook does not match the normalized hardware or NGP sheet contract.');
      }
      if (preflight?.valid === false) errors.push(...(preflight.errors ?? []));
      if (Array.isArray(preflight?.warnings)) warnings.push(...preflight.warnings);
    } catch (error) {
      errors.push(`Workbook could not be opened: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    errors.push(`Unsupported source type for "${fileName}".`);
  }

  if (!profile) {
    warnings.push('No governed source profile matched this file.');
  } else if (!knownSource) {
    warnings.push(`Matched profile ${profile.key} by filename/vendor alias, but this exact SHA-256 is not registered.`);
  }

  const role = knownSource?.role ?? 'unregistered_revision';
  const laneMatches = !profile
    ? false
    : profile.ingestionLane === 'pdf_rule_compiler'
      ? fileType === 'pdf'
      : profile.ingestionLane === workbookKind;
  const productionReady = errors.length === 0 &&
    role !== 'source_evidence' &&
    laneMatches &&
    (preflight == null || preflight.valid === true);
  const verificationPassed = errors.length === 0;

  return {
    fileName,
    fileType,
    byteSize: buffer.byteLength,
    sha256: sourceSha256,
    profileKey: profile?.key ?? null,
    profileVersion: profile?.version ?? null,
    manufacturer: profile?.manufacturer ?? null,
    effectiveDate: knownSource?.effectiveDate ?? null,
    sourceIdentity: knownSource ? 'exact_sha256' : profile ? 'profile_alias' : 'unmatched',
    role,
    ingestionLane: profile?.ingestionLane ?? null,
    workbookKind,
    pageCount,
    expectedPageCount: knownSource?.pageCount ?? null,
    verificationPassed,
    productionReady,
    errors,
    warnings,
    preflight,
  };
}

export function summarizeSourceAudit(entries, generatedAt = new Date().toISOString()) {
  const productionInputs = entries.filter((entry) => entry.role !== 'source_evidence');
  return {
    schemaVersion: '1.0',
    generatedAt,
    passed: entries.every((entry) => entry.verificationPassed) &&
      productionInputs.every((entry) => entry.productionReady),
    sourceCount: entries.length,
    exactSourceCount: entries.filter((entry) => entry.sourceIdentity === 'exact_sha256').length,
    productionInputCount: productionInputs.length,
    productionReadyCount: productionInputs.filter((entry) => entry.productionReady).length,
    evidenceSourceCount: entries.filter((entry) => entry.role === 'source_evidence').length,
    entries,
  };
}

/** Resolve one registered profile for operator tooling/tests. */
export function registeredProfile(profileKey) {
  return getPriceBookProfile(profileKey);
}
