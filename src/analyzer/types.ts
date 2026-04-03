/** Core analysis result describing a project's architecture and structure. */
export interface ProjectAnalysis {
  purpose: string;
  domain: string;
  key_modules: AnalysisModule[];
  workflows: AnalysisWorkflow[];
  architecture_style: string;
  deployment_model: string;
  dataflow: DataflowEdge[];
  config_keys: ConfigKey[];
  // Cache metadata
  sampled_files: string[];
  content_hash: string;
  analyzed_at: string;
}

/** A logical module within the analyzed project. */
export interface AnalysisModule {
  name: string;
  path: string;
  description: string;
  responsibilities: string[];
}

/** A workflow or process identified in the project. */
export interface AnalysisWorkflow {
  name: string;
  description: string;
  trigger: string;
  steps: string[];
}

/** A directed edge in the project's data flow graph. */
export interface DataflowEdge {
  from: string;
  to: string;
  data: string;
}

/** A configuration key used by the project. */
export interface ConfigKey {
  name: string;
  purpose: string;
}

/**
 * Result returned by `analyzeProject()`, containing both the structured
 * analysis and the raw packed source code for downstream consumers.
 */
export interface AnalysisResult {
  /** Structured analysis of the project's architecture, modules, and workflows. */
  analysis: ProjectAnalysis;
  /** Raw packed source code from Repomix sampling. Empty string if unavailable. */
  packedSource: string;
}

/** Error thrown during project analysis with a typed error category. */
export class AnalysisError extends Error {
  constructor(
    message: string,
    public readonly type:
      | 'no_entry_point'
      | 'empty_sample'
      | 'llm_parse_failure'
      | 'repomix_failure',
    public readonly details?: string,
  ) {
    super(message);
    this.name = 'AnalysisError';
  }
}
