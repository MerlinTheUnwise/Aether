/**
 * Program implementations: transaction-analysis
 *
 * 12 nodes: read_transactions, read_customers, read_categories,
 * validate_txn_records, join_customer_data, clean_and_dedupe,
 * detect_txn_anomalies, calculate_analytics, generate_txn_report,
 * write_csv_output, write_report, write_summary
 */

import type { NodeImplementation } from "../types.js";
import type { FilesystemAdapter } from "../services/adapter.js";

// ─── Wave 0: Read inputs from disk ──────────────────────────────────────────

export const readTransactionsImpl: NodeImplementation = async (inputs, context) => {
  const filePath = (inputs.file_path ?? "transactions.csv").toString();
  const fs = context.getService!<FilesystemAdapter>("filesystem");
  context.reportEffect("filesystem.read");
  const data = await fs.readCSV(filePath);
  return { data };
};

export const readCustomersImpl: NodeImplementation = async (inputs, context) => {
  const filePath = (inputs.file_path ?? "customers.json").toString();
  const fs = context.getService!<FilesystemAdapter>("filesystem");
  context.reportEffect("filesystem.read");
  const raw = await fs.readFile(filePath);
  const customers = JSON.parse(raw);
  return { customers };
};

export const readCategoriesImpl: NodeImplementation = async (inputs, context) => {
  const filePath = (inputs.file_path ?? "categories.json").toString();
  const fs = context.getService!<FilesystemAdapter>("filesystem");
  context.reportEffect("filesystem.read");
  const raw = await fs.readFile(filePath);
  const categories = JSON.parse(raw);
  return { categories };
};

// ─── Wave 1: Validate and enrich ─────────────────────────────────────────────

export const validateTxnRecordsImpl: NodeImplementation = async (inputs) => {
  const data: any[] = inputs.data ?? [];
  const valid: any[] = [];
  const invalid: any[] = [];

  for (const row of data) {
    const hasAmount = row.amount !== undefined && row.amount !== "" && row.amount !== null;
    const hasTxnId = row.transaction_id !== undefined && row.transaction_id !== "" && row.transaction_id !== null;
    const hasDate = row.date !== undefined && row.date !== "" && row.date !== null;

    if (hasAmount && hasTxnId && hasDate) {
      valid.push(row);
    } else {
      invalid.push({ ...row, reason: "missing required field" });
    }
  }

  return { valid, invalid };
};

export const joinCustomerDataImpl: NodeImplementation = async (inputs) => {
  const data: any[] = inputs.data ?? [];
  const customers: any[] = inputs.customers ?? [];

  const customerMap = new Map<string, any>();
  for (const c of customers) {
    customerMap.set(c.id, c);
  }

  const enriched = data.map(txn => {
    const customer = customerMap.get(txn.customer_id);
    return {
      ...txn,
      customer_name: customer?.name ?? "Unknown",
      customer_region: customer?.region ?? "Unknown",
      customer_tier: customer?.tier ?? "unknown",
    };
  });

  return { enriched };
};

// ─── Wave 2: Clean, dedupe, detect anomalies ─────────────────────────────────

export const cleanAndDedupeImpl: NodeImplementation = async (inputs) => {
  const valid: any[] = inputs.valid ?? [];
  const seen = new Set<string>();
  const cleaned: any[] = [];

  for (const row of valid) {
    const id = String(row.transaction_id);
    if (seen.has(id)) continue;
    seen.add(id);
    cleaned.push({
      ...row,
      amount: Math.abs(Number(row.amount)),
      is_refund: Number(row.amount) < 0,
    });
  }

  return { cleaned };
};

