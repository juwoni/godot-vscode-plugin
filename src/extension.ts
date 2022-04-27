import { ExtensionContext } from "vscode";
import { GodotTools } from "./godot-tools";
import { GodotAnalyzer } from "./analyzer/analyzer";
import debuggerContext = require("./debugger/debugger_context");

let tools: GodotTools = null;
let analyzer: GodotAnalyzer = null;

export function activate(context: ExtensionContext) {
	tools = new GodotTools(context);
	tools.activate();
	debuggerContext.register_debugger(context);
	analyzer = new GodotAnalyzer(context);
	analyzer.activate();
}

export function deactivate(): Thenable<void> {
	return new Promise<void>((resolve, reject) => {
		tools.deactivate();
        analyzer.deactivate();
		resolve();
	});
}
