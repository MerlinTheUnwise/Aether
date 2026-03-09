/**
 * Program Implementations Index
 *
 * Registers all program-specific implementations into the ImplementationRegistry.
 */

import type { RegisteredImplementation } from "../types.js";
import type { ImplementationRegistry } from "../registry.js";

// User Registration
import { validateEmailImpl, checkUniquenessImpl, createUserImpl } from "./user-registration.js";
// Product Recommendations
import { authenticateImpl, fetchHistoryImpl, generateRecommendationsImpl } from "./product-recommendations.js";
// Customer Support Agent
import { decideActionImpl, executeWithGuardImpl } from "./customer-support-agent.js";
// Payment Processing
import { validatePaymentImpl, authorizeCardImpl, captureFundsImpl, sendReceiptImpl } from "./payment-processing.js";
// Data Pipeline ETL
import { fetchRawDataImpl, validateSchemaImpl, cleanNullsImpl, deduplicateImpl as deduplicateEtlImpl, aggregateImpl as aggregateEtlImpl, writeOutputImpl } from "./data-pipeline-etl.js";
// Rate Limiter
import { checkQuotaImpl, incrementCounterImpl, enforceLimitImpl, resetWindowImpl } from "./rate-limiter.js";
// Content Moderation Agent
import { classifyContentImpl, assessSeverityImpl, decideModerationActionImpl, executeModerationImpl, logDecisionImpl } from "./content-moderation-agent.js";
// Order Lifecycle
import { createOrderImpl, processPaymentImpl, shipOrderImpl, confirmDeliveryImpl, handleCancellationImpl, processRefundImpl } from "./order-lifecycle.js";
// Multi-Scope Order
import { validateOrderImpl, checkInventoryImpl, processPaymentMSOImpl, createShipmentImpl, sendConfirmationImpl } from "./multi-scope-order.js";
// Scoped Ecommerce
import { loadCartImpl, validateStockImpl, applyDiscountsImpl, reserveInventoryImpl, chargePaymentImpl, createOrderRecordImpl, sendReceiptEcomImpl, trackAnalyticsImpl } from "./scoped-ecommerce.js";
// Multi-Agent Marketplace
import { listProductImpl, verifySellerImpl, calculateFeesImpl, browseCatalogImpl, placeOrderImpl, buyerReviewImpl, processMarketplacePaymentImpl, escrowHoldImpl, refundCheckImpl, createShipmentMktImpl, deliveryTrackingImpl, notifyPartiesImpl } from "./multi-agent-marketplace.js";
// Template Showcase
import { apiRouterImpl, responseBuilderImpl, validateInputImpl, createEntityImpl, readEntityImpl, validateTokenImpl, loadUserImpl, checkPermissionsImpl } from "./template-showcase.js";
// Intent Data Pipeline
import { fetchDataImpl, formatReportImpl, deliverImpl } from "./intent-data-pipeline.js";
// Sales Analytics Pipeline
import { fetchCsvDataImpl, validateRecordsImpl, cleanAndNormalizeImpl, detectAnomaliesImpl, calculateRevenueByRegionImpl, calculateTopProductsImpl, calculateGrowthTrendsImpl, generateReportImpl, archiveReportImpl, emailReportImpl } from "./sales-analytics.js";
// API Orchestration
import { authenticateUserImpl, checkInventoryApiImpl, processOrderPaymentImpl, createOrderRecordApiImpl, createShipmentApiImpl, sendOrderConfirmationImpl, respondSuccessImpl } from "./api-orchestration.js";

// ─── Helper to create RegisteredImplementation ──────────────────────────────────

function reg(id: string, fn: any, opts: Partial<import("../types.js").ImplementationMeta> = {}): RegisteredImplementation {
  return {
    meta: {
      id,
      description: opts.description ?? id,
      inputTypes: opts.inputTypes ?? {},
      outputTypes: opts.outputTypes ?? {},
      effects: opts.effects ?? [],
      pure: opts.pure ?? false,
      deterministic: opts.deterministic ?? true,
    },
    fn,
  };
}

// ─── All program implementations by exact ID ────────────────────────────────────