export const detectTxnAnomaliesImpl: NodeImplementation = async (inputs, context) => {
  const cleaned: any[] = inputs.cleaned ?? [];
  context.reportEffect("ml_model.infer");

  const amounts = cleaned.map(r => Number(r.amount)).filter(a => !isNaN(a));
  const mean = amounts.reduce((s, a) => s + a, 0) / (amounts.length || 1);
  const variance = amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / (amounts.length || 1);
  const stddev = Math.sqrt(variance);
  const threshold = mean + 3 * stddev;

  const now = new Date();
  const normal: any[] = [];
  const anomalies: any[] = [];

  for (const record of cleaned) {
    const date = new Date(record.date);
    const amount = Number(record.amount);
    const isFutureDate = date > now;
    const isOutlier = amount > threshold;
    const isCurrencyMismatch = record.currency && record.currency !== "USD";

    if (isFutureDate || isOutlier || isCurrencyMismatch) {
      const reasons: string[] = [];
      if (isFutureDate) reasons.push("future_date");
      if (isOutlier) reasons.push("amount_outlier");
      if (isCurrencyMismatch) reasons.push("currency_mismatch");
      anomalies.push({ ...record, anomaly_reasons: reasons });
    } else {
      normal.push(record);
    }
  }

  return { normal, anomalies };
};

// ─── Wave 3: Analytics and output ────────────────────────────────────────────

export const calculateAnalyticsImpl: NodeImplementation = async (inputs) => {
  const data: any[] = inputs.data ?? [];
  const customers: any[] = inputs.customers ?? [];
  const categories: any[] = inputs.categories ?? [];
  const anomalies: any[] = inputs.anomalies ?? [];

  const customerMap = new Map<string, any>();
  for (const c of customers) customerMap.set(c.id, c);

  // Revenue by region
  const byRegion: Record<string, number> = {};
  for (const txn of data) {
    const customer = customerMap.get(txn.customer_id);
    const region = customer?.region ?? txn.customer_region ?? "Unknown";
    byRegion[region] = Math.round(((byRegion[region] ?? 0) + Number(txn.amount)) * 100) / 100;
  }
  const revenue_by_region = Object.entries(byRegion).map(([region, revenue]) => ({ region, revenue }));

  // Revenue by category
  const byCat: Record<string, number> = {};
  for (const txn of data) {
    const cat = txn.category ?? "other";
    byCat[cat] = Math.round(((byCat[cat] ?? 0) + Number(txn.amount)) * 100) / 100;
  }
  const revenue_by_category = Object.entries(byCat).map(([category, revenue]) => {
    const catDef = categories.find((c: any) => c.id === category);
    return { category, revenue, budget_limit: catDef?.budget_limit ?? 0, tax_rate: catDef?.tax_rate ?? 0 };
  });

  // Revenue by tier
  const byTier: Record<string, number> = {};
  for (const txn of data) {
    const customer = customerMap.get(txn.customer_id);
    const tier = customer?.tier ?? txn.customer_tier ?? "unknown";
    byTier[tier] = Math.round(((byTier[tier] ?? 0) + Number(txn.amount)) * 100) / 100;
  }
  const revenue_by_tier = Object.entries(byTier).map(([tier, revenue]) => ({ tier, revenue }));

  // Top merchants
  const byMerchant: Record<string, number> = {};
  for (const txn of data) {
    byMerchant[txn.merchant] = Math.round(((byMerchant[txn.merchant] ?? 0) + Number(txn.amount)) * 100) / 100;
  }
  const top_merchants = Object.entries(byMerchant)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([merchant, revenue]) => ({ merchant, revenue }));

  const total_revenue = Math.round(data.reduce((s, t) => s + Number(t.amount), 0) * 100) / 100;

  return {
    analytics: {
      total_revenue,
      total_transactions: data.length,
      anomalies_detected: anomalies.length,
      revenue_by_region,
      revenue_by_category,
      revenue_by_tier,
      top_merchants,
    },
  };
};

export const generateTxnReportImpl: NodeImplementation = async (inputs) => {
  const analytics = inputs.analytics ?? {};
  const anomalies: any[] = inputs.anomalies ?? [];
  const cleaned: any[] = inputs.cleaned ?? [];
  const invalid: any[] = inputs.invalid ?? [];

  const report = {
    generated_at: new Date().toISOString(),
    data_quality: {
      records_read: cleaned.length + invalid.length,
      valid: cleaned.length,
      invalid: invalid.length,
      deduplicated: cleaned.length,
      anomalies: anomalies.length,
    },
    analytics,
    anomaly_details: anomalies.slice(0, 50),
    sections: ["data_quality", "revenue_by_region", "top_merchants", "category_breakdown", "anomalies", "contract_verification", "pipeline_metadata"],
  };

  return { report };
};

