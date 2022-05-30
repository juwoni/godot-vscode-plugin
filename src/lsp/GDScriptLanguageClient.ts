import * as vscode from 'vscode';
import { Uri, Position, Range, TextDocument } from "vscode";
import { LanguageClient, LanguageClientOptions, ServerOptions, RequestMessage } from "vscode-languageclient/node";
import { is_debug_mode, get_configuration } from "../utils";
import { MessageIO, MessageIOReader, MessageIOWriter, Message, WebsocktMessageIO, TCPMessageIO } from "./MessageIO";
import logger from "../loggger";
import { EventEmitter } from "events";
import NativeDocumentManager from './NativeDocumentManager';

export enum ClientStatus {
	PENDING,
	DISCONNECTED,
	CONNECTED,
}
const CUSTOM_MESSAGE = "gdscrip_client/";

export default class GDScriptLanguageClient extends LanguageClient {

	public readonly io: MessageIO = (get_configuration("gdscript_lsp_server_protocol", "tcp") == "ws") ? new WebsocktMessageIO() : new TCPMessageIO();

	private context: vscode.ExtensionContext;
	private _started : boolean = false;
	private _status : ClientStatus;
	private _status_changed_callbacks: ((v : ClientStatus)=>void)[] = [];
	private _initialize_request: Message = null;
	private message_handler: MessageHandler = null;
	private native_doc_manager: NativeDocumentManager = null;
    private document: TextDocument = null

	public get started() : boolean { return this._started; }
	public get status() : ClientStatus { return this._status; }
	public set status(v : ClientStatus) {
		if (this._status != v) {
			this._status = v;
			for (const callback of this._status_changed_callbacks) {
				callback(v);
			}
		}
	}

	public watch_status(callback: (v : ClientStatus)=>void) {
		if (this._status_changed_callbacks.indexOf(callback) == -1) {
			this._status_changed_callbacks.push(callback);
		}
	}

	constructor(context: vscode.ExtensionContext) {
		super(
			`GDScriptLanguageClient`,
			() => {
				return new Promise((resolve, reject) => {
					resolve({reader: new MessageIOReader(this.io), writer: new MessageIOWriter(this.io)});
				});
			},
			{
				// Register the server for plain text documents
				documentSelector: [
					{ scheme: "file", language: "gdscript" },
					{ scheme: "untitled", language: "gdscript" },
				],
				synchronize: {
					// Notify the server about file changes to '.gd files contain in the workspace
					// fileEvents: workspace.createFileSystemWatcher("**/*.gd"),
				},
			}
		);
		this.context = context;
		this.status = ClientStatus.PENDING;
		this.message_handler = new MessageHandler(this.io);
		this.io.on('disconnected', this.on_disconnected.bind(this));
		this.io.on('connected', this.on_connected.bind(this));
		this.io.on('message', this.on_message.bind(this));
		this.io.on('send_message', this.on_send_message.bind(this));
		this.native_doc_manager = new NativeDocumentManager(this.io);
	}

	connect_to_server() {
		this.status = ClientStatus.PENDING;
		let host = get_configuration("gdscript_lsp_server_host", "127.0.0.1");
		let port = get_configuration("gdscript_lsp_server_port", 6008);
		this.io.connect_to_language_server(host, port);
	}

	start(): vscode.Disposable {
		this._started = true;
		return super.start();
	}

	private on_send_message(message: Message) {
		if (is_debug_mode()) {
			logger.log("[client]", JSON.stringify(message));
		}

        if ((message as RequestMessage).method == "textDocument/documentLink") {
            this.open_document(message);
        }

		if ((message as RequestMessage).method == "initialize") {
			this._initialize_request = message;
		}
	}

    private async open_document(message) {
        logger.log("[open_document]");
        // const file = message.params.textDocument.uri;
        // const uri = vscode.Uri.file(file);


        // for (const d in vscode.workspace.textDocuments) {
            
        //     logger.log("[open_document]", d, vscode.workspace.textDocuments[d].fileName);
        // }
        // this.document = await vscode.workspace.openTextDocument(uri);
        
        // logger.log("[open_document]", this.document.getText());
    }

	private on_message(message: Message) {
		if (is_debug_mode()) {
			logger.log("[server]", JSON.stringify(message));
		}
        
        // dirty hack to remove extra brackets from completions
        // this could be improved by inspecting the relevant
        // document for the context around the cursor, and only stripping the
        // bracket if
        

        if (message && message.result && message.result.insertText) {
            if (message.result.insertText.endsWith("(")) {
                message = this.fix_message(message)
            }
        }
		this.message_handler.on_message(message);
	}

	private on_connected() {
		if (this._initialize_request) {
			this.io.writer.write(this._initialize_request);
		}
		this.status = ClientStatus.CONNECTED;
	}

	private on_disconnected() {
		this.status = ClientStatus.DISCONNECTED;
	}

    private async fix_message(message) {
        let text = message.result.insertText;
        const result = message.result;
        const data = message.result.data;
        let document;
        let line;

        logger.log("[fix_message]", 'insertText', text);
        // logger.log("[fix_message]", JSON.stringify(message.result));
        // logger.log("[fix_message]", JSON.stringify(message.result.data));

        // logger.log("[fix_message]", "trimming (");
        text = text.substring(0, text.length - 1);

        // if (this.document) {
            
        // }

        if (data && data.textDocument && data.textDocument.uri) {
            for (const d in vscode.workspace.textDocuments) {
                const f = vscode.workspace.textDocuments[d].fileName;

                // if (f == data.textDocument.uri)
            
                logger.log("[fix_message]", f);
                logger.log("[fix_message]", data.textDocument.uri);
                
            }


            // let path = data.textDocument.uri
            // path = path.replace("%3A", ":")
            // logger.log("[fix_message]", "path", path);
            // const uri = vscode.Uri.file(path)
            // document = await vscode.workspace.openTextDocument(uri);
            // line = document.lineAt(data.position.line);

            // logger.log("[fix_message]", line.text);
            // logger.log("[fix_message]", line.text[data.position.character + 1]);

        }

        message.result.insertText = text;
        return message;
    }
}




class MessageHandler extends EventEmitter {

	private io: MessageIO = null;

	constructor(io: MessageIO) {
		super();
		this.io = io;
	}

	changeWorkspace(params: {path: string}) {
		vscode.window.showErrorMessage("The GDScript language server can't work properly!\nThe open workspace is different from the editor's.", 'Reload', 'Ignore').then(item=>{
			if (item == "Reload") {
				let folderUrl = vscode.Uri.file(params.path);
				vscode.commands.executeCommand('vscode.openFolder', folderUrl, false);
			}
		});
	}

	on_message(message: any) {

		// FIXME: Hot fix VSCode 1.42 hover position
		if (message && message.result && message.result.range && message.result.contents) {
			message.result.range = undefined;
		}

		if (message && message.method && (message.method as string).startsWith(CUSTOM_MESSAGE)) {
			const method = (message.method as string).substring(CUSTOM_MESSAGE.length, message.method.length);
			if (this[method]) {
				let ret = this[method](message.params);
				if (ret) {
					this.io.writer.write(ret);
				}
			}
		}
	}
}
