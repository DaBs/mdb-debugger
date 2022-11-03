/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { readFileSync } from 'fs';
import { EventEmitter } from 'events';
import * as path from 'path';
import { ChildProcess, spawn } from 'child_process';
import queue from 'queue';
import { LaunchRequestArguments } from './session';


enum EventType {
	STOP_AT = 'STOP_AT',
	STACK_FRAMES = 'STACK_FRAMES',
}

interface EventData {
	[key: string]: any;
	eventType?: EventType
	address?: number;
	file?: string;
	line?: number;
}

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

	private _commandQueue = queue({ results: [] });

	private _mdbThread: ChildProcess | null = null;

	private _stdoutBuffer: string = '';
	private _stdoutBuffering: boolean = false;
	private eventType: EventType | undefined;

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
		await this.executeAndWait(`Program "${args.program}"`, 'Program succeeded');

		if (args.stopOnEntry) {
			// we step once
			this.step('stopOnEntry');
		} else {
			// we just start to run until we hit a breakpoint or an exception
			this.continue();
		}
	}

	/**
	 * Continue execution to the end/beginning.
	 */
	public async continue() {
		this.addCommandToQueue('Run', 'Running');
		this.run();
	}

	/**
	 * Step to the next/previous non empty line.
	 */
	public async step(event = 'stopOnStep') {
		this.run(event);
	}

	/**
	 * Returns stack trace
	 */
	public async stack(startFrame: number, endFrame: number): Promise<{ frames: MDBStackFrame[], count: number }> {

		this.eventType = EventType.STACK_FRAMES;
		this._stdoutBuffer = '';
		this._stdoutBuffering = true;

		await this.executeAndWait(`Backtrace full ${endFrame - startFrame}`, 'null');

		const collectedBuffer = this._stdoutBuffer;
		this._stdoutBuffering = false;

		const rawFrames = collectedBuffer.split('\r\n');
		const parsedFrames: MDBStackFrame[] = rawFrames.map((rawFrameBuffer: string): MDBStackFrame | null => {
			const matches = rawFrameBuffer.match(/#(\d+)  ([a-zA-z0-9_]+) \(\) at (.+):(\d+)/);
			if (!matches) return null;
			const [, index, name, file, line] = matches;

			const stackframe: MDBStackFrame = { 
				index: parseInt(index, 10), 
				name, 
				file, 
				line: parseInt(line, 10),
			};

			return stackframe;

		}).filter((frame: MDBStackFrame | null): frame is MDBStackFrame => frame !== null);

		return {
			frames: parsedFrames,
			count: parsedFrames.length,
		};
	}

	public async evaluate(expression: string, hex = true) {
		const result = await this.executeAndWait(`Print /a ${expression}`, new RegExp(`the address of ${expression}: (0x[a-zA-Z0-9]+)`, 'i'));
		const matches = result.match(new RegExp(`the address of ${expression}: (0x[a-zA-Z0-9]+)`, 'i'));
		if (!matches) return null;

		const [, address] = matches;

		const format = hex ? 'x' : 'd';

		const collectedRawOuputPromise = this.collectFromStdOut((collected) => {
			return collected.includes('\r\n');
		})

		await this.executeRawCommand(`x /trn1f${format}ub ${address}`);
		const collectedRawOutput = (await collectedRawOuputPromise) as string;
		const data = collectedRawOutput.replace(/[ \r\n]/gm, '');

		const prefix = hex ? '0x' : '';
		return prefix + data;
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
	public clearBreakPoint(path: string, line: number, callback: (breakpoint: MDBBreakpoint | undefined) => void) : void {
		let bps = this._breakPoints.get(path);
		if (bps) {
			const index = bps.findIndex(bp => bp.line === line);
			if (index >= 0) {
				const bp = bps[index];
				bps.splice(index, 1);
				this.removeBreakpointCommand(bp.id, () => {
					if (callback) callback(bp);
				});
			}
		}
		return undefined;
	}

	/*
	 * Clear all breakpoints for file.
	 */
	public async clearBreakpoints(path: string, cb?: () => void): Promise<void> {
		const fileBreakpoints = this._breakPoints.get(path) || [];
		const promises = [];
		for (const fileBreakpoint of fileBreakpoints) {
			promises.push(new Promise(resolve => this.removeBreakpointCommand(fileBreakpoint.id, () => resolve(true))));
		}
		await Promise.all(promises);
		this._breakPoints.delete(path);
		if (cb) cb();
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

	private async process() {
		this._commandQueue.start((err) => {

		});
	}

	private addCommandToQueue(command: string, patternOrStringToWait?: RegExp | string | null, callback?: () => void) {
		this._commandQueue.push((queueCallback) => {
			const executionPromise = patternOrStringToWait ? this.executeAndWait(command, patternOrStringToWait) : this.executeRawCommand(command);
			executionPromise.then(() => {
				if (callback) callback();
				if (queueCallback) queueCallback(undefined, true);
			});
		});
	}

	private addBreakpointCommand(name: string, line: number, cb?: (status: boolean) => void) {
		this.addCommandToQueue(`Break "${name}":${line}`, null, () => cb && cb(true));
	}

	private removeBreakpointCommand(id: number, cb?: () => void) {
		this.addCommandToQueue(`Delete ${id}`, null, cb);
	}

	private removeAllBreakpointsCommand(cb?: () => void) {
		this.addCommandToQueue('Delete', null, cb);
	}

	private async executeRawCommand(command: string, skipWaitingForNewline = false) {
		await this.guardMDBSetup();
		console.log(`Writing ${command}`);
		this._mdbThread?.stdin?.write(command + '\n');
		if (!skipWaitingForNewline) {
			await this.waitForStdOut('>');
		}
	}

	private async collectFromStdOut(callback: (currentCollected: string) => boolean) {
		return new Promise(resolve => {
			let currentCollected = '';
			const listener = (data: any) => {
				const dataAsString = data as string;
				currentCollected += dataAsString;
				const shouldStop = callback(currentCollected);
				if (shouldStop) {
					this._mdbThread?.stdout?.off('data', listener);
					resolve(currentCollected);
				}
			};
	
			this._mdbThread?.stdout?.on('data', listener);
		});
	}

	private waitForStdOut(patternOrString: RegExp | string, timeout: number = 30000): Promise<string> {
		return new Promise((resolve, reject) => {
			let timeLeft = timeout;
			let intervalId: NodeJS.Timer | null = null;
			const clearTimeoutInterval = () => {
				if (intervalId) {
					clearInterval(intervalId);
				}
			}

			const listener = (data: any) => {
				const dataAsMessage: string = data.toString('ascii');
				const isErr = dataAsMessage.includes('err');

				if (isErr) {
					reject(new Error(dataAsMessage));
				} else {
					const isMatching = patternOrString instanceof RegExp ? dataAsMessage.match(patternOrString) : dataAsMessage.includes(patternOrString);
					if (isMatching) {
						clearTimeoutInterval();
						this._mdbThread?.stdout?.off('data', listener);
						resolve(dataAsMessage);
					}
				}
			};

			this._mdbThread?.stdout?.on('data', listener);
			
			intervalId = setInterval(() => {
				timeLeft--;
				if (timeLeft <= 0) {
					clearTimeoutInterval();
					reject();
				}
			}, 1);
		});
	}

	private async executeAndWait(command: string, patternOrString: RegExp | string, skipWaitingForNewline = false, timeout = 30000 ) {
		const stdOutPromise = this.waitForStdOut(patternOrString, timeout);
		const executePromise = this.executeRawCommand(command, skipWaitingForNewline);
		const stdout = await stdOutPromise;
		
		await executePromise;

		return stdout;
	}

	private async guardMDBSetup() {
		if (!this._mdbThread) {
			this._mdbThread = spawn(path.resolve(this._mdbConfig.executablePath));
			this._mdbThread.stdout?.pipe(process.stdout);
			this._mdbThread.stderr?.pipe(process.stderr);
			this._mdbThread.stdout?.on('data', (data: any) => {
				const message = data.toString();
				this.parseStdOutMessage(message);
			});
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
	private run(stepEvent?: string) {
		this.process();
	}

	private async verifyBreakpoints(filePath: string) : Promise<void> {
		let breakpoints = this._breakPoints.get(filePath);
		if (breakpoints) {
			this.loadSource(filePath);
			for (const breakpoint of breakpoints) {
				if (!breakpoint.verified && breakpoint.line < this._sourceLines.length) {
					const srcLine = this._sourceLines[breakpoint.line].trim();
					// don't set 'verified' to true if the line contains the word 'lazy'
					// in this case the breakpoint will be verified 'lazy' after hitting it once.
					this.addBreakpointCommand(path.basename(filePath), breakpoint.line, () => {
						breakpoint.verified = true;
						this.sendEvent('breakpointValidated', breakpoint);
					});
				}
			}
		}
	}

	private parseStdOutMessage(message: string) {
		if (message.toLowerCase().includes('stop at')) {
			this.eventType = EventType.STOP_AT;
			this._stdoutBuffering = true;
			this._stdoutBuffer = message;
		}

		if (this._stdoutBuffering) {

			this._stdoutBuffer += message;

			const matches = this._stdoutBuffer.replace(/\n/gi, '').match(/address:(0x.{8})|file:(.+)|source line:(\d+)/gm);
			if (matches && matches.length >= 3) {
				this._stdoutBuffering = false;
				this._stdoutBuffer = '';
				const eventData = matches.map(match => {
					const parts = match.split(':');
					if (parts.length <= 2) {
						return parts;
					} else {
						return [parts[0], parts.slice(2).join(':')];
					}
				}).reduce((collector, [key, rawValue]) => {
					collector[key.replace(/ /gi,'_')] = rawValue;
					return collector;
				}, {} as EventData);
				eventData.eventType = this.eventType;
				this.fireEventsForData(eventData);
			}
		}
	}

	private fireEventsForData(data: EventData) {
		if (data.eventType === EventType.STOP_AT) {
			const breakpoints = this._breakPoints.get(data.file || '');
			if (breakpoints) {
				const bps = breakpoints.filter(bp => bp.line === data.line);
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

			this.sendEvent('stopOnException', data);
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