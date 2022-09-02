/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { readFileSync } from 'fs';
import { EventEmitter } from 'events';
import * as path from 'path';
import { ChildProcess, spawn } from 'child_process';
import { LaunchRequestArguments } from './session';

export interface MDBBreakpoint {
	id: number;
	line: number;
	verified: boolean;
}

export interface MDBStackFrame {
    index: number;
    name: string;
    file: string;
    line: number;
}

export interface MDBRuntimeConfig {
	tool: string;
	chip: string;
	executablePath: string;
	timeout: number;
}

/**
 * A Mock runtime with minimal debugger functionality.
 */
export class MDBRuntime extends EventEmitter {

	private _mdbThread: ChildProcess | null = null;

	// the initial (and one and only) file we are 'debugging'
	private _sourceFile: string = '';
	private _mdbConfig: MDBRuntimeConfig;
	private _mdbLaunchArgs: string[];
	public get sourceFile() {
		return this._sourceFile;
	}

	// the contents (= lines) of the one and only file
	private _sourceLines: string[] = [];

	// This is the next line that will be 'executed'
	private _currentLine = 0;

	// maps from sourceFile to array of Mock breakpoints
	private _breakPoints = new Map<string, MDBBreakpoint[]>();

	// since we want to send breakpoint events, we will assign an id to every event
	// so that the frontend can match events with breakpoints.
	private _breakpointId = 1;

	private _breakAddresses = new Set<string>();

	constructor(mdbConfig: MDBRuntimeConfig, mdbLaunchArgs: string[] = []) {
		super();
		this._mdbConfig = mdbConfig;
		this._mdbLaunchArgs = mdbLaunchArgs;
	}

	/**
	 * Start executing the given program.
	 */
	public async start(args: LaunchRequestArguments) {

		this.loadSource(args.program);
		this._currentLine = -1;

		this.verifyBreakpoints(this._sourceFile);

		if (args.toolConfiguration && args.toolConfiguration.length) {
			for (const toolConfig of args.toolConfiguration) {
				await this.executeRawCommand(`Set ${toolConfig}\n`);
			}
		}

		await this.executeRawCommand(`Device ${this._mdbConfig.chip}`);
		await this.executeRawCommand(`Hwtool ${this._mdbConfig.tool}`);
		await this.executeRawCommand(`Program "${args.program}"`);
		await this.executeRawCommand('Run');

		if (args.stopOnEntry) {
			// we step once
			this.step(false, 'stopOnEntry');
		} else {
			// we just start to run until we hit a breakpoint or an exception
			this.continue();
		}
	}

	/**
	 * Continue execution to the end/beginning.
	 */
	public continue(reverse = false) {
		this.run(reverse, undefined);
	}

	/**
	 * Step to the next/previous non empty line.
	 */
	public step(reverse = false, event = 'stopOnStep') {
		this.run(reverse, event);
	}

	/**
	 * Returns a fake 'stacktrace' where every 'stackframe' is a word from the current line.
	 */
	public stack(startFrame: number, endFrame: number): any {

		const words = this._sourceLines[this._currentLine].trim().split(/\s+/);

		const frames = new Array<any>();
		// every word of the current line becomes a stack frame.
		for (let i = startFrame; i < Math.min(endFrame, words.length); i++) {
			const name = words[i];	// use a word of the line as the stackframe name
			frames.push({
				index: i,
				name: `${name}(${i})`,
				file: this._sourceFile,
				line: this._currentLine
			});
		}
		return {
			frames: frames,
			count: words.length
		};
	}

	public getBreakpoints(path: string, line: number): number[] {

		const l = this._sourceLines[line];

		let sawSpace = true;
		const bps: number[] = [];
		for (let i = 0; i < l.length; i++) {
			if (l[i] !== ' ') {
				if (sawSpace) {
					bps.push(i);
					sawSpace = false;
				}
			} else {
				sawSpace = true;
			}
		}

		return bps;
	}

	/*
	 * Set breakpoint in file with given line.
	 */
	public setBreakPoint(path: string, line: number) : MDBBreakpoint {

		const bp = <MDBBreakpoint> { verified: false, line, id: this._breakpointId++ };
		let bps = this._breakPoints.get(path);
		if (!bps) {
			bps = new Array<MDBBreakpoint>();
			this._breakPoints.set(path, bps);
		}
		bps.push(bp);

		this.verifyBreakpoints(path);

		return bp;
	}

	/*
	 * Clear breakpoint in file with given line.
	 */
	public clearBreakPoint(path: string, line: number) : MDBBreakpoint | undefined {
		let bps = this._breakPoints.get(path);
		if (bps) {
			const index = bps.findIndex(bp => bp.line === line);
			if (index >= 0) {
				const bp = bps[index];
				bps.splice(index, 1);
				return bp;
			}
		}
		return undefined;
	}

	/*
	 * Clear all breakpoints for file.
	 */
	public clearBreakpoints(path: string): void {
		this._breakPoints.delete(path);
	}

