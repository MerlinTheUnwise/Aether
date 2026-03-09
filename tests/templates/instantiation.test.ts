/**
 * Template Instantiation Tests
 */

import { describe, it, expect } from "vitest";
import { instantiateTemplate } from "../../src/compiler/templates.js";
import type { AetherTemplate, AetherTemplateInstance } from "../../src/ir/validator.js";

const crudTemplate: AetherTemplate = {
  id: "crud-entity",
  parameters: [
    { name: "Entity", kind: "type" },
    { name: "IdType", kind: "type" },
    { name: "storage_effect", kind: "effect" },
  ],
  nodes: [
    {
      id: "validate_input",
      in: { data: { type: "$Entity" } },
      out: { validated: { type: "$Entity" } },
      contract: { pre: ["input.data != null"], post: ["output.validated != null"] },
      effects: [],
      pure: true,
    },
    {
      id: "check_exists",
      in: { entity_id: { type: "$IdType" } },
      out: { exists: { type: "Bool" } },
      contract: { pre: ["input.entity_id != null"], post: ["typeof output.exists == 'boolean'"] },
      effects: ["$storage_effect"],
      recovery: { storage_failure: { action: "retry", params: { max: 3 } } },
    },
    {
      id: "create_entity",
      in: { data: { type: "$Entity" } },
      out: { entity: { type: "$Entity" }, success: { type: "Bool" } },
      contract: { pre: ["input.data != null"], post: ["output.success == true"] },
      effects: ["$storage_effect"],
      recovery: { storage_failure: { action: "retry", params: { max: 3 } } },
    },
    {
      id: "read_entity",
      in: { entity_id: { type: "$IdType" } },
      out: { entity: { type: "$Entity" } },
      contract: { pre: ["input.entity_id != null"], post: ["output.entity != null"] },
      effects: ["$storage_effect"],
      recovery: { not_found: { action: "respond", params: { status: 404 } } },
    },
    {
      id: "update_entity",
      in: { entity_id: { type: "$IdType" }, data: { type: "$Entity" } },
      out: { entity: { type: "$Entity" }, success: { type: "Bool" } },
      contract: { pre: ["input.entity_id != null"], post: ["output.success == true"] },
      effects: ["$storage_effect"],
      recovery: { not_found: { action: "respond", params: { status: 404 } } },
    },
    {
      id: "delete_entity",
      in: { entity_id: { type: "$IdType" } },
      out: { success: { type: "Bool" } },
      contract: { pre: ["input.entity_id != null"], post: ["output.success == true"] },
      effects: ["$storage_effect"],
      recovery: { not_found: { action: "respond", params: { status: 404 } } },
    },
  ],
  edges: [
    { from: "validate_input.validated", to: "create_entity.data" },
  ],
};

