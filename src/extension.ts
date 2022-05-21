import { ExtensionContext } from "vscode";
import { GodotTools } from "./godot-tools";
import { GDResourceProvider } from "./gdresource";
import * as vscode from "vscode";
import debuggerContext = require("./debugger/debugger_context");

let tools: GodotTools = null;
let provider: GDResourceProvider = null;


export function activate(context: ExtensionContext) {
	tools = new GodotTools(context);
	tools.activate();
	debuggerContext.register_debugger(context);

	provider = new GDResourceProvider();
    let docs = GDResourceProvider.docs;
	context.subscriptions.push(
		vscode.languages.registerDocumentSymbolProvider(docs, provider)
	);
	context.subscriptions.push(
		vscode.languages.registerDefinitionProvider(docs, provider)
	);
	context.subscriptions.push(
		vscode.languages.registerHoverProvider(docs, provider)
	);
}

export function deactivate(): Thenable<void> {
	return new Promise<void>((resolve, reject) => {
		tools.deactivate();
		resolve();
	});
}