	/*
	 * Set data breakpoint.
	 */
	public setDataBreakpoint(address: string): boolean {
		if (address) {
			this._breakAddresses.add(address);
			return true;
		}
		return false;
	}

	/*
	 * Clear all data breakpoints.
	 */
	public clearAllDataBreakpoints(): void {
		this._breakAddresses.clear();
	}

	// private methods

	private async executeBreakpointCommand(name: string, line: number) {
		const result = await this.executeRawCommand(`Break ${name}:${line}`);
		return result;
	}

	private async executeRawCommand(command: string) {
		await this.guardMDBSetup();
		console.log(`Writing ${command}`);
		this._mdbThread?.stdin?.write(command + '\n');
		await this.waitForStdOut('>');
	}

	private waitForStdOut(patternOrString: RegExp | string, timeout: number = 30000) {
		return new Promise((resolve, reject) => {
			let timeLeft = timeout;
			let intervalId: NodeJS.Timer | null = null;
			const clearTimeoutInterval = () => {
				if (intervalId) {
					clearInterval(intervalId);
				}
			}
			this._mdbThread?.stdout?.on('data', data => {
				const dataAsMessage: string = data.toString('ascii');
				console.log(dataAsMessage);
				const isMatching = patternOrString instanceof RegExp ? dataAsMessage.match(patternOrString) : dataAsMessage.includes(patternOrString);
				if (isMatching) {
					clearTimeoutInterval();
					resolve(dataAsMessage);
				}
			})
			intervalId = setInterval(() => {
				timeLeft--;
				if (timeLeft <= 0) {
					clearTimeoutInterval();
					reject();
				}
			}, 1);
		});
	}

	private async guardMDBSetup() {
		if (!this._mdbThread) {
			this._mdbThread = spawn(path.resolve(this._mdbConfig.executablePath));
			this._mdbThread.stdout?.pipe(process.stdout);
			this._mdbThread.stderr?.pipe(process.stderr);
			await this.waitForStdOut('>');
		}
	}

	private loadSource(file: string) {
		if (this._sourceFile !== file) {
			this._sourceFile = file;
			this._sourceLines = readFileSync(this._sourceFile).toString().split('\n');
		}
	}

	/**
	 * Run through the file.
	 * If stepEvent is specified only run a single step and emit the stepEvent.
	 */
	private run(reverse = false, stepEvent?: string) {
	}

	private async verifyBreakpoints(path: string) : Promise<void> {
		let breakpoints = this._breakPoints.get(path);
		if (breakpoints) {
			this.loadSource(path);
			for (const breakpoint of breakpoints) {
				if (!breakpoint.verified && breakpoint.line < this._sourceLines.length) {
					const srcLine = this._sourceLines[breakpoint.line].trim();
					// don't set 'verified' to true if the line contains the word 'lazy'
					// in this case the breakpoint will be verified 'lazy' after hitting it once.
					const breakpointResult = await this.executeBreakpointCommand(path, breakpoint.line);
					
					breakpoint.verified = true;
					this.sendEvent('breakpointValidated', breakpoint);
				}
			}
		}
	}

	/**
	 * Fire events if line has a breakpoint or the word 'exception' is found.
	 * Returns true is execution needs to stop.
	 */
	private fireEventsForLine(ln: number, stepEvent?: string): boolean {

		const line = this._sourceLines[ln].trim();

		// if 'log(...)' found in source -> send argument to debug console
		const matches = /log\((.*)\)/.exec(line);
		if (matches && matches.length === 2) {
			this.sendEvent('output', matches[1], this._sourceFile, ln, matches.index)
		}

		// if a word in a line matches a data breakpoint, fire a 'dataBreakpoint' event
		const words = line.split(" ");
		for (let word of words) {
			if (this._breakAddresses.has(word)) {
				this.sendEvent('stopOnDataBreakpoint');
				return true;
			}
		}

		// if word 'exception' found in source -> throw exception
		if (line.indexOf('exception') >= 0) {
			this.sendEvent('stopOnException');
			return true;
		}

		// is there a breakpoint?
		const breakpoints = this._breakPoints.get(this._sourceFile);
		if (breakpoints) {
			const bps = breakpoints.filter(bp => bp.line === ln);
			if (bps.length > 0) {

				// send 'stopped' event
				this.sendEvent('stopOnBreakpoint');

				// the following shows the use of 'breakpoint' events to update properties of a breakpoint in the UI
				// if breakpoint is not yet verified, verify it now and send a 'breakpoint' update event
				if (!bps[0].verified) {
					bps[0].verified = true;
					this.sendEvent('breakpointValidated', bps[0]);
				}
				return true;
			}
		}

		// non-empty line
		if (stepEvent && line.length > 0) {
			this.sendEvent(stepEvent);
			return true;
		}

		// nothing interesting found -> continue
		return false;
	}

	private sendEvent(event: string, ... args: any[]) {
		setImmediate(_ => {
			this.emit(event, ...args);
		});
	}
}