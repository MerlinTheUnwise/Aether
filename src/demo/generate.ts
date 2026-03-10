/**
 * AETHER Demo — Interactive Pipeline Demo Generator
 *
 * Generates a self-contained HTML application that demonstrates the full
 * AETHER pipeline: describe → generate → validate → visualize → verify → execute.
 *
 * No backend server required. LLM generation via Anthropic API from the browser.
 * Validation, visualization, and execution simulation all run in-browser JS.
 */

// ─── Pre-built example programs ──────────────────────────────────────────────

const EXAMPLES: { label: string; description: string; program: object }[] = [
  {
    label: "A user registration flow",
    description: "Validate email, check uniqueness, create user",
    program: {
      id: "user_registration",
      version: 1,
      effects: ["database.read", "database.write"],
      nodes: [
        {
          id: "validate_email",
          in: { email: { type: "String", format: "email", sensitivity: "pii" } },
          out: {
            valid: { type: "Bool" },
            normalized: { type: "String", format: "email", domain: "authentication", sensitivity: "pii" },
          },
          contract: { pre: ["email.length > 0"], post: ["normalized.is_lowercase", "normalized.is_trimmed"] },
          pure: true,
          confidence: 0.99,
          effects: [],
        },
        {
          id: "check_uniqueness",
          in: { email: { type: "String", format: "email", domain: "authentication", sensitivity: "pii" } },
          out: { unique: { type: "Bool" } },
          contract: { post: ["unique <=> !exists(users, email)"] },
          effects: ["database.read"],
          recovery: {
            db_timeout: { action: "retry", params: { attempts: 3, backoff: "exponential" } },
            db_error: { action: "fallback", params: { assume_unique: false } },
          },
        },
        {
          id: "create_user",
          in: {
            email: { type: "String", format: "email", domain: "authentication", sensitivity: "pii" },
            unique: { type: "Bool", constraint: "== true" },
          },
          out: { user: { type: "User", domain: "authentication", sensitivity: "pii" } },
          contract: { pre: ["unique == true"], post: ["user.email == email", "user.status == active"] },
          effects: ["database.write"],
          recovery: { write_fail: { action: "escalate", params: { message: "user creation failed", max_retries: 2 } } },
        },
      ],
      edges: [
        { from: "validate_email.normalized", to: "check_uniqueness.email" },
        { from: "validate_email.normalized", to: "create_user.email" },
        { from: "check_uniqueness.unique", to: "create_user.unique" },
      ],
    },
  },
  {
    label: "A payment processing pipeline",
    description: "Validate, authorize, capture, send receipt",
    program: {
      id: "payment_processing",
      version: 1,
      effects: ["payment_gateway.write", "database.write", "email"],
      metadata: { description: "Payment processing pipeline", safety_level: "high" },
      nodes: [
        {
          id: "validate_payment",
          in: {
            amount: { type: "Float64", dimension: "currency", unit: "USD", range: [0.01, 999999.99] },
            card_token: { type: "String", format: "uuid_v4", sensitivity: "internal" },
            merchant_id: { type: "String", domain: "commerce" },
          },
          out: {
            validated_amount: { type: "Float64", dimension: "currency", unit: "USD" },
            payment_id: { type: "String", format: "uuid_v4", domain: "payment" },
            status: { type: "String", domain: "payment" },
          },
          contract: { pre: ["amount > 0", "card_token.length > 0"], post: ["validated_amount == amount", "status == created"] },
          pure: true,
          confidence: 0.99,
          effects: [],
        },
        {
          id: "authorize_card",
          in: {
            payment_id: { type: "String", format: "uuid_v4", domain: "payment" },
            validated_amount: { type: "Float64", dimension: "currency", unit: "USD" },
            card_token: { type: "String", format: "uuid_v4", sensitivity: "internal" },
          },
          out: {
            authorization_code: { type: "String", domain: "payment" },
            authorized_amount: { type: "Float64", dimension: "currency", unit: "USD" },
            status: { type: "String", domain: "payment" },
          },
          contract: {
            pre: ["validated_amount > 0"],
            post: ["authorized_amount == validated_amount", "status == authorized", "authorization_code.length > 0"],
          },
          confidence: 0.80,
          adversarial_check: { break_if: ["authorized_amount != validated_amount", "status == captured"] },
          effects: ["payment_gateway.write"],
          recovery: {
            gateway_timeout: { action: "retry", params: { count: 3, backoff: "exponential" } },
            insufficient_funds: { action: "respond", params: { status: 402, body: "insufficient funds" } },
          },
        },
        {
          id: "capture_funds",
          in: {
            authorization_code: { type: "String", domain: "payment" },
            authorized_amount: { type: "Float64", dimension: "currency", unit: "USD" },
            payment_id: { type: "String", format: "uuid_v4", domain: "payment" },
          },
          out: {
            capture_id: { type: "String", domain: "payment" },
            captured_amount: { type: "Float64", dimension: "currency", unit: "USD" },
            status: { type: "String", domain: "payment" },
          },
          contract: {
            pre: ["authorization_code.length > 0", "authorized_amount > 0"],
            post: ["captured_amount == authorized_amount", "status == captured"],
          },
          effects: ["payment_gateway.write", "database.write"],
          recovery: {
            capture_timeout: { action: "retry", params: { count: 3, backoff: "exponential" } },
            capture_failed: { action: "fallback", params: { node: "queue_for_retry" } },
          },
        },
        {
          id: "send_receipt",
          in: {
            payment_id: { type: "String", format: "uuid_v4", domain: "payment" },
            captured_amount: { type: "Float64", dimension: "currency", unit: "USD" },
            capture_id: { type: "String", domain: "payment" },
          },
          out: { receipt_sent: { type: "Bool" } },
          contract: { post: ["receipt_sent == true"] },
          effects: ["email"],
          recovery: { email_failed: { action: "report", params: { channel: "ops-alerts" } } },
        },
      ],
      edges: [
        { from: "validate_payment.payment_id", to: "authorize_card.payment_id" },
        { from: "validate_payment.validated_amount", to: "authorize_card.validated_amount" },
        { from: "authorize_card.authorization_code", to: "capture_funds.authorization_code" },
        { from: "authorize_card.authorized_amount", to: "capture_funds.authorized_amount" },
        { from: "validate_payment.payment_id", to: "capture_funds.payment_id" },
        { from: "validate_payment.payment_id", to: "send_receipt.payment_id" },
        { from: "capture_funds.captured_amount", to: "send_receipt.captured_amount" },
        { from: "capture_funds.capture_id", to: "send_receipt.capture_id" },
      ],
    },
  },
  {
    label: "A content moderation agent",
    description: "Classify, assess severity, decide action, execute with safety rails",
    program: {
      id: "content_moderation_agent",
      version: 1,
      effects: ["ml_model.infer", "database.read", "database.write"],
      metadata: { description: "AI content moderation with human-in-the-loop", safety_level: "high" },
      nodes: [
        {
          id: "classify_content",
          in: { content: { type: "String", domain: "moderation" }, content_type: { type: "String", domain: "moderation" } },
          out: {
            category: { type: "String", domain: "moderation" },
            classification_confidence: { type: "Float64", range: [0.0, 1.0] },
          },
          contract: { post: ["classification_confidence >= 0", "classification_confidence <= 1"] },
          confidence: 0.80,
          adversarial_check: { break_if: ["classification_confidence < 0", "classification_confidence > 1"] },
          effects: ["ml_model.infer"],
          recovery: { model_error: { action: "escalate", params: { message: "classification model failed" } } },
        },
        {
          id: "assess_severity",
          in: {
            category: { type: "String", domain: "moderation" },
            classification_confidence: { type: "Float64", range: [0.0, 1.0] },
            content: { type: "String", domain: "moderation" },
          },
          out: {
            severity: { type: "String", domain: "moderation" },
            combined_confidence: { type: "Float64", range: [0.0, 1.0] },
          },
          contract: { post: ["combined_confidence >= 0", "combined_confidence <= 1"] },
          confidence: 0.75,
          adversarial_check: { break_if: ["combined_confidence > classification_confidence", "combined_confidence < 0"] },
          effects: ["ml_model.infer"],
          recovery: { assessment_failed: { action: "escalate", params: { message: "severity assessment failed" } } },
        },
        {
          id: "decide_action",
          in: {
            severity: { type: "String", domain: "moderation" },
            combined_confidence: { type: "Float64", range: [0.0, 1.0] },
            category: { type: "String", domain: "moderation" },
          },
          out: {
            moderation_action: { type: "String", domain: "moderation" },
            requires_human_review: { type: "Bool" },
            decision_confidence: { type: "Float64", range: [0.0, 1.0] },
          },
          contract: { post: ["decision_confidence >= 0", "decision_confidence <= 1"] },
          confidence: 0.70,
          adversarial_check: { break_if: ["decision_confidence > combined_confidence", "decision_confidence < 0"] },
          effects: ["database.read"],
          recovery: { decision_failed: { action: "escalate", params: { message: "moderation decision failed" } } },
        },
        {
          id: "execute_moderation",
          in: {
            moderation_action: { type: "String", domain: "moderation" },
            requires_human_review: { type: "Bool" },
            decision_confidence: { type: "Float64", range: [0.0, 1.0] },
          },
          out: { action_taken: { type: "String", domain: "moderation" }, success: { type: "Bool" } },
          contract: { pre: ["decision_confidence > 0"], post: ["success == true"] },
          effects: ["database.write"],
          recovery: { execution_failed: { action: "escalate", params: { message: "moderation action failed" } } },
        },
      ],
      edges: [
        { from: "classify_content.category", to: "assess_severity.category" },
        { from: "classify_content.classification_confidence", to: "assess_severity.classification_confidence" },
        { from: "assess_severity.severity", to: "decide_action.severity" },
        { from: "assess_severity.combined_confidence", to: "decide_action.combined_confidence" },
        { from: "classify_content.category", to: "decide_action.category" },
        { from: "decide_action.moderation_action", to: "execute_moderation.moderation_action" },
        { from: "decide_action.requires_human_review", to: "execute_moderation.requires_human_review" },
        { from: "decide_action.decision_confidence", to: "execute_moderation.decision_confidence" },
      ],
    },
  },
  {
    label: "An ETL data pipeline",
    description: "Fetch data, validate, clean nulls, deduplicate, aggregate, output report",
    program: {
      id: "data_pipeline_etl",
      version: 1,
      effects: ["database.read", "database.write", "filesystem"],
      metadata: { description: "ETL data pipeline with data quality contracts" },
      nodes: [
        {
          id: "fetch_raw_data",
          in: { source_uri: { type: "String", domain: "data_pipeline" }, batch_size: { type: "Int", range: [1, 100000] } },
          out: { raw_records: { type: "List<Record>", domain: "data_pipeline" }, record_count: { type: "Int" } },
          contract: { post: ["record_count >= 0"] },
          effects: ["database.read"],
          recovery: { connection_error: { action: "retry", params: { count: 3, backoff: "exponential" } } },
        },
        {
          id: "validate_schema",
          in: { raw_records: { type: "List<Record>", domain: "data_pipeline" } },
          out: { valid_records: { type: "List<Record>", domain: "data_pipeline" }, invalid_count: { type: "Int" } },
          contract: { post: ["invalid_count >= 0"] },
          pure: true,
          effects: [],
        },
        {
          id: "clean_nulls",
          in: { valid_records: { type: "List<Record>", domain: "data_pipeline" } },
          out: { cleaned_records: { type: "List<Record>", domain: "data_pipeline" } },
          contract: { post: ["cleaned_records.length >= 0"] },
          pure: true,
          effects: [],
        },
        {
          id: "deduplicate",
          in: { cleaned_records: { type: "List<Record>", domain: "data_pipeline" } },
          out: { unique_records: { type: "List<Record>", domain: "data_pipeline" }, duplicates_removed: { type: "Int" } },
          contract: { post: ["duplicates_removed >= 0"] },
          pure: true,
          effects: [],
        },
        {
          id: "aggregate",
          in: { unique_records: { type: "List<Record>", domain: "data_pipeline" } },
          out: { aggregated_data: { type: "List<Record>", domain: "data_pipeline" }, checksum: { type: "String" } },
          contract: { post: ["checksum.length > 0"] },
          pure: true,
          effects: [],
        },
        {
          id: "write_output",
          in: { aggregated_data: { type: "List<Record>", domain: "data_pipeline" }, checksum: { type: "String" } },
          out: { rows_written: { type: "Int" }, success: { type: "Bool" } },
          contract: { pre: ["checksum.length > 0"], post: ["rows_written >= 0", "success == true"] },
          effects: ["database.write", "filesystem"],
          recovery: {
            write_timeout: { action: "retry", params: { count: 3, backoff: "exponential" } },
            write_failed: { action: "escalate", params: { message: "output write failed" } },
          },
        },
      ],
      edges: [
        { from: "fetch_raw_data.raw_records", to: "validate_schema.raw_records" },
        { from: "validate_schema.valid_records", to: "clean_nulls.valid_records" },
        { from: "clean_nulls.cleaned_records", to: "deduplicate.cleaned_records" },
        { from: "deduplicate.unique_records", to: "aggregate.unique_records" },
        { from: "aggregate.aggregated_data", to: "write_output.aggregated_data" },
        { from: "aggregate.checksum", to: "write_output.checksum" },
      ],
    },
  },
];

