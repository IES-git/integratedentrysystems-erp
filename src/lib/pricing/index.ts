/**
 * Phase 3 rule-based pricing engine — public surface.
 *
 * Supersedes the procedural grid engine in `src/lib/pricing-lookup.ts` (kept
 * read-only for legacy grid consumers until the Phase 6 cutover).
 */

export * from './spec';
export * from './engine-types';
export {
  priceOpening,
  priceOpeningCore,
  persistEngineResult,
  resolveActivePriceBookDocument,
} from './engine';
export {
  loadRuleSet,
  loadHardwareCatalog,
  loadVariantsWithPrices,
  type HardwareCatalog,
  type LoadedRuleSet,
  type VariantWithPrice,
} from './loader';
export {
  generateHardwareRequirements,
  selectSetTemplate,
  derivePrepRequirements,
  matchCrosswalk,
  pickSellRule,
  computeSell,
  resolveHardwareNet,
  MAX_PLAUSIBLE_HARDWARE_NET,
  requiresDoorFramePrep,
  SURFACE_MOUNTED_CATEGORIES,
  type PrepRequirement,
} from './hardware';
export { evalQuantityFormula } from './quantity';
