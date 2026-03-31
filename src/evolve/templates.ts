import type { EvalTemplate } from './types.js';

interface TemplateMetadata {
  id: EvalTemplate;
  name: string;
  description: string;
  bestFor: string[];
}

export const EVAL_TEMPLATES: Record<EvalTemplate, TemplateMetadata> = {
  'add-feature': {
    id: 'add-feature',
    name: 'Add Feature',
    description: 'Can the agent add a new capability?',
    bestFor: ['feature-development', 'api-building', 'full-stack'],
  },
  'fix-bug': {
    id: 'fix-bug',
    name: 'Fix Bug',
    description: 'Can the agent diagnose and fix a problem?',
    bestFor: ['maintenance', 'debugging', 'qa'],
  },
  'refactor': {
    id: 'refactor',
    name: 'Refactor',
    description: 'Can the agent restructure code?',
    bestFor: ['maintenance', 'architecture', 'backend'],
  },
  'test-writing': {
    id: 'test-writing',
    name: 'Test Writing',
    description: 'Can the agent write tests?',
    bestFor: ['tdd', 'qa', 'backend'],
  },
  'config-change': {
    id: 'config-change',
    name: 'Config Change',
    description: 'Can the agent update configuration?',
    bestFor: ['devops', 'infrastructure', 'backend'],
  },
  'documentation': {
    id: 'documentation',
    name: 'Documentation',
    description: 'Can the agent write and update docs?',
    bestFor: ['content', 'api-building', 'full-stack'],
  },
};

export function selectTemplatesForWorkflow(workflowType: string): EvalTemplate[] {
  const mapping: Record<string, EvalTemplate[]> = {
    'feature-development': ['add-feature', 'test-writing', 'documentation'],
    'api-building': ['add-feature', 'fix-bug', 'test-writing'],
    'full-stack': ['add-feature', 'fix-bug', 'test-writing'],
    'maintenance': ['fix-bug', 'refactor', 'test-writing'],
    'debugging': ['fix-bug', 'test-writing'],
    'qa': ['fix-bug', 'test-writing', 'add-feature'],
    'architecture': ['refactor', 'test-writing', 'config-change'],
    'backend': ['fix-bug', 'refactor', 'config-change', 'test-writing'],
    'devops': ['config-change', 'fix-bug'],
    'infrastructure': ['config-change', 'refactor'],
    'tdd': ['test-writing', 'add-feature', 'fix-bug'],
    'content': ['documentation', 'add-feature'],
    'research': ['documentation', 'add-feature'],
  };
  return mapping[workflowType] || ['add-feature', 'fix-bug', 'test-writing'];
}