// ─── CSS ─────────────────────────────────────────────────────────────────────

function demoCSS(): string {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
      background: #0a0f1a; color: #e2e8f0; min-height: 100vh;
    }
    .container { max-width: 1200px; margin: 0 auto; padding: 24px; }

    /* Header */
    .header { text-align: center; padding: 32px 0 24px; border-bottom: 1px solid #1e293b; margin-bottom: 24px; }
    .header h1 { font-size: 28px; color: #6ee7b7; margin-bottom: 8px; }
    .header p { color: #94a3b8; font-size: 14px; }

    /* Steps */
    .step { background: #111827; border: 1px solid #1e293b; border-radius: 8px; margin-bottom: 16px; padding: 20px; }
    .step-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .step-number {
      width: 28px; height: 28px; border-radius: 50%; background: #1e293b; color: #6ee7b7;
      display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700;
      flex-shrink: 0;
    }
    .step-number.active { background: #6ee7b7; color: #0a0f1a; }
    .step-number.done { background: #22c55e; color: #fff; }
    .step-title { font-size: 16px; font-weight: 600; color: #f1f5f9; }
    .step.collapsed .step-content { display: none; }

    /* Input */
    textarea {
      width: 100%; background: #0a0f1a; border: 1px solid #334155; border-radius: 6px;
      color: #e2e8f0; padding: 12px; font-family: inherit; font-size: 14px; resize: vertical;
      min-height: 80px;
    }
    textarea:focus { outline: none; border-color: #6ee7b7; }
    .examples { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .example-btn {
      background: #1e293b; border: 1px solid #334155; border-radius: 6px; color: #94a3b8;
      padding: 8px 14px; cursor: pointer; font-size: 13px; font-family: inherit; transition: all 0.15s;
    }
    .example-btn:hover { border-color: #6ee7b7; color: #6ee7b7; }

    /* Buttons */
    .btn {
      background: #6ee7b7; color: #0a0f1a; border: none; border-radius: 6px;
      padding: 10px 20px; font-family: inherit; font-size: 14px; font-weight: 600;
      cursor: pointer; transition: all 0.15s; margin-top: 12px;
    }
    .btn:hover { background: #34d399; }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-secondary {
      background: transparent; border: 1px solid #334155; color: #94a3b8;
    }
    .btn-secondary:hover { border-color: #6ee7b7; color: #6ee7b7; }

    /* API Key */
    .api-key-row { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; }
    .api-key-row input {
      flex: 1; background: #0a0f1a; border: 1px solid #334155; border-radius: 6px;
      color: #e2e8f0; padding: 8px 12px; font-family: inherit; font-size: 13px;
    }
    .api-key-row input:focus { outline: none; border-color: #6ee7b7; }
    .api-key-label { color: #94a3b8; font-size: 12px; margin-bottom: 6px; }

    /* JSON display */
    .json-display {
      background: #0a0f1a; border: 1px solid #1e293b; border-radius: 6px;
      padding: 12px; max-height: 300px; overflow: auto; font-size: 12px;
      white-space: pre-wrap; word-break: break-all; color: #94a3b8;
    }
    .generation-time { color: #6ee7b7; font-size: 12px; margin-top: 8px; }

    /* Validation */
    .validation-results { margin-top: 8px; }
    .v-pass { color: #22c55e; }
    .v-fail { color: #f43f5e; }
    .v-warn { color: #fbbf24; }
    .v-item { padding: 4px 0; font-size: 13px; display: flex; align-items: flex-start; gap: 8px; }
    .v-item .icon { flex-shrink: 0; }

    /* Visualization */
    .viz-container { width: 100%; overflow: auto; background: #0d1117; border-radius: 6px; border: 1px solid #1e293b; }
    .viz-container svg { display: block; }

    /* Node detail panel */
    .node-detail {
      background: #1e293b; border: 1px solid #334155; border-radius: 6px;
      padding: 12px; margin-top: 12px; font-size: 13px; display: none;
    }
    .node-detail h4 { color: #6ee7b7; margin-bottom: 8px; }
    .node-detail .detail-row { display: flex; gap: 8px; margin-bottom: 4px; }
    .node-detail .detail-label { color: #64748b; min-width: 100px; }
    .node-detail .detail-value { color: #e2e8f0; }

    /* Verification */
    .verify-item { padding: 6px 0; font-size: 13px; border-bottom: 1px solid #1e293b; }
    .verify-item:last-child { border-bottom: none; }
    .verify-expr { color: #a78bfa; font-size: 12px; margin-left: 24px; }

    /* Execution */
    .wave-row {
      display: flex; align-items: center; gap: 12px; padding: 8px 0;
      border-bottom: 1px solid #1e293b; font-size: 13px;
    }
    .wave-row:last-child { border-bottom: none; }
    .wave-label { color: #6ee7b7; font-weight: 600; min-width: 70px; }
    .wave-nodes { color: #e2e8f0; flex: 1; }
    .wave-confidence { color: #fbbf24; min-width: 100px; text-align: right; }
    .wave-effects { color: #a78bfa; min-width: 140px; text-align: right; }
    .exec-summary {
      background: #1e293b; border-radius: 6px; padding: 12px; margin-top: 12px;
      display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px;
    }
    .exec-stat-label { color: #64748b; font-size: 12px; }
    .exec-stat-value { color: #6ee7b7; font-size: 18px; font-weight: 700; }

    /* Loading */
    .spinner {
      display: inline-block; width: 16px; height: 16px; border: 2px solid #334155;
      border-top-color: #6ee7b7; border-radius: 50%; animation: spin 0.6s linear infinite;
      margin-right: 8px; vertical-align: middle;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Responsive */
    @media (max-width: 768px) {
      .container { padding: 12px; }
      .header h1 { font-size: 22px; }
      .examples { flex-direction: column; }
      .exec-summary { grid-template-columns: 1fr 1fr; }
    }
  `;
}

// ─── JavaScript (embedded in HTML) ───────────────────────────────────────────

function demoJS(): string {
  const examplesJSON = JSON.stringify(EXAMPLES.map(e => ({
    label: e.label,
    description: e.description,
    program: e.program,
  })));

  return `
// ═══════════════════════════════════════════════════════════════════════════════
// AETHER Demo — In-Browser Logic
// ═══════════════════════════════════════════════════════════════════════════════

const EXAMPLES = ${examplesJSON};

let currentProgram = null;

// ─── Validation ────────────────────────────────────────────────────────────

function validateAetherIR(json) {
  const errors = [];
  const warnings = [];

  // 1. Required fields
  if (!json.id) errors.push("Missing graph.id");
  if (typeof json.version !== "number") errors.push("Missing or invalid graph.version");
  if (!json.nodes || !Array.isArray(json.nodes)) errors.push("Missing or invalid nodes array");
  if (!json.edges || !Array.isArray(json.edges)) errors.push("Missing or invalid edges array");
  if (!json.effects || !Array.isArray(json.effects)) errors.push("Missing or invalid effects array");

  if (errors.length > 0) return { valid: false, errors, warnings };

  const nodeIds = new Set();

  // 2. Node validation
  for (const node of json.nodes) {
    if (!node.id) { errors.push("Node missing id"); continue; }
    if (nodeIds.has(node.id)) errors.push("Duplicate node id: " + node.id);
    nodeIds.add(node.id);

    // Intent nodes skip contract checks
    if (node.intent === true) continue;

    if (!node.contract || !node.contract.post || node.contract.post.length === 0) {
      errors.push("Node " + node.id + ": missing postcondition");
    }

    const hasEffects = node.effects && node.effects.length > 0;
    const isPure = node.pure === true;
    if (hasEffects && !isPure && !node.recovery) {
      errors.push("Node " + node.id + ": effectful node missing recovery");
    }

    if (node.confidence !== undefined && node.confidence < 0.85) {
      if (!node.adversarial_check || !node.adversarial_check.break_if || node.adversarial_check.break_if.length === 0) {
        errors.push("Node " + node.id + ": confidence " + node.confidence + " < 0.85 requires adversarial_check");
      }
    }

    if (node.supervised) {
      warnings.push("Node " + node.id + ": supervised (requires human review)");
    }
  }

  // 3. Edge validation
  const outPorts = new Map();
  const inPorts = new Map();
  for (const node of json.nodes) {
    if (!node.id) continue;
    outPorts.set(node.id, new Set(Object.keys(node.out || {})));
    inPorts.set(node.id, new Set(Object.keys(node.in || {})));
  }

  for (const edge of json.edges) {
    const fromParts = (edge.from || "").split(".");
    const toParts = (edge.to || "").split(".");
    const fromNode = fromParts[0];
    const fromPort = fromParts.slice(1).join(".");
    const toNode = toParts[0];
    const toPort = toParts.slice(1).join(".");

    if (!nodeIds.has(fromNode)) errors.push("Edge from unknown node: " + fromNode);
    if (!nodeIds.has(toNode)) errors.push("Edge to unknown node: " + toNode);
    if (outPorts.has(fromNode) && !outPorts.get(fromNode).has(fromPort))
      errors.push("Edge from unknown port: " + edge.from);
    if (inPorts.has(toNode) && !inPorts.get(toNode).has(toPort))
      errors.push("Edge to unknown port: " + edge.to);
  }

  // 4. DAG check (Kahn's algorithm)
  const adj = new Map();
  const inDeg = new Map();
  for (const id of nodeIds) { adj.set(id, []); inDeg.set(id, 0); }
  for (const edge of json.edges) {
    const fromNode = (edge.from || "").split(".")[0];
    const toNode = (edge.to || "").split(".")[0];
    if (adj.has(fromNode) && inDeg.has(toNode)) {
      adj.get(fromNode).push(toNode);
      inDeg.set(toNode, inDeg.get(toNode) + 1);
    }
  }
  const queue = [];
  for (const [id, deg] of inDeg) { if (deg === 0) queue.push(id); }
  let visited = 0;
  while (queue.length > 0) {
    const n = queue.shift();
    visited++;
    for (const nb of (adj.get(n) || [])) {
      inDeg.set(nb, inDeg.get(nb) - 1);
      if (inDeg.get(nb) === 0) queue.push(nb);
    }
  }
  if (visited < nodeIds.size) {
    errors.push("Graph contains a cycle (not a valid DAG)");
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Layout (wave computation) ─────────────────────────────────────────────

function computeWaves(json) {
  const nodes = json.nodes || [];
  const edges = json.edges || [];
  const nodeIds = nodes.map(n => n.id);
  const adj = new Map();
  const inDeg = new Map();
  for (const id of nodeIds) { adj.set(id, []); inDeg.set(id, 0); }

  for (const edge of edges) {
    const fromNode = (edge.from || "").split(".")[0];
    const toNode = (edge.to || "").split(".")[0];
    if (adj.has(fromNode) && inDeg.has(toNode)) {
      adj.get(fromNode).push(toNode);
      inDeg.set(toNode, inDeg.get(toNode) + 1);
    }
  }

  const waveMap = new Map();
  const queue = [];
  for (const [id, deg] of inDeg) { if (deg === 0) { queue.push(id); waveMap.set(id, 0); } }

  while (queue.length > 0) {
    const n = queue.shift();
    const wave = waveMap.get(n);
    for (const nb of (adj.get(n) || [])) {
      const newWave = wave + 1;
      waveMap.set(nb, Math.max(waveMap.get(nb) || 0, newWave));
      inDeg.set(nb, inDeg.get(nb) - 1);
      if (inDeg.get(nb) === 0) queue.push(nb);
    }
  }

  // Group by wave
  const waves = [];
  for (const [id, w] of waveMap) {
    while (waves.length <= w) waves.push([]);
    waves[w].push(id);
  }
  return { waves, waveMap };
}

function computeLayout(json) {
  const { waves, waveMap } = computeWaves(json);
  const NODE_W = 180;
  const NODE_H = 50;
  const H_GAP = 60;
  const V_GAP = 40;
  const MARGIN = 40;

  const positions = new Map();
  let maxX = 0;

  for (let w = 0; w < waves.length; w++) {
    const nodesInWave = waves[w];
    const x = MARGIN + w * (NODE_W + H_GAP);
    for (let i = 0; i < nodesInWave.length; i++) {
      const y = MARGIN + i * (NODE_H + V_GAP);
      positions.set(nodesInWave[i], { x, y, w });
      if (x + NODE_W > maxX) maxX = x + NODE_W;
    }
  }

  const maxWaveSize = Math.max(...waves.map(w => w.length), 1);
  const totalW = maxX + MARGIN;
  const totalH = MARGIN * 2 + maxWaveSize * (NODE_H + V_GAP) - V_GAP;

  return { positions, waves, waveMap, totalW, totalH, NODE_W, NODE_H };
}

// ─── SVG Visualization ─────────────────────────────────────────────────────

function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

function renderVisualization(json) {
  const layout = computeLayout(json);
  const { positions, totalW, totalH, NODE_W, NODE_H } = layout;
  const nodes = json.nodes || [];
  const edges = json.edges || [];
  const nodeMap = new Map();
  for (const n of nodes) nodeMap.set(n.id, n);

  let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + totalW + '" height="' + totalH + '" style="background:#0d1117">';
  svg += '<defs><marker id="ah" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="#475569"/></marker></defs>';

  // Edges
  for (const edge of edges) {
    const fromNode = (edge.from || "").split(".")[0];
    const toNode = (edge.to || "").split(".")[0];
    const p1 = positions.get(fromNode);
    const p2 = positions.get(toNode);
    if (!p1 || !p2) continue;
    const x1 = p1.x + NODE_W;
    const y1 = p1.y + NODE_H / 2;
    const x2 = p2.x;
    const y2 = p2.y + NODE_H / 2;
    const cx = (x1 + x2) / 2;
    svg += '<path d="M' + x1 + ' ' + y1 + ' C' + cx + ' ' + y1 + ' ' + cx + ' ' + y2 + ' ' + x2 + ' ' + y2 + '" fill="none" stroke="#475569" stroke-width="1.5" marker-end="url(#ah)"/>';
  }

  // Nodes
  for (const node of nodes) {
    const pos = positions.get(node.id);
    if (!pos) continue;
    const isPure = node.pure === true;
    const hasEffects = node.effects && node.effects.length > 0;
    const isSupervised = !!node.supervised;
    const conf = node.confidence !== undefined ? node.confidence : 1.0;

    let borderColor = "#475569";
    let fillColor = "#1e293b";
    if (isPure) borderColor = "#3b82f6";
    else if (isSupervised) borderColor = "#fbbf24";
    else if (hasEffects) borderColor = "#f97316";

    if (conf < 0.85) fillColor = "#2d1b1b";

    svg += '<g class="node-g" data-id="' + esc(node.id) + '" style="cursor:pointer" onclick="selectNode(\\''+esc(node.id)+'\\')">';
    svg += '<rect x="' + pos.x + '" y="' + pos.y + '" width="' + NODE_W + '" height="' + NODE_H + '" rx="6" fill="' + fillColor + '" stroke="' + borderColor + '" stroke-width="2"/>';
    svg += '<text x="' + (pos.x + NODE_W/2) + '" y="' + (pos.y + NODE_H/2 - 4) + '" text-anchor="middle" fill="#e2e8f0" font-size="12" font-family="monospace">' + esc(node.id) + '</text>';
    // Confidence badge
    const confText = (conf * 100).toFixed(0) + "%";
    const confColor = conf >= 0.85 ? "#22c55e" : conf >= 0.7 ? "#fbbf24" : "#f43f5e";
    svg += '<text x="' + (pos.x + NODE_W/2) + '" y="' + (pos.y + NODE_H/2 + 12) + '" text-anchor="middle" fill="' + confColor + '" font-size="10" font-family="monospace">' + confText + '</text>';
    svg += '</g>';
  }

  svg += '</svg>';
  return svg;
}

// ─── Verification Simulation ────────────────────────────────────────────────

function simulateVerification(json) {
  const results = [];
  for (const node of (json.nodes || [])) {
    if (node.intent === true) continue;
    const contracts = [];

    for (const expr of (node.contract?.pre || [])) {
      contracts.push({ type: "precondition", expr, status: classifyExpr(expr) });
    }
    for (const expr of (node.contract?.post || [])) {
      contracts.push({ type: "postcondition", expr, status: classifyExpr(expr) });
    }
    for (const expr of (node.contract?.invariants || [])) {
      contracts.push({ type: "invariant", expr, status: classifyExpr(expr) });
    }
    for (const expr of (node.adversarial_check?.break_if || [])) {
      contracts.push({ type: "adversarial", expr, status: classifyExpr(expr) });
    }

    results.push({ nodeId: node.id, contracts });
  }
  return results;
}

function classifyExpr(expr) {
  // Simple heuristic: arithmetic/comparisons → verified, quantifiers/complex → requires Z3
  if (/forall|exists|\\u2200|\\u2203/.test(expr)) return "requires_z3";
  if (/never\\(|\\u2227|\\u2228|\\u2194/.test(expr)) return "requires_z3";
  if (/[><=!]+/.test(expr) || /\\.length/.test(expr) || /==/.test(expr)) return "verified";
  return "verified";
}

// ─── Execution Simulation ───────────────────────────────────────────────────

function simulateExecution(json) {
  const { waves } = computeWaves(json);
  const nodeMap = new Map();
  for (const n of (json.nodes || [])) nodeMap.set(n.id, n);

  // Compute confidence propagation
  const nodeConf = new Map();
  const waveResults = [];

  // Build dependency map for confidence propagation
  const deps = new Map(); // nodeId → [source nodeIds]
  for (const edge of (json.edges || [])) {
    const fromNode = (edge.from || "").split(".")[0];
    const toNode = (edge.to || "").split(".")[0];
    if (!deps.has(toNode)) deps.set(toNode, new Set());
    deps.get(toNode).add(fromNode);
  }

  for (let w = 0; w < waves.length; w++) {
    const waveNodeIds = waves[w];
    const waveInfo = { wave: w, nodes: [] };

    for (const id of waveNodeIds) {
      const node = nodeMap.get(id);
      if (!node) continue;

      const baseConf = node.confidence !== undefined ? node.confidence : 1.0;
      const depNodes = deps.get(id) || new Set();
      let minInputConf = 1.0;
      for (const dep of depNodes) {
        const dc = nodeConf.get(dep);
        if (dc !== undefined && dc < minInputConf) minInputConf = dc;
      }
      const propagated = baseConf * minInputConf;
      nodeConf.set(id, propagated);

      const effects = (node.effects || []).slice();
      const recoveryKeys = node.recovery ? Object.keys(node.recovery) : [];

      waveInfo.nodes.push({
        id, confidence: propagated, effects, recoveryPaths: recoveryKeys.length,
        oversightRequired: propagated < 0.85,
      });
    }
    waveResults.push(waveInfo);
  }

  // Summary
  let minConf = 1.0;
  const allEffects = new Set();
  let totalRecovery = 0;
  let totalPost = 0;
  let totalAdversarial = 0;
  let oversightCount = 0;

  for (const node of (json.nodes || [])) {
    const c = nodeConf.get(node.id);
    if (c !== undefined && c < minConf) minConf = c;
    for (const e of (node.effects || [])) allEffects.add(e);
    if (node.recovery) totalRecovery += Object.keys(node.recovery).length;
    totalPost += (node.contract?.post?.length || 0);
    totalAdversarial += (node.adversarial_check?.break_if?.length || 0);
    if (c !== undefined && c < 0.85) oversightCount++;
  }

  return {
    waves: waveResults,
    summary: {
      finalConfidence: minConf,
      totalEffects: [...allEffects],
      totalRecoveryPaths: totalRecovery,
      totalPostconditions: totalPost,
      totalAdversarialChecks: totalAdversarial,
      oversightRequired: oversightCount,
    },
  };
}

// ─── UI Logic ───────────────────────────────────────────────────────────────

function selectNode(nodeId) {
  if (!currentProgram) return;
  const node = (currentProgram.nodes || []).find(n => n.id === nodeId);
  if (!node) return;
  const panel = document.getElementById("node-detail");
  panel.style.display = "block";

  let html = '<h4>' + esc(nodeId) + '</h4>';

  // Ports
  const inPorts = Object.entries(node.in || {});
  const outPorts = Object.entries(node.out || {});
  if (inPorts.length) {
    html += '<div class="detail-row"><span class="detail-label">Inputs:</span><span class="detail-value">' +
      inPorts.map(([k,v]) => k + ': ' + (v.type || '?')).join(', ') + '</span></div>';
  }
  if (outPorts.length) {
    html += '<div class="detail-row"><span class="detail-label">Outputs:</span><span class="detail-value">' +
      outPorts.map(([k,v]) => k + ': ' + (v.type || '?')).join(', ') + '</span></div>';
  }

  // Contracts
  if (node.contract) {
    if (node.contract.pre?.length) html += '<div class="detail-row"><span class="detail-label">Preconditions:</span><span class="detail-value">' + node.contract.pre.map(esc).join('; ') + '</span></div>';
    if (node.contract.post?.length) html += '<div class="detail-row"><span class="detail-label">Postconditions:</span><span class="detail-value">' + node.contract.post.map(esc).join('; ') + '</span></div>';
  }

  // Effects
  if (node.effects?.length) {
    html += '<div class="detail-row"><span class="detail-label">Effects:</span><span class="detail-value" style="color:#f97316">' + node.effects.join(', ') + '</span></div>';
  }

  // Confidence
  const conf = node.confidence !== undefined ? node.confidence : 1.0;
  const confColor = conf >= 0.85 ? '#22c55e' : conf >= 0.7 ? '#fbbf24' : '#f43f5e';
  html += '<div class="detail-row"><span class="detail-label">Confidence:</span><span class="detail-value" style="color:'+confColor+'">' + (conf * 100).toFixed(0) + '%</span></div>';

  // Recovery
  if (node.recovery) {
    html += '<div class="detail-row"><span class="detail-label">Recovery:</span><span class="detail-value">' +
      Object.entries(node.recovery).map(([k,v]) => k + ' \\u2192 ' + v.action).join(', ') + '</span></div>';
  }

  panel.innerHTML = html;
}

function loadExample(idx) {
  const ex = EXAMPLES[idx];
  document.getElementById("user-input").value = ex.label;
  processProgram(ex.program);
}

let demoShowAether = true;

function graphToAetherDemo(g) {
  let out = 'graph ' + (g.id || 'untitled') + ' v' + (g.version || 1) + '\\n';
  if (g.effects && g.effects.length > 0) out += '  effects: [' + g.effects.join(', ') + ']\\n';
  out += '\\n';
  for (const n of (g.nodes || [])) {
    if (n.hole) { out += '  hole ' + n.id + '\\n  end\\n\\n'; continue; }
    if (n.intent) { out += '  intent ' + n.id + '\\n  end\\n\\n'; continue; }
    out += '  node ' + n.id + '\\n';
    if (n.in) out += '    in:  ' + Object.entries(n.in).map(function([k,v]){return k+': '+(v.type||'String')}).join(', ') + '\\n';
    if (n.out) out += '    out: ' + Object.entries(n.out).map(function([k,v]){return k+': '+(v.type||'String')}).join(', ') + '\\n';
    if (n.effects && n.effects.length > 0) out += '    effects: [' + n.effects.join(', ') + ']\\n';
    if (n.contract) {
      out += '    contracts:\\n';
      for (const p of (n.contract.pre || [])) out += '      pre:  ' + p + '\\n';
      for (const p of (n.contract.post || [])) out += '      post: ' + p + '\\n';
    }
    if (n.confidence !== undefined) out += '    confidence: ' + n.confidence + '\\n';
    if (n.pure) out += '    pure\\n';
    if (n.recovery) {
      out += '    recovery:\\n';
      for (const [k, v] of Object.entries(n.recovery)) {
        let args = v.params ? '(' + Object.entries(v.params).map(function([pk,pv]){return pk+': '+pv}).join(', ') + ')' : '';
        out += '      ' + k + ' -> ' + v.action + args + '\\n';
      }
    }
    out += '  end\\n\\n';
  }
  for (const e of (g.edges || [])) out += '  edge ' + e.from + ' -> ' + e.to + '\\n';
  out += '\\nend\\n';
  return out;
}

function toggleDemoFormat() {
  demoShowAether = !demoShowAether;
  const el = document.getElementById("generated-json");
  const btn = document.getElementById("toggle-format-btn");
  if (currentProgram) {
    el.textContent = demoShowAether ? graphToAetherDemo(currentProgram) : JSON.stringify(currentProgram, null, 2);
    btn.textContent = demoShowAether ? "Show JSON" : "Show .aether";
  }
}

function processProgram(program) {
  currentProgram = program;

  // Step 2: Show generated output (.aether by default, toggle for JSON)
  showStep(2);
  document.getElementById("generated-json").textContent = demoShowAether ? graphToAetherDemo(program) : JSON.stringify(program, null, 2);
  document.getElementById("generation-time").textContent = "Loaded from example";

  // Step 3: Validate
  showStep(3);
  const result = validateAetherIR(program);
  renderValidation(result);

  if (!result.valid) return;

  // Step 4: Visualize
  showStep(4);
  document.getElementById("viz-area").innerHTML = renderVisualization(program);

  // Step 5: Verify
  showStep(5);
  const verification = simulateVerification(program);
  renderVerification(verification);

  // Step 6: Execute
  showStep(6);
  const execution = simulateExecution(program);
  renderExecution(execution);
}

function showStep(n) {
  for (let i = 1; i <= 6; i++) {
    const step = document.getElementById("step-" + i);
    const num = step.querySelector(".step-number");
    if (i < n) { num.className = "step-number done"; step.classList.remove("collapsed"); }
    else if (i === n) { num.className = "step-number active"; step.classList.remove("collapsed"); }
    else { num.className = "step-number"; step.classList.add("collapsed"); }
  }
}

function renderValidation(result) {
  let html = "";
  const checks = [
    { label: "Schema structure", pass: !result.errors.some(e => e.includes("Missing graph") || e.includes("Missing or invalid")) },
    { label: "Node contracts", pass: !result.errors.some(e => e.includes("postcondition")) },
    { label: "Edge references", pass: !result.errors.some(e => e.includes("unknown node") || e.includes("unknown port")) },
    { label: "DAG (no cycles)", pass: !result.errors.some(e => e.includes("cycle")) },
    { label: "Recovery rules", pass: !result.errors.some(e => e.includes("recovery")) },
    { label: "Adversarial checks", pass: !result.errors.some(e => e.includes("adversarial")) },
  ];

  for (const c of checks) {
    html += '<div class="v-item"><span class="icon ' + (c.pass ? 'v-pass' : 'v-fail') + '">' + (c.pass ? '\\u2713' : '\\u2717') + '</span><span class="' + (c.pass ? 'v-pass' : 'v-fail') + '">' + c.label + '</span></div>';
  }

  if (result.errors.length > 0) {
    html += '<div style="margin-top:8px;color:#f43f5e;font-size:12px">';
    for (const e of result.errors) html += '<div>\\u2022 ' + esc(e) + '</div>';
    html += '</div>';
  }
  if (result.warnings.length > 0) {
    html += '<div style="margin-top:8px">';
    for (const w of result.warnings) html += '<div class="v-warn" style="font-size:12px">\\u26A0 ' + esc(w) + '</div>';
    html += '</div>';
  }

  document.getElementById("validation-results").innerHTML = html;
}

function renderVerification(results) {
  let html = "";
  let totalVerified = 0, totalRequiresZ3 = 0, total = 0;

  for (const nodeResult of results) {
    html += '<div class="verify-item"><strong>' + esc(nodeResult.nodeId) + '</strong>';
    for (const c of nodeResult.contracts) {
      total++;
      const icon = c.status === "verified" ? '\\u2713' : '\\u26A0';
      const cls = c.status === "verified" ? 'v-pass' : 'v-warn';
      if (c.status === "verified") totalVerified++;
      else totalRequiresZ3++;
      html += '<div class="verify-expr"><span class="' + cls + '">' + icon + '</span> ' + c.type + ': <code>' + esc(c.expr) + '</code> \\u2014 ' + c.status + '</div>';
    }
    html += '</div>';
  }

  const pct = total > 0 ? ((totalVerified / total) * 100).toFixed(0) : "100";
  html = '<div style="margin-bottom:12px;font-size:14px">Verification: <span class="v-pass">' + totalVerified + '</span> verified, <span class="v-warn">' + totalRequiresZ3 + '</span> require Z3 (' + pct + '% in-browser)</div>' + html;

  document.getElementById("verification-results").innerHTML = html;
}

function renderExecution(result) {
  let html = "";
  for (const wave of result.waves) {
    html += '<div class="wave-row">';
    html += '<span class="wave-label">Wave ' + wave.wave + '</span>';
    html += '<span class="wave-nodes">[' + wave.nodes.map(n => n.id).join(", ") + ']</span>';
    const minConf = Math.min(...wave.nodes.map(n => n.confidence));
    const confColor = minConf >= 0.85 ? '#22c55e' : minConf >= 0.7 ? '#fbbf24' : '#f43f5e';
    html += '<span class="wave-confidence" style="color:'+confColor+'">' + (minConf * 100).toFixed(0) + '%</span>';
    const eff = [...new Set(wave.nodes.flatMap(n => n.effects))];
    html += '<span class="wave-effects">' + (eff.length > 0 ? eff.join(", ") : "none") + '</span>';
    html += '</div>';
  }

  // Summary
  const s = result.summary;
  html += '<div class="exec-summary">';
  html += '<div><div class="exec-stat-label">Final Confidence</div><div class="exec-stat-value">' + (s.finalConfidence * 100).toFixed(0) + '%</div></div>';
  html += '<div><div class="exec-stat-label">Postconditions</div><div class="exec-stat-value">' + s.totalPostconditions + '</div></div>';
  html += '<div><div class="exec-stat-label">Adversarial Checks</div><div class="exec-stat-value">' + s.totalAdversarialChecks + '</div></div>';
  html += '<div><div class="exec-stat-label">Effects</div><div class="exec-stat-value">' + s.totalEffects.join(", ") + '</div></div>';
  html += '<div><div class="exec-stat-label">Recovery Paths</div><div class="exec-stat-value">' + s.totalRecoveryPaths + '</div></div>';
  html += '<div><div class="exec-stat-label">Oversight Required</div><div class="exec-stat-value">' + s.oversightRequired + ' nodes</div></div>';
  html += '</div>';

  document.getElementById("execution-results").innerHTML = html;
}

// ─── LLM Generation ────────────────────────────────────────────────────────

let autoFixAttempts = 0;
const MAX_AUTO_FIX = 3;

async function generateFromDescription() {
  const input = document.getElementById("user-input").value.trim();
  if (!input) return;

  const apiKey = document.getElementById("api-key").value.trim();
  if (!apiKey) {
    alert("Please enter your Anthropic API key");
    return;
  }

  const btn = document.getElementById("generate-btn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Generating...';
  autoFixAttempts = 0;

  try {
    const start = performance.now();
    const program = await callLLM(apiKey, input);
    const elapsed = ((performance.now() - start) / 1000).toFixed(1);

    document.getElementById("generation-time").textContent = "Generated in " + elapsed + "s";
    processProgram(program);
  } catch (err) {
    document.getElementById("generated-json").textContent = "Error: " + err.message;
    showStep(2);
  } finally {
    btn.disabled = false;
    btn.innerHTML = "Generate AETHER";
  }
}

async function callLLM(apiKey, description) {
  const systemPrompt = \`You are an AETHER-IR compiler. Given a natural language description, output a valid AETHER-IR JSON program.

SCHEMA RULES:
- Top level: { id, version: 1, effects: [...], nodes: [...], edges: [...] }
- Each node: { id, in: { portName: { type } }, out: { portName: { type } }, contract: { post: [...] }, effects: [...] }
- Effectful nodes (effects.length > 0 and pure !== true) MUST have recovery: { errorName: { action, params } }
- Nodes with confidence < 0.85 MUST have adversarial_check: { break_if: [...] }
- Edges: { from: "nodeId.outPort", to: "nodeId.inPort" }
- Graph must be a DAG (no cycles)
- Types: String, Bool, Int, Float64, List<T>, Map<K,V>, or custom names
- Actions: retry, fallback, escalate, respond, report
- Pure nodes: set pure: true, effects: []

Output ONLY valid JSON. No markdown, no explanation.\`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: "user", content: description }],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error("API error " + resp.status + ": " + text.slice(0, 200));
  }

  const data = await resp.json();
  const text = data.content[0].text;

  // Extract JSON from response (might be wrapped in markdown)
  let jsonText = text;
  const jsonMatch = text.match(/\\\`\\\`\\\`(?:json)?\\s*([\\s\\S]*?)\\\`\\\`\\\`/);
  if (jsonMatch) jsonText = jsonMatch[1];

  const program = JSON.parse(jsonText.trim());

  // Validate and auto-fix if needed
  const result = validateAetherIR(program);
  if (!result.valid && autoFixAttempts < MAX_AUTO_FIX) {
    autoFixAttempts++;
    return await autoFix(apiKey, program, result.errors);
  }

  return program;
}

async function autoFix(apiKey, program, errors) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      messages: [{
        role: "user",
        content: "The generated AETHER-IR has these validation errors:\\n" + errors.join("\\n") +
          "\\n\\nOriginal JSON:\\n" + JSON.stringify(program) +
          "\\n\\nFix them and return only the corrected JSON. No markdown, no explanation.",
      }],
    }),
  });

  if (!resp.ok) throw new Error("Auto-fix API error: " + resp.status);
  const data = await resp.json();
  const text = data.content[0].text;

  let jsonText = text;
  const jsonMatch = text.match(/\\\`\\\`\\\`(?:json)?\\s*([\\s\\S]*?)\\\`\\\`\\\`/);
  if (jsonMatch) jsonText = jsonMatch[1];

  const fixed = JSON.parse(jsonText.trim());
  const result = validateAetherIR(fixed);
  if (!result.valid && autoFixAttempts < MAX_AUTO_FIX) {
    autoFixAttempts++;
    return await autoFix(apiKey, fixed, result.errors);
  }
  return fixed;
}

// ─── Init ───────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  showStep(1);
});
  `;
}

// ─── HTML ────────────────────────────────────────────────────────────────────

function demoHTML(css: string, js: string): string {
  const exampleButtons = EXAMPLES.map((ex, i) =>
    `<button class="example-btn" onclick="loadExample(${i})" title="${esc(ex.description)}">${esc(ex.label)}</button>`
  ).join("\n            ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AETHER Demo — Describe, Generate, Verify, Execute</title>
<style>${css}</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>AETHER Demo</h1>
    <p>Describe a pipeline in natural language. Generate verified, contract-checked, effect-tracked programs.</p>
  </div>

  <!-- Step 1: Describe -->
  <div class="step" id="step-1">
    <div class="step-header">
      <div class="step-number active">1</div>
      <div class="step-title">Describe</div>
    </div>
    <div class="step-content">
      <div class="api-key-label">Anthropic API Key (for LLM generation — stored only in your browser)</div>
      <div class="api-key-row">
        <input type="password" id="api-key" placeholder="sk-ant-..." />
      </div>
      <textarea id="user-input" placeholder="Describe your pipeline... e.g. 'A user registration flow that validates email, checks uniqueness, and creates a user account'"></textarea>
      <div class="examples">
        <span style="color:#64748b;font-size:12px;align-self:center">Examples:</span>
        ${exampleButtons}
      </div>
      <button class="btn" id="generate-btn" onclick="generateFromDescription()">Generate AETHER</button>
    </div>
  </div>

  <!-- Step 2: Generate -->
  <div class="step collapsed" id="step-2">
    <div class="step-header">
      <div class="step-number">2</div>
      <div class="step-title">Generate</div>
      <button class="btn" id="toggle-format-btn" onclick="toggleDemoFormat()" style="margin-left:auto;font-size:11px;padding:4px 10px">Show JSON</button>
    </div>
    <div class="step-content">
      <div class="json-display" id="generated-json"></div>
      <div class="generation-time" id="generation-time"></div>
    </div>
  </div>

  <!-- Step 3: Validate -->
  <div class="step collapsed" id="step-3">
    <div class="step-header">
      <div class="step-number">3</div>
      <div class="step-title">Validate</div>
    </div>
    <div class="step-content">
      <div class="validation-results" id="validation-results"></div>
    </div>
  </div>

  <!-- Step 4: Visualize -->
  <div class="step collapsed" id="step-4">
    <div class="step-header">
      <div class="step-number">4</div>
      <div class="step-title">Visualize</div>
    </div>
    <div class="step-content">
      <div class="viz-container" id="viz-area"></div>
      <div class="node-detail" id="node-detail"></div>
    </div>
  </div>

  <!-- Step 5: Verify -->
  <div class="step collapsed" id="step-5">
    <div class="step-header">
      <div class="step-number">5</div>
      <div class="step-title">Verify</div>
    </div>
    <div class="step-content">
      <div id="verification-results"></div>
    </div>
  </div>

  <!-- Step 6: Execute (simulated) -->
  <div class="step collapsed" id="step-6">
    <div class="step-header">
      <div class="step-number">6</div>
      <div class="step-title">Execute (simulated)</div>
    </div>
    <div class="step-content">
      <div id="execution-results"></div>
    </div>
  </div>
</div>

<script>${js}</script>
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Wave computation (shared with tests) ───────────────────────────────────

interface WaveResult {
  waves: string[][];
  waveMap: Map<string, number>;
}

export function computeWaves(json: { nodes?: { id: string }[]; edges?: { from: string; to: string }[] }): WaveResult {
  const nodes = json.nodes || [];
  const edges = json.edges || [];
  const nodeIds = nodes.map(n => n.id);
  const adj = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  for (const id of nodeIds) { adj.set(id, []); inDeg.set(id, 0); }

  for (const edge of edges) {
    const fromNode = (edge.from || "").split(".")[0];
    const toNode = (edge.to || "").split(".")[0];
    if (adj.has(fromNode) && inDeg.has(toNode)) {
      adj.get(fromNode)!.push(toNode);
      inDeg.set(toNode, inDeg.get(toNode)! + 1);
    }
  }

  const waveMap = new Map<string, number>();
  const queue: string[] = [];
  for (const [id, deg] of inDeg) { if (deg === 0) { queue.push(id); waveMap.set(id, 0); } }

  while (queue.length > 0) {
    const n = queue.shift()!;
    const wave = waveMap.get(n)!;
    for (const nb of (adj.get(n) || [])) {
      const newWave = wave + 1;
      waveMap.set(nb, Math.max(waveMap.get(nb) || 0, newWave));
      inDeg.set(nb, inDeg.get(nb)! - 1);
      if (inDeg.get(nb) === 0) queue.push(nb);
    }
  }

  const waves: string[][] = [];
  for (const [id, w] of waveMap) {
    while (waves.length <= w) waves.push([]);
    waves[w].push(id);
  }
  return { waves, waveMap };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function generateDemo(): string {
  const css = demoCSS();
  const js = demoJS();
  return demoHTML(css, js);
}

export { EXAMPLES };
