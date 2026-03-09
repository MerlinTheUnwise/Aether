/**
 * AETHER Implementations — Type Definitions
 *
 * Defines the interface all node implementations conform to.
 * Implementations are async functions that take typed inputs and return typed outputs.
 */

// A node implementation is an async function that takes typed inputs and returns typed outputs
export type NodeImplementation = (
  inputs: Record<string, any>,
  context: ImplementationContext
) => Promise<Record<string, any>>;

export interface ImplementationContext {
  nodeId: string;
  effects: string[];                 // declared effects — implementation MUST stay within these
  confidence: number;                // declared confidence
  reportEffect: (effect: string) => void;  // call this when performing an effect
  log: (message: string) => void;    // structured logging
  getService?<T>(name: string): T;   // pull a service from the ServiceContainer
}

// Metadata about an implementation
export interface ImplementationMeta {
  id: string;                         // matches node ID or pattern
  description: string;
  inputTypes: Record<string, string>; // expected input types
  outputTypes: Record<string, string>;// guaranteed output types
  effects: string[];                  // effects this implementation performs
  pure: boolean;
  deterministic: boolean;
}

// A registered implementation with its metadata
export interface RegisteredImplementation {
  meta: ImplementationMeta;
  fn: NodeImplementation;
}
