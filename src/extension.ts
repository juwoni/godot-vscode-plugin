import { ExtensionContext } from "vscode";
import { GodotTools } from "./godot-tools";
import { GodotDebugManager } from "./debugger/debugger";
import { shouldUpdateSettings, updateOldStyleSettings, updateStoredVersion } from "./settings_updater";

let tools: GodotTools = null;
let debugManager: GodotDebugManager = null;

export function activate(context: ExtensionContext) {
	if (shouldUpdateSettings(context)) {
		updateOldStyleSettings();
	}
	updateStoredVersion(context);

	tools = new GodotTools(context);
	tools.activate();
	
	debugManager = new GodotDebugManager(context);
}

export function deactivate(): Thenable<void> {
	return new Promise<void>((resolve, reject) => {
		tools.deactivate();
		resolve();
	});
}
