/**
 * Internal engine types (Phase 3): the loaded rule graph and the engine's
 * output shape (lines + manual-quote routes + warnings + rolled-up totals).
 */

import type {
  PriceRule,
  RuleCondition,
  RuleActionParameter,
  IncludedScope,
  QuantityTier,
  DependencyRule,
  EstimateLineType,
  EstimateLinePriceStatus,
  ManualQuoteReason,
  RuleEntityType,
} from '@/types';

/** A price rule with everything the engine needs to resolve it in one object. */
export interface LoadedPriceRule extends PriceRule {
  conditions: RuleCondition[];
  actionParameters: RuleActionParameter[];
  includedScopes: IncludedScope[];
  quantityTiers: QuantityTier[];
}

/** One resolved estimate line ready to map onto `estimate_line`. */
export interface EngineLine {
  lineType: EstimateLineType;
  priceRuleId: string | null;
  entityType: RuleEntityType;
  chargeCategory: string | null;
  description: string;
  selectedOptionCode: string | null;
  quantity: number;
  unitOfMeasure: string | null;
  unitListPrice: number | null;
  extendedListPrice: number | null;
  discountMultiplier: number | null;
  extendedNetPrice: number | null;
  sellPrice: number | null;
  grossMargin: number | null;
  grossMarginPct: number | null;
  priceStatus: EstimateLinePriceStatus;
  calculationExpression: string;
  matchedConditions: Record<string, unknown> | null;
  includedOrSuppressedBy: string | null;
  sourcePage: string | null;
  sourceRegionId: string | null;
  priceBookId: string | null;
  confidence: number | null;
  exceptionMessage: string | null;
  componentId: string | null;
  sortOrder: number;
}

export interface EngineManualQuote {
  componentId: string | null;
  priceRuleId: string | null;
  reason: ManualQuoteReason;
  requestedInputs: string | null;
}

export interface EngineTotals {
  listTotal: number;
  netTotal: number;
  sellTotal: number;
  /** Lines that carry an unresolved exception (CF / missing price / external). */
  exceptionCount: number;
  manualQuoteCount: number;
}

export interface EngineResult {
  lines: EngineLine[];
  manualQuotes: EngineManualQuote[];
  /** Dependency-rule outcomes surfaced to the builder (warn vs block). */
  dependencyResults: DependencyOutcome[];
  warnings: string[];
  totals: EngineTotals;
}

export interface DependencyOutcome {
  rule: DependencyRule;
  message: string;
  /** True when severity blocks pricing/order. */
  blocking: boolean;
}

/** Result of resolving a single action into a money value + status. */
export interface ActionResolution {
  amount: number | null;
  status: EstimateLinePriceStatus;
  lineType: EstimateLineType;
  expression: string;
  manualReason: ManualQuoteReason | null;
  exceptionMessage: string | null;
}