describe("Template Instantiation", () => {
  it("instantiate crud-entity with User type produces 6 concrete nodes with prefixed IDs", () => {
    const instance: AetherTemplateInstance = {
      id: "user_crud",
      template: "crud-entity",
      bindings: {
        Entity: { type: "User" },
        IdType: { type: "UserID" },
        storage_effect: "database.write",
      },
    };

    const result = instantiateTemplate(crudTemplate, instance);
    expect(result.success).toBe(true);
    expect(result.nodes).toHaveLength(6);

    // All IDs should be prefixed
    for (const node of result.nodes) {
      expect(node.id).toMatch(/^user_crud_/);
    }

    // Check specific node IDs
    const ids = result.nodes.map(n => n.id);
    expect(ids).toContain("user_crud_validate_input");
    expect(ids).toContain("user_crud_create_entity");
    expect(ids).toContain("user_crud_read_entity");
  });

  it("instantiate same template with Product type produces different concrete nodes", () => {
    const instance: AetherTemplateInstance = {
      id: "product_crud",
      template: "crud-entity",
      bindings: {
        Entity: { type: "Product" },
        IdType: { type: "ProductID" },
        storage_effect: "database.write",
      },
    };

    const result = instantiateTemplate(crudTemplate, instance);
    expect(result.success).toBe(true);
    expect(result.nodes).toHaveLength(6);

    // Check type substitution
    const validateNode = result.nodes.find(n => n.id === "product_crud_validate_input")!;
    expect(validateNode.in.data.type).toBe("Product");
    expect(validateNode.out.validated.type).toBe("Product");
  });

  it("two instances in same graph have no ID collisions", () => {
    const userInstance: AetherTemplateInstance = {
      id: "user_crud",
      template: "crud-entity",
      bindings: {
        Entity: { type: "User" },
        IdType: { type: "UserID" },
        storage_effect: "database.write",
      },
    };
    const productInstance: AetherTemplateInstance = {
      id: "product_crud",
      template: "crud-entity",
      bindings: {
        Entity: { type: "Product" },
        IdType: { type: "ProductID" },
        storage_effect: "database.write",
      },
    };

    const userResult = instantiateTemplate(crudTemplate, userInstance);
    const productResult = instantiateTemplate(crudTemplate, productInstance);

    expect(userResult.success).toBe(true);
    expect(productResult.success).toBe(true);

    const userIds = new Set(userResult.nodes.map(n => n.id));
    const productIds = new Set(productResult.nodes.map(n => n.id));

    // No overlap
    for (const id of productIds) {
      expect(userIds.has(id)).toBe(false);
    }
  });

  it("type substitution works in contracts", () => {
    const instance: AetherTemplateInstance = {
      id: "user_crud",
      template: "crud-entity",
      bindings: {
        Entity: { type: "User" },
        IdType: { type: "UserID" },
        storage_effect: "database.write",
      },
    };

    const result = instantiateTemplate(crudTemplate, instance);
    expect(result.success).toBe(true);

    // Verify type substitution in port types
    const readNode = result.nodes.find(n => n.id === "user_crud_read_entity")!;
    expect(readNode.in.entity_id.type).toBe("UserID");
    expect(readNode.out.entity.type).toBe("User");
  });

  it("effect substitution works", () => {
    const instance: AetherTemplateInstance = {
      id: "user_crud",
      template: "crud-entity",
      bindings: {
        Entity: { type: "User" },
        IdType: { type: "UserID" },
        storage_effect: "database.write",
      },
    };

    const result = instantiateTemplate(crudTemplate, instance);
    expect(result.success).toBe(true);

    const createNode = result.nodes.find(n => n.id === "user_crud_create_entity")!;
    expect(createNode.effects).toContain("database.write");
    expect(createNode.effects).not.toContain("$storage_effect");
  });

  it("edge references are prefixed correctly", () => {
    const instance: AetherTemplateInstance = {
      id: "user_crud",
      template: "crud-entity",
      bindings: {
        Entity: { type: "User" },
        IdType: { type: "UserID" },
        storage_effect: "database.write",
      },
    };

    const result = instantiateTemplate(crudTemplate, instance);
    expect(result.success).toBe(true);

    expect(result.edges[0].from).toBe("user_crud_validate_input.validated");
    expect(result.edges[0].to).toBe("user_crud_create_entity.data");
  });

  it("missing required parameter binding produces error", () => {
    const instance: AetherTemplateInstance = {
      id: "bad",
      template: "crud-entity",
      bindings: {
        Entity: { type: "User" },
        // Missing IdType and storage_effect
      },
    };

    const result = instantiateTemplate(crudTemplate, instance);
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('"IdType"') && e.includes("requires a binding"))).toBe(true);
    expect(result.errors.some(e => e.includes('"storage_effect"') && e.includes("requires a binding"))).toBe(true);
  });

  it("wrong binding kind (type where value expected) produces error", () => {
    const templateWithValue: AetherTemplate = {
      id: "test",
      parameters: [{ name: "max_retries", kind: "value", constraint: "> 0" }],
      nodes: [{
        id: "n",
        in: {},
        out: {},
        contract: {},
        effects: [],
        pure: true,
      }],
      edges: [],
    };

    const instance: AetherTemplateInstance = {
      id: "bad",
      template: "test",
      bindings: {
        max_retries: { type: "Int" }, // Object instead of literal value
      },
    };

    const result = instantiateTemplate(templateWithValue, instance);
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes("max_retries") && e.includes("literal value"))).toBe(true);
  });

  it("constraint violation on binding produces error", () => {
    const templateWithValue: AetherTemplate = {
      id: "test",
      parameters: [{ name: "max_retries", kind: "value", constraint: "> 0" }],
      nodes: [{
        id: "n",
        in: {},
        out: {},
        contract: {},
        effects: [],
        pure: true,
      }],
      edges: [],
    };

    const instance: AetherTemplateInstance = {
      id: "bad",
      template: "test",
      bindings: {
        max_retries: 0,
      },
    };

    const result = instantiateTemplate(templateWithValue, instance);
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes("does not satisfy constraint"))).toBe(true);
  });
});
