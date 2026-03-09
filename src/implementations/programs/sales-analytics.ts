/**
 * Program implementations: sales-analytics
 * 10 nodes: fetch_csv_data, validate_records, clean_and_normalize, detect_anomalies,
 * calculate_revenue_by_region, calculate_top_products, calculate_growth_trends,
 * generate_report, archive_report, email_report
 */

import type { NodeImplementation } from "../types.js";
import type { AetherFileSystem } from "../services/filesystem.js";
import type { AetherEmailService } from "../services/email.js";

export const fetchCsvDataImpl: NodeImplementation = async (inputs, context) => {
  const filePath = (inputs.file_path ?? "sales.csv").toString();

  const fs = context.getService!<AetherFileSystem>("filesystem");
  context.reportEffect("filesystem.read");

  const raw_data = await fs.readCSV(filePath);

  return { raw_data };
};

export const validateRecordsImpl: NodeImplementation = async (inputs) => {
  const raw_data: any[] = inputs.raw_data ?? [];

  const valid: any[] = [];
  const invalid: any[] = [];

  for (const record of raw_data) {
    const hasAmount = record.amount !== undefined && record.amount !== "" && record.amount !== null;
    const hasProductId = record.product_id !== undefined && record.product_id !== "" && record.product_id !== null;
    const hasDate = record.date !== undefined && record.date !== "" && record.date !== null;

    if (hasAmount && hasProductId && hasDate) {
      valid.push(record);
    } else {
      invalid.push(record);
    }
  }

  return { valid, invalid };
};

export const cleanAndNormalizeImpl: NodeImplementation = async (inputs) => {
  const valid: any[] = inputs.valid ?? [];

  // Deduplicate by transaction_id
  const seen = new Set<string>();
  const deduped: any[] = [];
  for (const record of valid) {
    const key = String(record.transaction_id);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(record);
  }

  // Normalize: convert negative amounts to absolute with refund flag
  const cleaned = deduped.map((record: any) => {
    const amount = Number(record.amount);
    return {
      ...record,
      amount: Math.abs(amount),
      is_refund: amount < 0,
    };
  });

  return { cleaned };
};

export const detectAnomaliesImpl: NodeImplementation = async (inputs, context) => {
  const cleaned: any[] = inputs.cleaned ?? [];

  context.reportEffect("ml_model.infer");

  // Rule-based anomaly detection:
  // 1. Future dates
  // 2. Amounts > 3 standard deviations from mean
  const amounts = cleaned.map((r: any) => Number(r.amount)).filter((a: number) => !isNaN(a));
  const mean = amounts.reduce((s: number, a: number) => s + a, 0) / (amounts.length || 1);
  const variance = amounts.reduce((s: number, a: number) => s + (a - mean) ** 2, 0) / (amounts.length || 1);
  const stddev = Math.sqrt(variance);
  const threshold = mean + 3 * stddev;

  const now = new Date();
  const data: any[] = [];
  const anomalies: any[] = [];

  for (const record of cleaned) {
    const date = new Date(record.date);
    const amount = Number(record.amount);

    const isFutureDate = date > now;
    const isAmountAnomaly = amount > threshold;

    if (isFutureDate || isAmountAnomaly) {
      anomalies.push({ ...record, anomaly_reason: isFutureDate ? "future_date" : "amount_outlier" });
    } else {
      data.push(record);
    }
  }

  return { data, anomalies };
};

export const calculateRevenueByRegionImpl: NodeImplementation = async (inputs) => {
  const data: any[] = inputs.data ?? [];

  const groups = new Map<string, { region: string; total_revenue: number; transaction_count: number }>();

  for (const record of data) {
    const region = String(record.region ?? "Unknown");
    const amount = Number(record.amount ?? 0);
    const existing = groups.get(region) ?? { region, total_revenue: 0, transaction_count: 0 };
    existing.total_revenue = Math.round((existing.total_revenue + amount) * 100) / 100;
    existing.transaction_count++;
    groups.set(region, existing);
  }

  const revenue_by_region = [...groups.values()];

  return { revenue_by_region };
};

