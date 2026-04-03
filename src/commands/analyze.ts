/**
 * `kairn analyze` — Analyze project source code to understand purpose,
 * architecture, and workflows.
 *
 * Runs a semantic scan + LLM analysis pipeline and displays a structured
 * breakdown of the project. Supports `--json` for machine-readable output
 * and `--refresh` to bypass the on-disk cache.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../config.js';
import { scanProject } from '../scanner/scan.js';
import { analyzeProject } from '../analyzer/analyze.js';
import { AnalysisError } from '../analyzer/types.js';
import type { ProjectAnalysis } from '../analyzer/types.js';
import { readCache } from '../analyzer/cache.js';
import { ui } from '../ui.js';
import { printCompactBanner } from '../logo.js';

/** Options accepted by the analyze command. */
export interface AnalyzeOptions {
  refresh?: boolean;
  json?: boolean;
  tokenBudget?: number;
}

/**
 * Core action handler for the `kairn analyze` command.
 *
 * Extracted as a named export to allow direct invocation from tests
 * without going through Commander's argument parsing layer.
 */
export async function analyzeAction(options: AnalyzeOptions): Promise<void> {
  // If --json, suppress all non-JSON output
  if (!options.json) {
    printCompactBanner();
  }

  const config = await loadConfig();
  if (!config) {
    if (options.json) {
      console.log(
        JSON.stringify({ error: 'No config found. Run kairn init first.' }),
      );
    } else {
      console.log(
        ui.errorBox(
          'KAIRN — Error',
          'No config found. Run kairn init first.',
        ),
      );
    }
    process.exit(1);
  }

  const targetDir = process.cwd();

  // Scan project
  if (!options.json) {
    console.log(ui.section('Project Scan'));
  }
  const scanSpinner = options.json
    ? null
    : ora({ text: 'Scanning project...', indent: 2 }).start();
  const profile = await scanProject(targetDir);
  scanSpinner?.succeed('Project scanned');

  if (!options.json) {
    if (profile.language)
      console.log(ui.kv('Language:', profile.language));
    if (profile.framework)
      console.log(ui.kv('Framework:', profile.framework));
  }

  // Check cache status (for display)
  if (!options.json && !options.refresh) {
    const existingCache = await readCache(targetDir);
    if (existingCache) {
      const age =
        Date.now() -
        new Date(existingCache.analysis.analyzed_at).getTime();
      const hours = Math.floor(age / (1000 * 60 * 60));
      const minutes = Math.floor(
        (age % (1000 * 60 * 60)) / (1000 * 60),
      );
      const ageStr =
        hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
      console.log(ui.kv('Cache:', `found (${ageStr} old)`));
    }
  }

  // Analyze
  if (!options.json) {
    console.log(ui.section('Codebase Analysis'));
  }
  const analysisSpinner = options.json
    ? null
    : ora({
        text: options.refresh
          ? 'Analyzing from scratch...'
          : 'Analyzing source code...',
        indent: 2,
      }).start();

  let analysis: ProjectAnalysis;
  let packedSource = '';
  try {
    const result = await analyzeProject(targetDir, profile, config, {
      refresh: options.refresh,
      tokenBudget: options.tokenBudget,
    });
    analysis = result.analysis;
    packedSource = result.packedSource;
    analysisSpinner?.succeed(
      options.refresh ? 'Re-analyzed from scratch' : 'Codebase analyzed',
    );
  } catch (err) {
    analysisSpinner?.fail('Analysis failed');
    if (err instanceof AnalysisError) {
      if (options.json) {
        console.log(
          JSON.stringify({
            error: err.message,
            type: err.type,
            details: err.details,
          }),
        );
      } else {
        console.log(
          ui.errorBox('KAIRN — Analysis Error', err.message),
        );
        if (err.details) {
          console.log(chalk.dim(`  Details: ${err.details}`));
        }
        console.log('');
        console.log(chalk.dim(`  Error type: ${err.type}`));
      }
      process.exit(1);
    }
    throw err;
  }

  // Output
  if (options.json) {
    console.log(JSON.stringify(analysis, null, 2));
    return;
  }

  // Formatted output
  console.log(ui.kv('Purpose:', analysis.purpose));
  console.log(ui.kv('Domain:', analysis.domain));
  console.log(ui.kv('Architecture:', analysis.architecture_style));
  console.log(ui.kv('Deployment:', analysis.deployment_model));

  if (analysis.key_modules.length > 0) {
    console.log(ui.section('Key Modules'));
    for (const mod of analysis.key_modules) {
      console.log(
        `  ${chalk.bold(mod.name)} ${chalk.dim('(' + mod.path + ')')}`,
      );
      console.log(`    ${mod.description}`);
      if (mod.responsibilities.length > 0) {
        console.log(
          `    ${chalk.dim('Owns:')} ${mod.responsibilities.join(', ')}`,
        );
      }
    }
  }

  if (analysis.workflows.length > 0) {
    console.log(ui.section('Workflows'));
    for (const wf of analysis.workflows) {
      console.log(
        `  ${chalk.bold(wf.name)}: ${wf.description}`,
      );
      console.log(`    ${chalk.dim('Trigger:')} ${wf.trigger}`);
      console.log(
        `    ${chalk.dim('Steps:')} ${wf.steps.join(' \u2192 ')}`,
      );
    }
  }

  if (analysis.dataflow.length > 0) {
    console.log(ui.section('Dataflow'));
    for (const edge of analysis.dataflow) {
      console.log(
        `  ${edge.from} \u2192 ${edge.to}: ${chalk.dim(edge.data)}`,
      );
    }
  }

  if (analysis.config_keys.length > 0) {
    console.log(ui.section('Configuration'));
    for (const key of analysis.config_keys) {
      console.log(`  ${chalk.bold(key.name)}: ${key.purpose}`);
    }
  }

  // Footer
  console.log('');
  const packedStats = packedSource
    ? ` \u00B7 ${packedSource.length.toLocaleString()} chars packed`
    : '';
  console.log(
    chalk.dim(
      `  Sampled ${analysis.sampled_files.length} files${packedStats} \u00B7 analyzed ${analysis.analyzed_at}`,
    ),
  );
  console.log(ui.divider());
  console.log('');
}

export const analyzeCommand = new Command('analyze')
  .description(
    'Analyze project source code to understand purpose, architecture, and workflows',
  )
  .option('--refresh', 'Force re-analysis, bypassing cache')
  .option('--json', 'Output raw JSON (for piping)')
  .option('--token-budget <tokens>', 'Max tokens of source code to sample (default: 60000)', parseInt)
  .action(analyzeAction);