export function getProgramImplementations(): RegisteredImplementation[] {
  return [
    // User Registration
    reg("validate_email", validateEmailImpl, { pure: true }),
    reg("check_uniqueness", checkUniquenessImpl, { effects: ["database.read"] }),
    reg("create_user", createUserImpl, { effects: ["database.write"] }),

    // Product Recommendations
    reg("authenticate", authenticateImpl, { effects: ["database.read"] }),
    reg("fetch_history", fetchHistoryImpl, { effects: ["database.read", "cache.read_write"] }),
    reg("generate_recommendations", generateRecommendationsImpl, { effects: ["ml_model.infer"] }),

    // Customer Support Agent
    reg("decide_action", decideActionImpl, { effects: ["database"] }),
    reg("execute_with_guard", executeWithGuardImpl, { effects: ["database", "email", "ticketing"] }),

    // Payment Processing
    reg("validate_payment", validatePaymentImpl, { pure: true }),
    reg("authorize_card", authorizeCardImpl, { effects: ["payment_gateway.write"] }),
    reg("capture_funds", captureFundsImpl, { effects: ["payment_gateway.write", "database.write"] }),
    reg("send_receipt", sendReceiptImpl, { effects: ["email"] }),

    // Data Pipeline ETL
    reg("fetch_raw_data", fetchRawDataImpl, { effects: ["database.read"] }),
    reg("validate_schema", validateSchemaImpl, { pure: true }),
    reg("clean_nulls", cleanNullsImpl, { pure: true }),
    reg("deduplicate", deduplicateEtlImpl, { pure: true }),
    reg("aggregate", aggregateEtlImpl, { pure: true }),
    reg("write_output", writeOutputImpl, { effects: ["database.write", "filesystem"] }),

    // Rate Limiter
    reg("check_quota", checkQuotaImpl, { pure: true }),
    reg("increment_counter", incrementCounterImpl, { effects: ["database.write"] }),
    reg("enforce_limit", enforceLimitImpl, { effects: ["database.read"] }),
    reg("reset_window", resetWindowImpl, { effects: ["database.write"] }),

    // Content Moderation Agent
    reg("classify_content", classifyContentImpl, { effects: ["ml_model.infer"] }),
    reg("assess_severity", assessSeverityImpl, { effects: ["ml_model.infer"] }),
    // Note: decide_action already registered above for customer support; content moderation uses different ID
    reg("decide_moderation_action", decideModerationActionImpl, { effects: ["database.read"] }),
    reg("execute_moderation", executeModerationImpl, { effects: ["database.write"] }),
    reg("log_decision", logDecisionImpl, { effects: ["database.write"] }),

    // Order Lifecycle
    reg("create_order", createOrderImpl, { effects: ["database.write"] }),
    reg("process_payment", processPaymentImpl, { effects: ["payment_gateway.write", "database.write"] }),
    reg("ship_order", shipOrderImpl, { effects: ["shipping.write", "database.write"] }),
    reg("confirm_delivery", confirmDeliveryImpl, { effects: ["database.write", "email"] }),
    reg("handle_cancellation", handleCancellationImpl, { effects: ["database.write", "email"] }),
    reg("process_refund", processRefundImpl, { effects: ["payment_gateway.write", "database.write", "email"] }),

    // Multi-Scope Order
    reg("validate_order", validateOrderImpl, { pure: true }),
    reg("check_inventory", checkInventoryImpl, { effects: ["database.read", "database.write"] }),
    reg("process_payment_mso", processPaymentMSOImpl, { effects: ["payment_gateway.write"] }),
    reg("create_shipment", createShipmentImpl, { effects: ["shipping.write", "database.write"] }),
    reg("send_confirmation", sendConfirmationImpl, { effects: ["email"] }),

    // Scoped Ecommerce
    reg("load_cart", loadCartImpl, { effects: ["database.read", "cache.read"] }),
    reg("validate_stock", validateStockImpl, { effects: ["database.read"] }),
    reg("apply_discounts", applyDiscountsImpl, { pure: true }),
    reg("reserve_inventory", reserveInventoryImpl, { effects: ["database.write"] }),
    reg("charge_payment", chargePaymentImpl, { effects: ["payment_gateway.write"] }),
    reg("create_order_record", createOrderRecordImpl, { effects: ["database.write"] }),
    reg("send_receipt_ecom", sendReceiptEcomImpl, { effects: ["email"] }),
    reg("track_analytics", trackAnalyticsImpl, { effects: ["analytics.write"] }),

    // Multi-Agent Marketplace
    reg("list_product", listProductImpl, { effects: ["database.write"] }),
    reg("verify_seller", verifySellerImpl, { effects: ["database.read"] }),
    reg("calculate_fees", calculateFeesImpl, { pure: true }),
    reg("browse_catalog", browseCatalogImpl, { effects: ["database.read"] }),
    reg("place_order", placeOrderImpl, { effects: ["database.write"] }),
    reg("buyer_review", buyerReviewImpl, { effects: ["database.write"] }),
    reg("process_marketplace_payment", processMarketplacePaymentImpl, { effects: ["payment_gateway.write"] }),
    reg("escrow_hold", escrowHoldImpl, { effects: ["payment_gateway.write", "database.write"] }),
    reg("refund_check", refundCheckImpl, { pure: true }),
    reg("create_shipment_mkt", createShipmentMktImpl, { effects: ["shipping.write", "database.write"] }),
    reg("delivery_tracking", deliveryTrackingImpl, { effects: ["database.read", "notification"] }),
    reg("notify_parties", notifyPartiesImpl, { effects: ["email", "notification"] }),

    // Template Showcase
    reg("api_router", apiRouterImpl, { pure: true }),
    reg("response_builder", responseBuilderImpl, { pure: true }),
    // Template instances get prefixed IDs (user_crud_validate_input, etc.)
    reg("validate_input", validateInputImpl, { pure: true }),
    reg("create_entity", createEntityImpl, { effects: ["database.write"] }),
    reg("read_entity", readEntityImpl, { effects: ["database.read"] }),
    reg("validate_token", validateTokenImpl, { effects: ["auth.verify"] }),
    reg("load_user", loadUserImpl, { effects: ["auth.verify"] }),
    reg("check_permissions", checkPermissionsImpl, { effects: ["auth.verify"] }),

    // Intent Data Pipeline
    reg("fetch_data", fetchDataImpl, { effects: ["database.read"] }),
    reg("format_report", formatReportImpl, { pure: true }),
    reg("deliver", deliverImpl, { effects: ["email"] }),

    // Sales Analytics Pipeline
    reg("fetch_csv_data", fetchCsvDataImpl, { effects: ["filesystem.read"] }),
    reg("validate_records", validateRecordsImpl, { pure: true }),
    reg("clean_and_normalize", cleanAndNormalizeImpl, { pure: true }),
    reg("detect_anomalies", detectAnomaliesImpl, { effects: ["ml_model.infer"] }),
    reg("calculate_revenue_by_region", calculateRevenueByRegionImpl, { pure: true }),
    reg("calculate_top_products", calculateTopProductsImpl, { pure: true }),
    reg("calculate_growth_trends", calculateGrowthTrendsImpl, { pure: true }),
    reg("generate_report", generateReportImpl, { pure: true }),
    reg("archive_report", archiveReportImpl, { effects: ["filesystem.write"] }),
    reg("email_report", emailReportImpl, { effects: ["email"] }),

    // API Orchestration
    reg("authenticate_user", authenticateUserImpl, { effects: ["auth.verify"] }),
    reg("check_inventory_api", checkInventoryApiImpl, { effects: ["database.read", "database.write"] }),
    reg("process_order_payment", processOrderPaymentImpl, { effects: ["payment_gateway.write"] }),
    reg("create_order_record_api", createOrderRecordApiImpl, { effects: ["database.write"] }),
    reg("create_shipment_api", createShipmentApiImpl, { effects: ["shipping.write", "database.write"] }),
    reg("send_order_confirmation", sendOrderConfirmationImpl, { effects: ["email"] }),
    reg("respond_success", respondSuccessImpl, { pure: true }),
  ];
}

/**
 * Register all program implementations into a registry.
 * Uses both exact ID and pattern matching for template-prefixed IDs.
 */
export function registerProgramImplementations(registry: ImplementationRegistry): void {
  const impls = getProgramImplementations();
  for (const impl of impls) {
    registry.registerById(impl.meta.id, impl);
  }

  // Pattern registrations for common prefixes
  // Template instances use prefixed IDs (e.g., user_crud_validate_input)
  for (const impl of impls) {
    registry.registerByPattern(new RegExp(`_${impl.meta.id}$`), impl);
  }
}