export const calculateTopProductsImpl: NodeImplementation = async (inputs) => {
  const data: any[] = inputs.data ?? [];

  const groups = new Map<string, { product_id: string; product_name: string; revenue: number; units_sold: number }>();

  for (const record of data) {
    const pid = String(record.product_id ?? "unknown");
    const existing = groups.get(pid) ?? { product_id: pid, product_name: String(record.product_name ?? ""), revenue: 0, units_sold: 0 };
    existing.revenue = Math.round((existing.revenue + Number(record.amount ?? 0)) * 100) / 100;
    existing.units_sold++;
    groups.set(pid, existing);
  }

  const top_products = [...groups.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  return { top_products };
};

export const calculateGrowthTrendsImpl: NodeImplementation = async (inputs) => {
  const data: any[] = inputs.data ?? [];

  const monthly = new Map<string, { month: string; revenue: number; transaction_count: number }>();

  for (const record of data) {
    const date = String(record.date ?? "");
    const month = date.substring(0, 7); // "YYYY-MM"
    const amount = Number(record.amount ?? 0);
    const existing = monthly.get(month) ?? { month, revenue: 0, transaction_count: 0 };
    existing.revenue = Math.round((existing.revenue + amount) * 100) / 100;
    existing.transaction_count++;
    monthly.set(month, existing);
  }

  const sorted = [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month));

  // Compute month-over-month growth
  const trends = sorted.map((entry, i) => {
    const prevRevenue = i > 0 ? sorted[i - 1].revenue : 0;
    const growth = i > 0 && prevRevenue > 0
      ? Math.round(((entry.revenue - prevRevenue) / prevRevenue) * 10000) / 100
      : 0;
    return { ...entry, growth_pct: growth };
  });

  return { trends };
};

export const generateReportImpl: NodeImplementation = async (inputs) => {
  const revenue_by_region = inputs.revenue_by_region ?? [];
  const top_products = inputs.top_products ?? [];
  const trends = inputs.trends ?? [];
  const anomalies = inputs.anomalies ?? [];

  const totalRevenue = revenue_by_region.reduce((s: number, r: any) => s + (r.total_revenue ?? 0), 0);
  const totalTransactions = revenue_by_region.reduce((s: number, r: any) => s + (r.transaction_count ?? 0), 0);

  const report = {
    generated_at: new Date().toISOString(),
    summary: {
      total_revenue: Math.round(totalRevenue * 100) / 100,
      total_transactions: totalTransactions,
      regions_covered: revenue_by_region.length,
      anomalies_detected: anomalies.length,
    },
    revenue_by_region,
    top_products,
    growth_trends: trends,
    anomalies,
    sections_count: 4,
  };

  return { report };
};

export const archiveReportImpl: NodeImplementation = async (inputs, context) => {
  const report = inputs.report ?? {};

  const fs = context.getService!<AetherFileSystem>("filesystem");
  context.reportEffect("filesystem.write");

  const path = `/reports/sales-analytics-${Date.now()}.json`;
  await fs.writeFile(path, JSON.stringify(report, null, 2));

  return { archived: true, path };
};

export const emailReportImpl: NodeImplementation = async (inputs, context) => {
  const report = inputs.report ?? {};

  const emailService = context.getService!<AetherEmailService>("email");
  context.reportEffect("email");

  await emailService.send({
    to: ["analytics-team@company.com"],
    from: "noreply@aether-pipeline.com",
    subject: `Sales Analytics Report — ${report.summary?.total_transactions ?? 0} transactions`,
    body: `Revenue: $${report.summary?.total_revenue ?? 0}\nAnomalies: ${report.summary?.anomalies_detected ?? 0}`,
  });

  return { sent: true };
};
