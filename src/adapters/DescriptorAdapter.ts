import * as vscode from 'vscode';
import * as Net from 'net';
import * as path from 'path';
import { MDBDebuggerSession } from '../session';
import { platform } from 'os';

export class MDBDebuggerAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
    private server?: Net.Server;

    createDebugAdapterDescriptor(session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {

		const currentPlatform = platform();

		const fullConfig = vscode.workspace.getConfiguration('mdb-debugger');
		const tool = (fullConfig.get('tool') as string | undefined);
		const chip = (fullConfig.get('chip') as string | undefined);
		const timeout = (fullConfig.get('timeout') as number);

		if (!tool) {
			throw new Error('Missing tool configuration');
		}

		if (!chip) {
			throw new Error('Missing chip configuration');
		}

		const mdbPathConfig = vscode.workspace.getConfiguration('mdb-debugger.mdbPath');
		
		const mdbPath = (mdbPathConfig.get(currentPlatform) || mdbPathConfig.get('default')) as string;

		const mdbExecutable = currentPlatform === 'win32' ? 'mdb.bat' : 'mdb';

		const fullMDBPath = path.join(mdbPath, mdbExecutable);

		if (!this.server) {
			// start listening on a random port
			this.server = Net.createServer(socket => {
				const session = new MDBDebuggerSession({
					executablePath: fullMDBPath,
					tool,
					chip,
					timeout
				});
				session.setRunAsServer(true);
				session.start(<NodeJS.ReadableStream>socket, socket);
			}).listen(0);
		}

		// make VS Code connect to debug server
		return new vscode.DebugAdapterServer((<Net.AddressInfo>this.server.address()).port);
	}

	dispose() {
		if (this.server) {
			this.server.close();
		}
	}
}