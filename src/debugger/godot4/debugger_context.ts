import {
	ExtensionContext,
	debug,
	DebugConfigurationProvider,
	WorkspaceFolder,
	DebugAdapterInlineImplementation,
	DebugAdapterDescriptorFactory,
	DebugConfiguration,
	DebugAdapterDescriptor,
	DebugSession,
	CancellationToken,
	ProviderResult,
	window,
} from "vscode";
import { GodotDebugSession } from "./debug_session";
import fs = require("fs");
import { SceneTreeProvider } from "../scene_tree_provider";
import { createLogger } from "../../logger";

const log = createLogger("debugger.context");

export class Godot4Debugger implements DebugAdapterDescriptorFactory {
	public provider: GodotConfigurationProvider;
	public session?: GodotDebugSession;

	constructor(
		context: ExtensionContext, 
		private scene_tree_provider: SceneTreeProvider,
	) {
		this.provider = new GodotConfigurationProvider();

		context.subscriptions.push(
			debug.registerDebugConfigurationProvider("godot4", this.provider),
			debug.registerDebugAdapterDescriptorFactory("godot4", this),
		);

		context.subscriptions.push(this);
	}

	public createDebugAdapterDescriptor(
		session: DebugSession
	): ProviderResult<DebugAdapterDescriptor> {
		this.session = new GodotDebugSession();
		this.session.set_scene_tree(this.scene_tree_provider);
		return new DebugAdapterInlineImplementation(this.session);
	}

	public dispose() {
		this.session.dispose();
		this.session = undefined;
	}

	public notify(event: string, parameters: any[] = []) {
		log.info(event, JSON.stringify(parameters));

		// Mediator.notify(event, parameters);
	}
}

class GodotConfigurationProvider implements DebugConfigurationProvider {
	public resolveDebugConfiguration(
		folder: WorkspaceFolder | undefined,
		config: DebugConfiguration,
		token?: CancellationToken
	): ProviderResult<DebugConfiguration> {
		if (!config.type && !config.request && !config.name) {
			const editor = window.activeTextEditor;
			if (editor && fs.existsSync(`${folder.uri.fsPath}/project.godot`)) {
				config.type = "godot4";
				config.name = "Debug Godot";
				config.request = "launch";
				config.project = "${workspaceFolder}";
				config.port = 6007;
				config.address = "127.0.0.1";
				config.additional_options = "";
			}
		}

		if (config.request === "launch") {
			if (config.address == undefined) {
				config.address = "127.0.0.1";
			}
			if (config.port == undefined) {
				config.port = 6007;
			}
		}

		if (config.request === "launch" && !config.project) {
			return window
				.showInformationMessage(
					"Cannot find a project.godot in active workspace."
				)
				.then(() => {
					return undefined;
				});
		}
		return config;
	}
}
