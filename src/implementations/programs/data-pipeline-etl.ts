/**
 * Program implementations: data-pipeline-etl
 * Nodes: fetch_raw_data, validate_schema, clean_nulls, deduplicate, aggregate, write_output
 */

import type { NodeImplementation } from "../types.js";
import type { AetherDatabase } from "../services/database.js";
import type { AetherFileSystem } from "../services/filesystem.js";

export const fetchRawDataImpl: NodeImplementation = async (inputs, context) => {
  const source_uri = (inputs.source_uri ?? "sales").toString();
  const batch_size = Number(inputs.batch_size ?? 1000);

  const db = context.getService!<AetherDatabase>("database");
  context.reportEffect("database.read");

  const raw_records = await db.query(source_uri, { field: "id", operator: "!=", value: "" });
  const limited = raw_records.slice(0, batch_size);

  return {
    raw_records: limited,
    record_count: limited.length,
  };
};

export const validateSchemaImpl: NodeImplementation = async (inputs) => {
  const raw_records = inputs.raw_records ?? [];
  const requiredFields = ["id", "amount", "date"];

  const valid_records: any[] = [];
  let invalid_count = 0;

  for (const record of raw_records) {
    const hasAll = requiredFields.every(f => record[f] !== undefined);
    if (hasAll) {
      valid_records.push(record);
    } else {
      invalid_count++;
    }
  }

  return { valid_records, invalid_count };
};

export const cleanNullsImpl: NodeImplementation = async (inputs) => {
  const valid_records = inputs.valid_records ?? [];

  const cleaned_records = valid_records.map((record: any) => {
    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(record)) {
      cleaned[key] = value ?? (typeof value === "number" ? 0 : "");
    }
    return cleaned;
  });

  return { cleaned_records };
};

export const deduplicateImpl: NodeImplementation = async (inputs) => {
  const cleaned_records = inputs.cleaned_records ?? [];
  const seen = new Set<string>();
  const unique_records: any[] = [];
  let duplicates_removed = 0;

  for (const record of cleaned_records) {
    const key = record.id?.toString() ?? JSON.stringify(record);
    if (seen.has(key)) {
      duplicates_removed++;
    } else {
      seen.add(key);
      unique_records.push(record);
    }
  }

  return { unique_records, duplicates_removed };
};

export const aggregateImpl: NodeImplementation = async (inputs) => {
  const unique_records = inputs.unique_records ?? [];

  // Group by category and sum amounts
  const groups = new Map<string, { category: string; total: number; count: number }>();

  for (const record of unique_records) {
    const category = record.category ?? "uncategorized";
    const existing = groups.get(category) ?? { category, total: 0, count: 0 };
    existing.total += Number(record.amount ?? 0);
    existing.count++;
    groups.set(category, existing);
  }

  const aggregated_data = [...groups.values()].map(g => ({
    category: g.category,
    total_amount: Math.round(g.total * 100) / 100,
    record_count: g.count,
    average_amount: Math.round((g.total / g.count) * 100) / 100,
  }));

  // Compute a simple checksum
  const checksum = `chk_${aggregated_data.length}_${aggregated_data.reduce((s, r) => s + r.total_amount, 0).toFixed(2)}`;

  return { aggregated_data, checksum };
};

export const writeOutputImpl: NodeImplementation = async (inputs, context) => {
  const aggregated_data = inputs.aggregated_data ?? [];
  const checksum = (inputs.checksum ?? "").toString();

  const db = context.getService!<AetherDatabase>("database");
  context.reportEffect("database.write");

  for (const record of aggregated_data) {
    await db.create("output", { ...record, checksum });
  }

  const fs = context.getService!<AetherFileSystem>("filesystem");
  context.reportEffect("filesystem");
  await fs.writeCSV("/output/aggregated.csv", aggregated_data);

  return {
    rows_written: aggregated_data.length,
    success: true,
  };
};
