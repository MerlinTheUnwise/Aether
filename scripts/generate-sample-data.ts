#!/usr/bin/env npx tsx
/**
 * AETHER Sample Data Generator
 *
 * Generates realistic CSV and JSON files for pipeline testing.
 * Usage: npx tsx scripts/generate-sample-data.ts [--output <dir>]
 * Default output: ./sample-data/
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";

// ─── Configuration ───────────────────────────────────────────────────────────

const MERCHANTS = [
  "Walmart", "Amazon", "Target", "Costco", "Kroger",
  "Home Depot", "Walgreens", "CVS", "Best Buy", "Lowes",
  "Starbucks", "McDonalds", "Subway", "Chipotle", "Panera",
  "Shell", "BP", "Chevron", "ExxonMobil", "Sunoco",
  "Nike", "Adidas", "Gap", "Zara", "H&M",
  "Uber", "Lyft", "DoorDash", "Grubhub", "Instacart",
];

const CATEGORIES = [
  "groceries", "electronics", "fuel", "dining", "clothing",
  "home_improvement", "health", "entertainment",
];

const REGIONS = ["North", "South", "East", "West"];
const TIERS = ["bronze", "silver", "gold", "platinum"];
const FIRST_NAMES = [
  "Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace", "Hank",
  "Ivy", "Jack", "Karen", "Leo", "Mona", "Nate", "Olivia", "Pete",
  "Quinn", "Rosa", "Sam", "Tina", "Uma", "Vic", "Wendy", "Xander",
  "Yara", "Zane",
];
const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
  "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez",
  "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
  "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark",
  "Ramirez", "Lewis", "Robinson",
];

const CATEGORY_DEFS = [
  { id: "groceries", budget_limit: 500, tax_rate: 0.0 },
  { id: "electronics", budget_limit: 2000, tax_rate: 0.08 },
  { id: "fuel", budget_limit: 300, tax_rate: 0.05 },
  { id: "dining", budget_limit: 400, tax_rate: 0.07 },
  { id: "clothing", budget_limit: 600, tax_rate: 0.06 },
  { id: "home_improvement", budget_limit: 1500, tax_rate: 0.08 },
  { id: "health", budget_limit: 200, tax_rate: 0.0 },
  { id: "entertainment", budget_limit: 300, tax_rate: 0.09 },
];

// ─── Seeded Random ───────────────────────────────────────────────────────────

let seed = 42;
function seededRandom(): number {
  seed = (seed * 16807 + 0) % 2147483647;
  return (seed - 1) / 2147483646;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(seededRandom() * arr.length)];
}

function randomAmount(min: number, max: number): number {
  return Math.round((min + seededRandom() * (max - min)) * 100) / 100;
}

function randomDate(start: Date, end: Date): string {
  const time = start.getTime() + seededRandom() * (end.getTime() - start.getTime());
  return new Date(time).toISOString().split("T")[0];
}

// ─── Generators ──────────────────────────────────────────────────────────────

function generateCustomers(count: number): any[] {
  const customers = [];
  for (let i = 0; i < count; i++) {
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    customers.push({
      id: `CUST-${String(i + 1).padStart(3, "0")}`,
      name: `${first} ${last}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
      region: pick(REGIONS),
      tier: pick(TIERS),
    });
  }
  return customers;
}

function generateTransactions(count: number, customers: any[]): any[] {
  const startDate = new Date("2026-01-01");
  const endDate = new Date("2026-03-01");
  const futureDate = new Date("2026-06-15");
  const rows: any[] = [];
  const usedIds = new Set<string>();

  // Track which IDs we'll duplicate
  const duplicateTargets = new Set<number>();
  while (duplicateTargets.size < 30) {
    duplicateTargets.add(Math.floor(seededRandom() * (count - 100)) + 50);
  }

  // Track which rows get null amounts
  const nullAmountTargets = new Set<number>();
  while (nullAmountTargets.size < 50) {
    const idx = Math.floor(seededRandom() * count);
    if (!duplicateTargets.has(idx)) nullAmountTargets.add(idx);
  }

  // Track negative amount rows (refunds)
  const refundTargets = new Set<number>();
  while (refundTargets.size < 20) {
    const idx = Math.floor(seededRandom() * count);
    if (!nullAmountTargets.has(idx) && !duplicateTargets.has(idx)) refundTargets.add(idx);
  }

  // Track future date rows
  const futureDateTargets = new Set<number>();
  while (futureDateTargets.size < 10) {
    const idx = Math.floor(seededRandom() * count);
    if (!nullAmountTargets.has(idx)) futureDateTargets.add(idx);
  }

  // Track EUR currency rows
  const eurTargets = new Set<number>();
  while (eurTargets.size < 5) {
    const idx = Math.floor(seededRandom() * count);
    if (!nullAmountTargets.has(idx)) eurTargets.add(idx);
  }

  for (let i = 0; i < count; i++) {
    let txnId: string;

    // ~30 duplicates: reuse an earlier ID
    if (duplicateTargets.has(i) && rows.length > 10) {
      const sourceIdx = Math.floor(seededRandom() * (rows.length - 1));
      txnId = rows[sourceIdx].transaction_id;
    } else {
      txnId = `TXN-${String(i + 1).padStart(4, "0")}`;
    }

    const customer = pick(customers);
    const merchant = pick(MERCHANTS);
    const category = pick(CATEGORIES);

    // Determine amount
    let amount: string | number;
    if (nullAmountTargets.has(i)) {
      amount = "";
    } else if (refundTargets.has(i)) {
      amount = -randomAmount(5, 200);
    } else {
      // Normal range with occasional outliers
      const isOutlier = seededRandom() < 0.02;
      amount = isOutlier ? randomAmount(3000, 5000) : randomAmount(0.5, 500);
    }

    // Determine date
    let date: string;
    if (futureDateTargets.has(i)) {
      date = randomDate(new Date("2026-06-01"), futureDate);
    } else {
      date = randomDate(startDate, endDate);
    }

    // Determine currency
    const currency = eurTargets.has(i) ? "EUR" : "USD";

    const status = seededRandom() < 0.95 ? "completed" : "pending";

    rows.push({
      transaction_id: txnId,
      date,
      merchant,
      category,
      amount,
      currency,
      status,
      customer_id: customer.id,
    });
  }

  return rows;
}

function escapeCSV(val: any): string {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCSV(rows: any[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map(h => escapeCSV(row[h])).join(","));
  }
  return lines.join("\n");
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function generateSampleData(outputDir: string): Promise<{ transactionCount: number; customerCount: number; categoryCount: number }> {
  mkdirSync(outputDir, { recursive: true });

  // Generate customers
  const customers = generateCustomers(50);
  writeFileSync(join(outputDir, "customers.json"), JSON.stringify(customers, null, 2));

  // Generate categories
  writeFileSync(join(outputDir, "categories.json"), JSON.stringify(CATEGORY_DEFS, null, 2));

  // Generate transactions
  const transactions = generateTransactions(1000, customers);
  writeFileSync(join(outputDir, "transactions.csv"), toCSV(transactions));

  return {
    transactionCount: transactions.length,
    customerCount: customers.length,
    categoryCount: CATEGORY_DEFS.length,
  };
}

// ─── CLI Entry ───────────────────────────────────────────────────────────────

const isMain = process.argv[1]?.replace(/\\/g, "/").includes("generate-sample-data");
if (isMain) {
  const outputIdx = process.argv.indexOf("--output");
  const outputDir = outputIdx >= 0 ? resolve(process.argv[outputIdx + 1]) : resolve("sample-data");

  console.log(`Generating sample data in ${outputDir}...`);
  const stats = await generateSampleData(outputDir);
  console.log(`  transactions.csv  — ${stats.transactionCount} rows`);
  console.log(`  customers.json    — ${stats.customerCount} records`);
  console.log(`  categories.json   — ${stats.categoryCount} categories`);
  console.log("Done.");
}
