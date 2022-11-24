/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { readFileSync } from 'fs';
import { EventEmitter } from 'events';
import * as path from 'path';
import { ChildProcess, spawn } from 'child_process';
import queue from 'queue';
import { LaunchRequestArguments } from './session';
import { ELFFile } from './utils/elf';
import { convertHexToNumber, convertNumberToHex } from './utils/hex';
import { normalizePath } from './utils/path';


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

export interface MDBDebugSymbol {
	name: string;
	address: number;
	length: number;
	info?: string;
}

/**
 * A Mock runtime with minimal debugger functionality.
 */
export class MDBRuntime extends EventEmitter {

	private _commandQueue = queue({ results: [], concurrency: 1 });

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

	private _symbols: Record<string, MDBDebugSymbol> = {};

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
		this.verifyBreakpoints(this._sourceFile);

		if (args.toolConfiguration && args.toolConfiguration.length) {
			for (const toolConfig of args.toolConfiguration) {
				await this.executeRawCommand(`Set ${toolConfig}\n`);
			}
		}

		await this.processElfFile(args.program);

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
			const matches = rawFrameBuffer.match(/#(\d+)  ([a-zA-z0-9_ ]+) \(\) at (.+):(\d+)/);
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

		const existingSymbolInformation = this._symbols[expression];

		let address;
		let length = 1;

		if (!existingSymbolInformation) {
			const result = await this.executeAndWait(`Print /a ${expression}`, new RegExp(`the address of ${expression}: (0x[a-zA-Z0-9]+)`, 'i'));
			const matches = result.match(new RegExp(`the address of ${expression}: (0x[a-zA-Z0-9]+)`, 'i'));
			if (!matches) return null;
	
			const [, matchedAddress] = matches;
			address = convertHexToNumber(matchedAddress);
		} else {
			const result = await this.executeAndWait(`Print ${expression}`, /{\n(.+)}/ms);
			address = existingSymbolInformation.address;
			length = existingSymbolInformation.length;
		}

		const format = hex ? 'x' : 'd';

		const collectedRawOuputPromise = this.collectFromStdOut((collected) => {
			return collected.includes('\r\n');
		})

		const hexAddress = convertNumberToHex(address);

		await this.executeRawCommand(`x /trn${length}f${format}ub ${hexAddress}`);
		const collectedRawOutput = (await collectedRawOuputPromise) as string;
		const data = collectedRawOutput.replace(/[ \r\n]/gm, '');

		const prefix = hex ? '0x' : '';
		return prefix + data;
	}

	public getBreakpoints(filePath: string, line: number): MDBBreakpoint[] {
		const bps = this._breakPoints.get(normalizePath(filePath));

		if (!bps) return [];

		const relevantBps = bps.filter(bp => bp.line >= line);
		return relevantBps;
	}

	/*
	 * Set breakpoint in file with given line.
	 */
	public setBreakPoint(filePath: string, line: number) : MDBBreakpoint {

		const resolvedPath = normalizePath(filePath);

		const bp = <MDBBreakpoint> { verified: false, line, id: this._breakpointId++ };
		let bps = this._breakPoints.get(resolvedPath);
		if (!bps) {
			bps = new Array<MDBBreakpoint>();
			this._breakPoints.set(resolvedPath, bps);
		}
		bps.push(bp);

		this.verifyBreakpoints(resolvedPath);

		return bp;
	}

	/*
	 * Clear breakpoint in file with given line.
	 */
	public clearBreakPoint(filePath: string, line: number, callback: (breakpoint: MDBBreakpoint | undefined) => void) : void {
		let bps = this._breakPoints.get(normalizePath(filePath));
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
	public async clearBreakpoints(filePath: string, cb?: () => void): Promise<void> {
		const fileBreakpoints = this._breakPoints.get(normalizePath(filePath)) || [];
		const promises = [];
		for (const fileBreakpoint of fileBreakpoints) {
			promises.push(new Promise(resolve => this.removeBreakpointCommand(fileBreakpoint.id, () => resolve(true))));
		}
		await Promise.all(promises);
		//this._breakPoints.delete(path);
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

	private async processElfFile(elfPath: string): Promise<void> {
		const elfBytes = readFileSync(path.resolve(elfPath));
		const elfFile = new ELFFile(elfBytes.buffer);
		const result = elfFile.load();
		const symbolTable = elfFile.elfSymbolTables[0];

		for (const symbolTableEntry of symbolTable.symTabEntries) {
			const name = symbolTableEntry.St_name.description();
			const address = symbolTableEntry.St_value.Get32BitValue();
			const length = symbolTableEntry.St_size.value;
			const bindingType = symbolTableEntry.St_info.description();

			this._symbols[name] = { name, address, length };
		}
	}

	private async process() {
		this._commandQueue.start((err) => {

		});
	}

	private addCommandToQueue(command: string, patternOrStringToWait?: RegExp | string | null, callback?: () => void) {
		this._commandQueue.push(() => {
			const executionPromise = patternOrStringToWait ? this.executeAndWait(command, patternOrStringToWait) : this.executeRawCommand(command);
			return executionPromise.then(() => {
				if (callback) callback();
				//if (queueCallback) queueCallback(undefined, true);
			});
		});
	}

	private async addBreakpointCommand(name: string, line: number, cb?: (status: boolean) => void) {
		this.addCommandToQueue(`Break ${name}:${line}`, new RegExp(`Breakpoint (\\d+) at file (${name}), line (\\d+)\\.`), () => cb && cb(true));
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
			this._mdbThread.stdout?.setMaxListeners(Infinity);
			this._mdbThread.stderr?.setMaxListeners(Infinity);
			this._mdbThread.stdout?.pipe(process.stdout);
			this._mdbThread.stderr?.pipe(process.stderr);
			this._mdbThread.stdout?.on('data', (data: any) => {
				const message = data.toString();
				this.parseStdOutMessage(message);
			});
			await this.waitForStdOut('>');
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
		let breakpoints = this._breakPoints.get(normalizePath(filePath));
		if (breakpoints) {
			for (const breakpoint of breakpoints) {
				if (!breakpoint.verified) {
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
				}).reduce((collector, [key, rawValue]): EventData => { // TODO: This collector is garbage and should be refactored with a matching pattern instead..
					let sanitizedKey = key.replace(/ /gi,'_');
					let value: string | number = rawValue;

					if (sanitizedKey === 'source_line') {
						sanitizedKey = 'line';
						value = parseInt(value, 10);
					}

					if (sanitizedKey === 'address') {
						value = convertHexToNumber(value as string);
					}

					collector[sanitizedKey] = value;
					return collector;
				}, {} as EventData);
				eventData.eventType = this.eventType;
				this.fireEventsForData(eventData);
			}
		}
	}

	private fireEventsForData(data: EventData) {
		if (data.eventType === EventType.STOP_AT) {
			const breakpoints = this._breakPoints.get(normalizePath(data.file || ''));
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

	private sendEvent(event: string, ... args: any[]) {
		setImmediate(_ => {
			this.emit(event, ...args);
		});
	}
}