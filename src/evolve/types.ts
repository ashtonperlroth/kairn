// Eval templates
export type EvalTemplate = 'add-feature' | 'fix-bug' | 'refactor' | 'test-writing' | 'config-change' | 'documentation';

// Task definition
export interface Task {
  id: string;
  template: EvalTemplate;
  description: string;
  setup: string;
  expected_outcome: string | string[];
  scoring: 'pass-fail' | 'llm-judge' | 'rubric';
  rubric?: Array<{ criterion: string; weight: number }>;
  timeout: number;
}

// Task execution result
export interface Score {
  pass: boolean;
  score?: number;
  details?: string;
  reasoning?: string;
}

// Full execution trace for a single task run
export interface Trace {
  taskId: string;
  iteration: number;
  stdout: string;
  stderr: string;
  toolCalls: unknown[];
  filesChanged: Record<string, 'created' | 'modified' | 'deleted'>;
  score: Score;
  timing: {
    startedAt: string;
    completedAt: string;
    durationMs: number;
  };
}

// Config file for evolution run
export interface EvolveConfig {
  model: string;
  proposerModel: string;
  scorer: 'pass-fail' | 'llm-judge';
  maxIterations: number;
  parallelTasks: number;
}

// Iteration metadata
export interface Iteration {
  iteration: number;
  score: number;
  timestamp: string;
  mutations: Mutation[];
  results: Map<string, Score>;
}

// Proposed change to harness
export interface Mutation {
  file: string;
  action: 'replace' | 'add_section' | 'create_file';
  oldText?: string;
  newText: string;
  rationale: string;
}

// Result of proposer's analysis
export interface Proposal {
  reasoning: string;
  mutations: Mutation[];
  expectedImpact: Record<string, string>;
}