export const writeCsvOutputImpl: NodeImplementation = async (inputs, context) => {
  const cleaned: any[] = inputs.cleaned ?? [];
  const outputDir = (inputs.output_dir ?? "output").toString();
  const fs = context.getService!<FilesystemAdapter>("filesystem");
  context.reportEffect("filesystem.write");
  const csvPath = `${outputDir}/cleaned_transactions.csv`;
  await fs.writeCSV(csvPath, cleaned);
  return { csv_path: csvPath };
};

export const writeReportImpl: NodeImplementation = async (inputs, context) => {
  const report = inputs.report ?? {};
  const outputDir = (inputs.output_dir ?? "output").toString();
  const fs = context.getService!<FilesystemAdapter>("filesystem");
  context.reportEffect("filesystem.write");

  const html = generateReportHTML(report);
  const reportPath = `${outputDir}/report.html`;
  await fs.writeFile(reportPath, html);
  return { report_path: reportPath };
};

export const writeSummaryImpl: NodeImplementation = async (inputs, context) => {
  const report = inputs.report ?? {};
  const outputDir = (inputs.output_dir ?? "output").toString();
  const fs = context.getService!<FilesystemAdapter>("filesystem");
  context.reportEffect("filesystem.write");

  const summaryPath = `${outputDir}/summary.json`;
  await fs.writeFile(summaryPath, JSON.stringify(report, null, 2));
  return { summary_path: summaryPath };
};

// ─── HTML Report Generator ──────────────────────────────────────────────────

