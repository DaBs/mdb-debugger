// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { MDBDebuggerAdapterDescriptorFactory } from './adapters/DescriptorAdapter';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	
	
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('MDB Debugger active');

	context.subscriptions.push(vscode.commands.registerCommand('extension.mdb-debugger.getProgramName', config => {
		return vscode.window.showInputBox({
			placeHolder: "Please enter the absolute path to the program file you want to (typically the ELF file)",
			value: "",
		});
	}));

	let factory = new MDBDebuggerAdapterDescriptorFactory();

	context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('mdb', factory));
	if ('dispose' in factory) {
		context.subscriptions.push(factory);
	}
}

// this method is called when your extension is deactivated
export function deactivate() {}


