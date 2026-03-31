import chalk from "chalk";

// Brand colors
const maroon = chalk.rgb(139, 0, 0);
const warm = chalk.rgb(212, 165, 116);

export const ui = {
  // Brand
  brand: (text: string) => maroon.bold(text),
  accent: (text: string) => warm(text),

  // Headers
  header: (text: string) => {
    const line = "─".repeat(50);
    return `\n  ${maroon("┌" + line + "┐")}\n  ${maroon("│")} ${maroon.bold(text.padEnd(49))}${maroon("│")}\n  ${maroon("└" + line + "┘")}\n`;
  },

  // Sections
  section: (title: string) => `\n  ${warm("━━")} ${chalk.bold(title)} ${warm("━".repeat(Math.max(0, 44 - title.length)))}`,

  // Status
  success: (text: string) => chalk.green(`  ✓ ${text}`),
  warn: (text: string) => chalk.yellow(`  ⚠ ${text}`),
  error: (text: string) => chalk.red(`  ✗ ${text}`),
  info: (text: string) => chalk.cyan(`  ℹ ${text}`),

  // Key-value pairs
  kv: (key: string, value: string) => `  ${chalk.cyan(key.padEnd(14))} ${value}`,

  // File list
  file: (path: string) => chalk.dim(`    ${path}`),

  // Tool display
  tool: (name: string, reason: string) => `    ${warm("●")} ${chalk.bold(name)}\n      ${chalk.dim(reason)}`,

  // Divider
  divider: () => chalk.dim(`  ${"─".repeat(50)}`),

  // Command suggestion
  cmd: (command: string) => `    ${chalk.bold.white("$ " + command)}`,

  // Env var setup
  envVar: (name: string, desc: string, url?: string) => {
    let out = `    ${chalk.bold(`export ${name}=`)}${chalk.dim('"your-key-here"')}\n`;
    out += chalk.dim(`      ${desc}`);
    if (url) out += `\n      ${chalk.dim("Get one at:")} ${warm(url)}`;
    return out;
  },

  // Clarification question display
  question: (q: string, suggestion: string) =>
    `  ${warm("?")} ${chalk.bold(q)}\n    ${chalk.dim(`suggested: ${suggestion}`)}`,

  // Branded error box
  errorBox: (title: string, message: string) => {
    const line = "─".repeat(50);
    return `\n  ${chalk.red("┌" + line + "┐")}\n  ${chalk.red("│")} ${chalk.red.bold(title.padEnd(49))}${chalk.red("│")}\n  ${chalk.red("└" + line + "┘")}\n\n  ${chalk.red("✗")} ${message}\n`;
  },
};