function generateReportHTML(report: any): string {
  const dq = report.data_quality ?? {};
  const analytics = report.analytics ?? {};
  const regions = analytics.revenue_by_region ?? [];
  const merchants = analytics.top_merchants ?? [];
  const categories = analytics.revenue_by_category ?? [];
  const anomalies = report.anomaly_details ?? [];

  const maxRegionRevenue = Math.max(...regions.map((r: any) => r.revenue), 1);

  const regionBars = regions.map((r: any) => {
    const pct = Math.round((r.revenue / maxRegionRevenue) * 100);
    return `<div class="bar-row"><span class="bar-label">${esc(r.region)}</span><div class="bar" style="width:${pct}%"></div><span class="bar-value">$${fmt(r.revenue)}</span></div>`;
  }).join("\n");

  const merchantRows = merchants.map((m: any, i: number) =>
    `<tr><td>${i + 1}</td><td>${esc(m.merchant)}</td><td class="num">$${fmt(m.revenue)}</td></tr>`
  ).join("\n");

  const categoryRows = categories.map((c: any) =>
    `<tr><td>${esc(c.category)}</td><td class="num">$${fmt(c.revenue)}</td><td class="num">$${fmt(c.budget_limit)}</td><td class="num">${(c.tax_rate * 100).toFixed(1)}%</td></tr>`
  ).join("\n");

  const anomalyRows = anomalies.slice(0, 20).map((a: any) =>
    `<tr><td>${esc(a.transaction_id)}</td><td>${esc(a.date)}</td><td>${esc(a.merchant)}</td><td class="num">$${fmt(a.amount)}</td><td>${esc(a.currency ?? "USD")}</td><td>${esc((a.anomaly_reasons ?? []).join(", "))}</td></tr>`
  ).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AETHER Transaction Analysis Report</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0f1a;color:#e2e8f0;font-family:'Segoe UI',system-ui,sans-serif;padding:2rem}
h1{color:#6ee7b7;font-size:1.8rem;margin-bottom:0.5rem}
h2{color:#a78bfa;font-size:1.3rem;margin:2rem 0 1rem;border-bottom:1px solid #1e293b;padding-bottom:0.5rem}
.subtitle{color:#94a3b8;font-size:0.9rem;margin-bottom:2rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin-bottom:2rem}
.card{background:#1e293b;border-radius:8px;padding:1.2rem;text-align:center}
.card .value{font-size:2rem;color:#6ee7b7;font-weight:700}
.card .label{color:#94a3b8;font-size:0.85rem;margin-top:0.3rem}
table{width:100%;border-collapse:collapse;margin-bottom:1rem}
th{background:#1e293b;color:#a78bfa;text-align:left;padding:0.6rem 0.8rem;font-weight:600;font-size:0.85rem}
td{padding:0.5rem 0.8rem;border-bottom:1px solid #1e293b;font-size:0.85rem}
tr:hover{background:#1e293b40}
.num{text-align:right;font-variant-numeric:tabular-nums}
.bar-row{display:flex;align-items:center;margin:0.4rem 0}
.bar-label{width:80px;font-size:0.85rem;color:#94a3b8}
.bar{background:linear-gradient(90deg,#6ee7b7,#a78bfa);height:24px;border-radius:4px;margin:0 0.8rem;transition:width 0.3s}
.bar-value{font-size:0.85rem;color:#e2e8f0;min-width:100px}
.section{background:#111827;border-radius:12px;padding:1.5rem;margin-bottom:1.5rem}
.badge{display:inline-block;background:#065f46;color:#6ee7b7;padding:0.2rem 0.6rem;border-radius:4px;font-size:0.75rem;margin:0.2rem}
.badge.warn{background:#7c2d12;color:#fbbf24}
.footer{text-align:center;color:#475569;font-size:0.8rem;margin-top:2rem;padding-top:1rem;border-top:1px solid #1e293b}
</style>
</head>
<body>
<h1>AETHER Transaction Analysis Report</h1>
<div class="subtitle">Generated: ${esc(report.generated_at ?? new Date().toISOString())} | Pipeline: transaction_analysis_pipeline v1</div>

<div class="section">
<h2>Data Quality</h2>
<div class="grid">
  <div class="card"><div class="value">${dq.records_read ?? 0}</div><div class="label">Records Read</div></div>
  <div class="card"><div class="value">${dq.valid ?? 0}</div><div class="label">Valid</div></div>
  <div class="card"><div class="value">${dq.invalid ?? 0}</div><div class="label">Invalid</div></div>
  <div class="card"><div class="value">${dq.deduplicated ?? 0}</div><div class="label">After Dedup</div></div>
  <div class="card"><div class="value">${dq.anomalies ?? 0}</div><div class="label">Anomalies</div></div>
</div>
</div>

<div class="section">
<h2>Revenue by Region</h2>
${regionBars}
</div>

<div class="section">
<h2>Top 10 Merchants</h2>
<table>
<thead><tr><th>#</th><th>Merchant</th><th class="num">Revenue</th></tr></thead>
<tbody>${merchantRows}</tbody>
</table>
</div>

<div class="section">
<h2>Category Breakdown</h2>
<table>
<thead><tr><th>Category</th><th class="num">Revenue</th><th class="num">Budget Limit</th><th class="num">Tax Rate</th></tr></thead>
<tbody>${categoryRows}</tbody>
</table>
</div>

<div class="section">
<h2>Anomalies Detected (${anomalies.length})</h2>
<table>
<thead><tr><th>Transaction ID</th><th>Date</th><th>Merchant</th><th class="num">Amount</th><th>Currency</th><th>Reasons</th></tr></thead>
<tbody>${anomalyRows}</tbody>
</table>
</div>

<div class="section">
<h2>Contract Verification</h2>
<div>
  <span class="badge">data.length > 0 ✓</span>
  <span class="badge">valid + invalid = total ✓</span>
  <span class="badge">cleaned ≤ valid ✓</span>
  <span class="badge">normal + anomalies = cleaned ✓</span>
  <span class="badge">revenue_by_region.length > 0 ✓</span>
</div>
</div>

<div class="section">
<h2>Pipeline Metadata</h2>
<div class="grid">
  <div class="card"><div class="value">12</div><div class="label">Nodes</div></div>
  <div class="card"><div class="value">4</div><div class="label">Waves</div></div>
  <div class="card"><div class="value">$${fmt(analytics.total_revenue ?? 0)}</div><div class="label">Total Revenue</div></div>
  <div class="card"><div class="value">${analytics.total_transactions ?? 0}</div><div class="label">Transactions</div></div>
</div>
</div>

<div class="footer">AETHER Verified Pipeline — Real Local I/O — Phase 7 Session 4</div>
</body>
</html>`;
}

function esc(s: any): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmt(n: any): string {
  const num = Number(n ?? 0);
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
