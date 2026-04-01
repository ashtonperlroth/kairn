// Eval templates
export type EvalTemplate = 'add-feature' | 'fix-bug' | 'refactor' | 'test-writing' | 'config-change' | 'documentation' | 'convention-adherence' | 'workflow-compliance' | 'rule-compliance';

// Rubric criterion for scored evaluations
export interface RubricCriterion {
  criterion: string;
  weight: number;
}

// Task definition
export interface Task {
  id: string;
  template: EvalTemplate;
  description: string;
  setup: string;
  expected_outcome: string | string[];
  scoring: 'pass-fail' | 'llm-judge' | 'rubric';
  rubric?: RubricCriterion[];
  timeout: number;
}

// Task execution result
export interface Score {
  pass: boolean;
  score?: number;
  details?: string;
  reasoning?: string;
  breakdown?: Array<{ criterion: string; score: number; weight: number }>;
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
  scorer: 'pass-fail' | 'llm-judge' | 'rubric';
  maxIterations: number;
  parallelTasks: number;
}

// Shape of parsed tasks.yaml
export interface TasksFile {
  tasks: Task[];
  config?: Partial<EvolveConfig>;
}

// Represents a snapshotted .claude/ directory
export interface HarnessSnapshot {
  path: string;
  iteration: number;
}

// Returned from runner after a task execution
export interface TaskResult {
  taskId: string;
  score: Score;
  traceDir: string;
}

// Raw output from Claude Code subprocess
export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  toolCalls: unknown[];
  filesChanged: Record<string, 'created' | 'modified' | 'deleted'>;
}

// Iteration metadata
export interface Iteration {
  iteration: number;
  score: number;
  timestamp: string;
  mutations: Mutation[];
  results: Record<string, Score>;
}

// Proposed change to harness
export interface Mutation {
  file: string;
  action: 'replace' | 'add_section' | 'create_file' | 'delete_section' | 'delete_file';
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

// Lightweight project info for task generation
export interface ProjectProfileSummary {
  language: string | null;
  framework: string | null;
  scripts: Record<string, string>;
  keyFiles: string[];
}

// Log entry for a single evolution iteration
export interface IterationLog {
  iteration: number;
  score: number;
  taskResults: Record<string, Score>;
  proposal: Proposal | null;    // null for iteration 0 (baseline eval) or rollback
  diffPatch: string | null;     // null for iteration 0 or rollback
  timestamp: string;
}

// Final result of an evolution run
export interface EvolveResult {
  iterations: IterationLog[];
  bestIteration: number;
  bestScore: number;
  baselineScore: number;
}

// Diff between two traces for the same task across iterations
export interface TraceDiff {
  taskId: string;
  iterA: number;
  iterB: number;
  scoreDelta: number;
  passChanged: boolean;
  stdoutDiff: string;
  filesChangedDiff: {
    added: string[];
    removed: string[];
    changed: string[];
  };
}

// A single counterfactual entry linking a mutation to its impact
export interface CounterfactualEntry {
  iteration: number;
  mutationSummary: string;
  helpedTasks: Array<{ taskId: string; delta: number }>;
  hurtTasks: Array<{ taskId: string; delta: number }>;
  netScoreDelta: number;
}

// Full counterfactual report across an evolution run
export interface CounterfactualReport {
  entries: CounterfactualEntry[];
}

// Machine-readable evolution report
export interface EvolutionReport {
  overview: {
    title: string;
    totalIterations: number;
    baselineScore: number;
    bestScore: number;
    bestIteration: number;
    improvement: number;
  };
  iterations: Array<{
    iteration: number;
    score: number;
    mutationCount: number;
    status: string;
  }>;
  leaderboard: Array<{
    taskId: string;
    scores: Record<number, number>;
    bestIteration: number;
    bestScore: number;
  }>;
  counterfactuals: CounterfactualReport;
}

// Progress events emitted during the evolution loop
export interface LoopProgressEvent {
  type: 'iteration-start' | 'iteration-scored' | 'rollback' | 'proposing' | 'proposer-error' | 'mutations-applied' | 'perfect-score' | 'task-start' | 'task-scored' | 'complete';
  iteration: number;
  score?: number;
  mutationCount?: number;
  message?: string;
  taskId?: string;
}
