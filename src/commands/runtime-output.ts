import { collectAndWriteKeys, writeEmptyEnvFile } from "../secrets.js";
import { ui } from "../ui.js";
import {
  resolveRuntimeAdapter,
  assertRuntimeAdapterCompatibility,
  AdapterCompatibilityError,
  UnknownRuntimeTargetError,
  UnsupportedRuntimeTargetError,
  type RuntimeAdapter,
} from "../adapter/registry.js";
import type { EnvironmentSpec, RegistryTool } from "../types.js";
import type { EnvSetupInfo } from "../adapter/claude-code.js";

export function resolveRuntimeAdapterForCommand(runtime: string | undefined): RuntimeAdapter {
  try {
    return resolveRuntimeAdapter(runtime);
  } catch (err) {
    if (err instanceof UnknownRuntimeTargetError || err instanceof UnsupportedRuntimeTargetError) {
      console.log(ui.error(err.message));
      process.exit(1);
    }
    throw err;
  }
}

export async function writeRuntimeEnvironment(options: {
  adapter: RuntimeAdapter;
  spec: EnvironmentSpec;
  registry: RegistryTool[];
  targetDir: string;
  envSetup: EnvSetupInfo[];
  pluginCommands: string[];
  quick?: boolean;
}): Promise<void> {
  try {
    assertRuntimeAdapterCompatibility(options.adapter, options.spec, options.registry);
  } catch (err) {
    if (err instanceof AdapterCompatibilityError) {
      console.log(
        ui.errorBox(
          "Runtime compatibility error",
          err.issues.map((issue) => `- ${issue.message}`).join("\n"),
        ),
      );
      process.exit(1);
    }
    throw err;
  }

  const written = await options.adapter.write({
    spec: options.spec,
    registry: options.registry,
    targetDir: options.targetDir,
  });

  if (written.length > 0) {
    console.log(ui.section("Files Written"));
    console.log("");
    for (const file of written) {
      console.log(ui.file(file));
    }
  }

  if (
    options.adapter.envSetupStrategy === "project-env-file" &&
    options.envSetup.length > 0
  ) {
    if (options.quick) {
      await writeEmptyEnvFile(options.envSetup, options.targetDir);
      console.log(ui.success("Empty .env written (gitignored) - fill in keys later: kairn keys"));
    } else {
      await collectAndWriteKeys(options.envSetup, options.targetDir);
    }
    console.log("");
  }

  if (
    options.adapter.pluginInstructionStrategy === "project-cli" &&
    options.pluginCommands.length > 0
  ) {
    console.log(ui.section("Plugins"));
    console.log("");
    for (const cmd of options.pluginCommands) {
      console.log(ui.cmd(cmd));
    }
    console.log("");
  }

  console.log(ui.divider());
  console.log(ui.success(`Ready! Run: $ ${options.adapter.launchCommand}`));
  console.log("");
}
