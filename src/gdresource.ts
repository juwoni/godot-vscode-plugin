import * as vscode from "vscode";
import { Uri, Position, Range, TextDocument } from "vscode";

export class GDResourceProvider
	implements
		vscode.DocumentLinkProvider,
		vscode.InlayHintsProvider,
		vscode.DocumentSymbolProvider,
		vscode.DefinitionProvider,
		vscode.HoverProvider
{
	private context: vscode.ExtensionContext;
	private output: vscode.OutputChannel;
	public project_file = "";
	public project_dir = "";

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
		this.output = vscode.window.createOutputChannel("Godot");

		const disposables = [
			vscode.languages.registerDocumentSymbolProvider(["gdresource"], this),
			vscode.languages.registerDefinitionProvider(["gdresource"], this),
			vscode.languages.registerHoverProvider(["gdresource"], this),
			// vscode.languages.registerInlayHintsProvider(["gdresource"], this),
			vscode.languages.registerDocumentLinkProvider(
				["gdscript", "gdresource"],
				this
			),
		];

		for (const d in disposables) {
			context.subscriptions.push(disposables[d]);
		}
	}

	private print(value: any) {
		this.output.appendLine(String(value));
	}

	defs: { [uri: string]: GDResource | undefined } = {};

	async provideInlayHints(
		document: vscode.TextDocument,
		range: vscode.Range,
		token: vscode.CancellationToken
	): Promise<vscode.InlayHint[]> {
		const gdasset = this.defs[document.uri.toString(true)];
		let hints = [];

		let lines = document.getText().split("\n");
		for (let i = 0; i < lines.length; i++) {
			const match = lines[i].match(/ExtResource/);
			if (match) {
				const line = document.lineAt(i);
				const m = line.text.match(/ExtResource\( (\d+) \)/);
				const end = line.range.end;
				const id = m[1];
				const s = gdasset.ids["ExtResource"][id];
				const part = new vscode.InlayHintLabelPart(s.name);
				hints.push(new vscode.InlayHint(end, [part]));
			}
		}

		return hints;
	}

	async resolveInlayHint(
		hint: vscode.InlayHint,
		token: vscode.CancellationToken
	): Promise<vscode.InlayHint> {
		return hint;
	}

	async provideDocumentLinks(
		document: vscode.TextDocument,
		token: vscode.CancellationToken
	): Promise<vscode.DocumentLink[]> {
		let links = [];
		let lines = document.getText().split("\n");
		for (let i = 0; i < lines.length; i++) {
			const match = lines[i].match(/res:\/\/[^"]*/);
			if (match) {
				const start = new Position(i, match.index);
				const end = new Position(i, match.index + match[0].length);
				const r = new Range(start, end);
				const uri = await resPathToUri(match[0], document);
				if (uri instanceof Uri) {
					links.push(new vscode.DocumentLink(r, uri));
				}
			}
		}
		return links;
	}

	async resolveDocumentLink(
		link: any,
		token: vscode.CancellationToken
	): Promise<vscode.DocumentLink> {
		return;
	}

	async provideDocumentSymbols(
		document: vscode.TextDocument,
		token: vscode.CancellationToken
	): Promise<vscode.DocumentSymbol[]> {
		const gdasset =
			document.languageId == "config-definition"
				? null
				: (this.defs[document.uri.toString(true)] = new GDResource());
		let previousEnd: vscode.Position | undefined;
		let currentSection: vscode.DocumentSymbol | undefined;
		let currentProperty: vscode.DocumentSymbol | null = null;
		const symbols: vscode.DocumentSymbol[] = [];
		const n = document.lineCount;
		for (let i = 0, j = 0; i < n; ) {
			const range = document.validateRange(new vscode.Range(i, j, i, Infinity));
			const text = document.getText(range);
			let match;
			if (
				j == 0 &&
				(match = text.match(
					/^(\[\s*([\p{L}\w-]+(?:\s+[\p{L}\w-]+|\s+"[^"\\]*")*(?=\s*\])|[^\[\]\s]+)\s*(.*?)\s*\])\s*([;#].*)?$/u
				))
			) {
				// Section Header
				if (currentSection && previousEnd)
					currentSection.range = new vscode.Range(
						currentSection.range.start,
						previousEnd
					);
				if (gdasset)
					currentSection = makeSectionSymbol(document, match, range, gdasset);
				else {
					const [, header, tag, rest] = match;
					currentSection = new vscode.DocumentSymbol(
						tag,
						rest,
						vscode.SymbolKind.Object,
						range,
						range
					);
				}
				symbols.push(currentSection);
				currentProperty = null;
				previousEnd = range.end;
				i++;
				continue;
			} else if (
				j == 0 &&
				(match = text.match(
					/^\s*(((?:[\p{L}\w-]+[./])*[\p{L}\w-]+)(?:\s*\[([\w\\/.:!@$%+-]+)\])?)\s*=/u
				))
			) {
				// Property Assignment
				const [, prop, key, index] = match;
				let s = currentSection?.children ?? symbols;
				if (index) {
					const p = `${key}[]`;
					let parentProp = s.find((value) => value.name == p);
					if (!parentProp)
						s.push(
							(parentProp = new vscode.DocumentSymbol(
								p,
								"",
								vscode.SymbolKind.Array,
								range,
								range
							))
						);
					parentProp.range = new vscode.Range(
						parentProp.range.start,
						range.end
					);
					s = parentProp.children;
				}
				if (currentSection)
					currentSection.range = new vscode.Range(
						currentSection.range.start,
						range.end
					);
				currentProperty = new vscode.DocumentSymbol(
					prop,
					"",
					vscode.SymbolKind.Property,
					range,
					range
				);
				s.push(currentProperty);
				j = match[0].length;
				previousEnd = new vscode.Position(i, j);
				continue;
			} else if ((match = text.match(/^(\s*)([;#].*)?$/))) {
				// No more non-ignored tokens until end of line; only Line Comment or Whitespace
				if (gdasset && match[2]) {
					j += match[1].length;
					gdasset.comments.push({
						range: new vscode.Range(i, j, i, range.end.character),
						value: match[2],
					});
				}
				previousEnd = range.end;
				j = 0;
				i++;
				continue;
			}
			// Parse values within line
			if (text.startsWith('"')) {
				//TODO also check negative look-behind for any weird char touching open"
				// String
				let str = "";
				let s = text.substring(1);
				j++;
				lines: while (true) {
					for (const [sub] of s.matchAll(
						/"|(?:\\["nrt\\bf]|\\u[0-9A-Fa-f]{4}|\\$|\\?[^"\r\n])+/gmu
					)) {
						j += sub.length;
						if (sub == '"') break lines;
						str += unescapeString(sub);
					}
					str += "\n";
					j = 0;
					i++;
					if (i >= n) break;
					s = document.lineAt(i).text;
				}
				if (i >= n) break;
				if (gdasset)
					gdasset.strings.push({
						range: new vscode.Range(
							range.start.line,
							range.start.character,
							i,
							j
						),
						value: str,
					});
			} else if ((match = text.match(/^\s+/))) {
				// Whitespace
				j += match[0].length;
			} else {
				// Any other token
				match = text.match(/^[^"\s]+/);
				j += match![0].length;
			}
			if (currentProperty) {
				// Still in value of previous property
				const start = currentProperty.range.start;
				const endChar = i > range.end.line ? j : range.end.character;
				currentProperty.range = new vscode.Range(
					start.line,
					start.character,
					i,
					endChar
				);
			}
			previousEnd = new vscode.Position(i, j);
		}
		if (currentSection && previousEnd)
			currentSection.range = new vscode.Range(
				currentSection.range.start,
				previousEnd
			);
		return symbols;
	}

	async provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken
	): Promise<vscode.Definition | null> {
		if (document.languageId == "config-definition") {
			return null;
		}
		const gdasset = this.defs[document.uri.toString(true)];
		if (!gdasset || gdasset.commentContaining(position)) {
			return null;
		}
		const wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) {
			return null;
		}
		const word = document.getText(wordRange);
		const wordIsResPath = isResPath(word, wordRange, document);
		let match;
		if (wordIsResPath) {
			let resUri = await resPathToUri(word, document);
			if (resUri instanceof vscode.Uri)
				return new vscode.Location(resUri, new vscode.Position(0, 0));
		} else if (
			(match = word.match(/^((?:Ext|Sub)Resource)\s*\(\s*(\d+)\s*\)$/))
		) {
			const keyword = match[1] as "ExtResource" | "SubResource";
			const id = +match[2];
			const s = gdasset.ids[keyword][id];
			if (!s) {
				return null;
			}
			if (gdasset.stringContaining(position)) {
				return null;
			}
			if (keyword == "ExtResource") {
				let d = document.getText(s.selectionRange).indexOf(' path="');
				d = d < 0 ? 0 : d + 7;
				return new vscode.Location(document.uri, s.range.start.translate(0, d));
			}
			return new vscode.Location(document.uri, s.range);
		}
		{
			return null;
		}
	}

	async provideHover(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken
	): Promise<vscode.Hover | null> {
		if (document.languageId == "config-definition") {
			return null;
		}
		const gdasset = this.defs[document.uri.toString(true)];
		if (!gdasset || gdasset.commentContaining(position)) {
			return null;
		}
		const wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) {
			return null;
		}
		const word = document.getText(wordRange);
		const wordIsResPath = isResPath(word, wordRange, document);
		if (!wordIsResPath && gdasset.stringContaining(position)) {
			return null;
		}

		let hover = [];
		let resPath;
		let match;

		if (word == "ext_resource" || wordIsResPath) {
			const line = document.lineAt(position).text;
			match =
				/^\[\s*ext_resource\s+path\s*=\s*"([^"\\]*)"\s*type\s*=\s*"([^"\\]*)"/.exec(
					line
				);
			if (word == "ext_resource") {
				if (!match) {
					return null;
				}
				resPath = match[1];
			} else resPath = word;
			hover.push(preloadMarkdown(resPath, match ? match[2] : null));
		} else if (word == "sub_resource") {
			const line = document.lineAt(position).text;
			match =
				/^\[\s*sub_resource\s+type\s*=\s*"([^"\\]*)"\s*id\s*=\s*(\d+)\b/.exec(
					line
				);
			if (!match) {
				return null;
			}
			const [, type, id] = match;
			resPath = await resPathOfDocument(document);
			return new vscode.Hover(
				preloadMarkdown(`${resPath}::${id}`, type),
				wordRange
			);
		} else if (word == "gd_resource") {
			const line = document.lineAt(position).text;
			match = /^\[\s*gd_resource\s+type\s*=\s*"([^"\\]*)"/.exec(line);
			if (!match) {
				return null;
			}
			return new vscode.Hover(
				preloadMarkdown(await resPathOfDocument(document), match[1]),
				wordRange
			);
		} else if (word == "gd_scene") {
			const line = document.lineAt(position).text;
			match = /^\[\s*gd_scene\b/.exec(line);
			if (!match) {
				return null;
			}
			return new vscode.Hover(
				preloadMarkdown(await resPathOfDocument(document), "PackedScene"),
				wordRange
			);
		} else if (word == "ExtResource") {
			const line = document.lineAt(position).text;
			match = line.match(/ExtResource\( (\d+) \)/);
			const id = match[1];
			const symbol = gdasset.ids["ExtResource"][id];
			const uri = await resPathToUri(symbol.name, document);
			const md = new vscode.MarkdownString();
            md.appendMarkdown(`<span style="color:#4EC9B0;">${symbol.detail}</span>: [${symbol.name}](${uri})`);
			md.isTrusted = true;
			md.supportHtml = true;
			return new vscode.Hover(md, wordRange);
		} else if (word == "SubResource") {
			const line = document.lineAt(position).text;
			match = line.match(/SubResource\( (\d+) \)/);
			const id = match[1];
			const symbol = gdasset.ids["SubResource"][id];
			const md = new vscode.MarkdownString();
            md.appendMarkdown(`<span style="color:#4EC9B0;">${symbol.detail}</span>`);
			md.isTrusted = true;
			md.supportHtml = true;
			return new vscode.Hover(md, wordRange);
		} else {
			return null;
		}
		// show link to res:// path if available
		hover.push(await resPathToMarkdown(resPath, document));
		return new vscode.Hover(hover, wordRange);
	}
}

class GDResource {
	rootNode: string | undefined = undefined;

	nodePath(n: string) {
		if (!this.rootNode || !n) {
			return n;
		}
		return n == "." ? this.rootNode : `${this.rootNode}/${n}`;
	}

	ids = {
		ExtResource: [] as (vscode.DocumentSymbol | undefined)[],
		SubResource: [] as (vscode.DocumentSymbol | undefined)[],
	};

	strings: { range: vscode.Range; value: string }[] = [];
	comments: { range: vscode.Range; value: string }[] = [];

	stringContaining(place: vscode.Position | vscode.Range) {
		for (const token of this.strings)
			if (token.range.contains(place)) {
				return token;
			}
		{
			return null;
		}
	}

	commentContaining(place: vscode.Position | vscode.Range) {
		for (const token of this.comments)
			if (token.range.contains(place)) {
				return token;
			}
		{
			return null;
		}
	}
}

function makeSectionSymbol(
	document: vscode.TextDocument,
	match: RegExpMatchArray,
	range: vscode.Range,
	gdasset: GDResource
) {
	const [, header, tag, rest] = match;
	const attributes: { [field: string]: string | undefined } = {};
	let id;
	for (const assignment of rest.matchAll(
		/\b([\w-]+)\b\s*=\s*(?:(\d+)|"([^"]*)")/g
	)) {
		if (assignment[1] == "id" && assignment[2]) id = +assignment[2];
		attributes[assignment[1]] = assignment[2] ?? unescapeString(assignment[3]);
	}
	let s = new vscode.DocumentSymbol(
		tag,
		rest,
		vscode.SymbolKind.Object,
		range,
		range
	);
	switch (tag) {
		case "gd_scene":
			s.name = document.uri.path.replace(
				/^\/(?:.*\/)*(.*?)(?:\.[^.]*)?$/,
				"$1"
			);
			s.detail = "PackedScene";
			s.kind = vscode.SymbolKind.File;
			break;
		case "gd_resource":
			s.name = document.uri.path.replace(/^\/(.*\/)*/, "");
			s.detail = attributes.type ?? "";
			s.kind = vscode.SymbolKind.File;
			break;
		case "ext_resource":
			if (id) {
				gdasset.ids.ExtResource[id] = s;
			}
			s.name = attributes.path ?? tag;
			s.detail = attributes.type ?? "";
			s.kind = vscode.SymbolKind.File;
			break;
		case "sub_resource":
			if (id) {
				gdasset.ids.SubResource[id] = s;
			}
			s.name = attributes.path ?? tag;
			s.detail = attributes.type ?? "";
			s.kind = vscode.SymbolKind.File;
			break;
		case "node":
			if (attributes.parent == undefined)
				s.name = (gdasset.rootNode = attributes.name) ?? tag;
			else s.name = gdasset.nodePath(attributes.parent) + "/" + attributes.name;
			s.detail = attributes.type ?? "";
			break;
		case "connection":
			if (attributes.from && attributes.to && attributes.method)
				s.name = `${gdasset.nodePath(attributes.from)}→${gdasset.nodePath(
					attributes.to
				)}::${attributes.method}`;
			else s.name = tag;
			s.detail = attributes.signal ?? "";
			s.kind = vscode.SymbolKind.Event;
			break;
	}
	return s;
}

function unescapeString(partInsideQuotes: string) {
	let s = "";
	for (const m of partInsideQuotes.matchAll(
		/\\(["ntr\\bf]|u[0-9A-Fa-f]{4})|\\$|\\?([^])/g
	)) {
		switch (m[1]) {
			case "\\":
			case '"':
				s += m[1];
				continue;
			case "n":
				s += "\n";
				continue;
			case "t":
				s += "\t";
				continue;
			case "r":
				s += "\r";
				continue;
			case "b":
				s += "\b";
				continue;
			case "f":
				s += "\f";
				continue;
			case undefined:
			case null:
			case "":
				s += m[2] ?? "";
				continue;
			default:
				s += String.fromCharCode(parseInt(m[1].substring(1), 16));
				continue; // uXXXX
		}
	}
	return s;
}

function isResPath(
	word: string,
	wordRange: vscode.Range,
	document: vscode.TextDocument
) {
	if (/^res:\/\/[^"\\]*$/.test(word)) {
		return true;
	}
	const r = new vscode.Range(
		wordRange.start.line,
		0,
		wordRange.end.line,
		wordRange.end.character + 1
	);
	return /(?<=^\[\s*ext_resource\s+path\s*=\s*")[^"\\]*(?="$)/.test(
		document.getText(r)
	);
}

function preloadMarkdown(resPath: string, type?: string | null) {
	let code = `preload("${resPath}")`;
	if (type) code += ` as ${type}`;
	return new vscode.MarkdownString().appendCodeblock(code, "gdscript");
}

async function resPathOfDocument(document: vscode.TextDocument) {
	const files = await vscode.workspace.findFiles("**/project.godot");
	if (!files) {
		return document.uri.path.replace(/^(?:.*\/)+/, "");
	}

	const project_dir = files[0].fsPath.replace("project.godot", "");

	const relative = document.uri.path.substring(project_dir.length);
	return "res:/" + relative;
}

async function resPathToUri(resPath: string, document: vscode.TextDocument) {
	const files = await vscode.workspace.findFiles("**/project.godot");
	if (!files) {
		return resPath;
	}
	const project_dir = files[0].fsPath.replace("project.godot", "");
	return Uri.joinPath(Uri.file(project_dir), resPath.substring(6));
}

const fontTest = `\
<tspan>JFK GOT MY VHS, PC AND XLR WEB QUIZ</tspan>
<tspan x="0" y="20">new job: fix mr. gluck's hazy tv pdq!</tspan>
<tspan x="0" y="40">Oo0 Ili1 Zz2 3 A4 S5 G6 T7 B8 g9</tspan>`;

async function resPathToMarkdown(
	resPath: string,
	document: vscode.TextDocument
) {
	const resUri = await resPathToUri(resPath, document);
	const md = new vscode.MarkdownString();
	md.supportHtml = true;
	if (!(resUri instanceof vscode.Uri))
		return md.appendMarkdown(`<div title="${resUri}">File not found</div>`);
	if (/\.(svg|png|gif|jpe?g|bmp)$/.test(resPath))
		return md.appendMarkdown(`[<img height=128 src="${resUri}"/>](${resUri})`);
	let match = /\.(ttf|otf|woff)$/.exec(resPath);
	if (match) {
		const bytes = await vscode.workspace.fs.readFile(resUri);
		const dataUrl = `data:font/${match[1]};base64,${Buffer.from(bytes).toString(
			"base64"
		)}`;
		const t = encodeURIComponent(fontTest).replace("'", "%27");
		return md.appendMarkdown(`[<img src='data:image/svg+xml,\
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="80" style="background:white;margin:4px"><style>\
@font-face{font-family:F;src:url("${dataUrl}")}\
text{font-family:F;dominant-baseline:text-before-edge}\
</style><text>${t}</text></svg>'/>](${resUri})`);
	}
	return md.appendMarkdown(`[Open file](${resUri})`);
}
