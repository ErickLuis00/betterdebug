import * as vscode from 'vscode';
import WebSocket, { WebSocketServer } from 'ws';
import * as path from 'path'; // Need path for normalization
import { randomUUID } from 'crypto'; // For generating unique IDs
import { Buffer } from 'buffer'; // For Base64 decoding
import * as os from 'os'; // For temp directory
import * as fs from 'fs'; // For file system access
import * as fsp from 'fs/promises'; // For async file access

// --- Interfaces ---
interface LogEntry {
	filename: string;
	line: number;
	type: string; // e.g., 'parameter', 'variable', 'return', 'condition', 'async-keyword-detected', 'async-keyword-detected-end', 'request-body', 'response-body'
	name?: string; // Optional: variable/parameter name
	// The value itself. For Request/Response types, this object will be extended
	// by the async handler to include contentType, bodyType, bodyEncoding, asyncBody/asyncBodyError
	value: any;
	codeLine?: string; // Optional: the actual code line
	timestamp: number;
	env: 'browser' | 'node';
	correlationId?: string; // Used for top-level matching, not directly stored on value anymore
}

// Define a more specific type for Request/Response values stored in LogEntry
interface RequestResponseValue {
	_type: 'Request' | 'Response';
	correlationId: string;
	bodyStatus: 'pending' | 'received' | 'error' | 'not_applicable_or_used';
	contentType?: string | null;
	bodyType?: 'json' | 'text' | 'binary' | 'error' | 'multipart';
	bodyEncoding?: 'utf8' | 'base64';
	asyncBody?: any; // Stores the actual body content (string or base64 string)
	asyncBodyError?: string; // Stores error message if body reading failed
	blobCacheId?: string; // Added: Temp ID for linking CodeLens to cached blob data
	// ... other request/response specific fields like url, method, status etc.
	[key: string]: any; // Allow other properties
}

// --- Constants & State ---
const outputChannel = vscode.window.createOutputChannel("WebSocket Logs");
const MAX_HISTORY_PER_LINE = 10; // Max number of log entries to store per line
const LOG_WINDOW_SECONDS = 15; // Time window for file logging (in seconds)
const LOG_FILE_WRITE_DEBOUNCE_MS = 500; // Debounce time for writing logs to file

// Store history of log entries for each line (for hover/values)
// Map<filePath: string, Map<lineNumber: number, LogEntry[]>>
const logDataStore = new Map<string, Map<number, LogEntry[]>>();
// Store correlation IDs -> original log entry location
const correlationMap = new Map<string, { filePath: string; line: number; entryIndex: number }>();
// Store lines currently showing a spinner via CodeLens
const activeSpinnerLines = new Map<string, Set<number>>();
// Cache for blob data (Base64 string + content type) accessed via command link
const blobDataCache = new Map<string, { base64Data: string; contentType: string }>();

// --- File Logging State ---
let logFilePath: string | null = null;
let recentLogsBuffer: LogEntry[] = []; // In-memory buffer for recent logs

let valueDecorationType: vscode.TextEditorDecorationType | null = null;
// Removed spinnerDecorationType
let refreshInterval: NodeJS.Timeout | null = null; // Variable to hold the interval timer
let logActionProvider: LogActionCodeLensProvider | null = null; // Reference to the CodeLens provider instance
// Keep track of the webview panel so we can reuse it
// let blobViewPanel: vscode.WebviewPanel | undefined = undefined;

/** Debounce helper to prevent excessive updates to decorations */
function debounce<T extends (...args: any[]) => any>(func: T, wait: number): ((...args: Parameters<T>) => void) & { clearTimeout?: () => void } {
	let timeout: NodeJS.Timeout | null = null;
	const debouncedFunc = (...args: Parameters<T>) => {
		const later = () => {
			timeout = null;
			func(...args);
		};
		if (timeout) {
			clearTimeout(timeout);
		}
		timeout = setTimeout(later, wait);
	};
	// Add a way to clear the timeout externally if needed
	debouncedFunc.clearTimeout = () => {
		if (timeout) {
			clearTimeout(timeout);
			timeout = null;
		}
	};
	return debouncedFunc;
}

// --- File Logging Helpers ---
function initializeLogFilePath() {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (workspaceFolder) {
		logFilePath = path.join(workspaceFolder, 'betterdebug-runtime.log');
		console.log(`[File Logging] Log file path set to: ${logFilePath}`);
	} else {
		logFilePath = path.join(os.tmpdir(), 'betterdebug-runtime.log');
		console.warn('[File Logging] Workspace folder not found. Logging to temporary directory:', logFilePath);
	}
}

async function writeLogBufferToFile() {
	if (!logFilePath || recentLogsBuffer.length === 0) return;

	// Ensure buffer contains only recent logs relative to the *very latest* timestamp in the buffer
	if (recentLogsBuffer.length > 0) {
		const latestTimestamp = recentLogsBuffer[recentLogsBuffer.length - 1].timestamp;
		const cutoffTimestamp = latestTimestamp - (LOG_WINDOW_SECONDS * 1000);
		recentLogsBuffer = recentLogsBuffer.filter(entry => entry.timestamp >= cutoffTimestamp);
	}

	const processedParamGroups = new Set<string>(); // Tracks 'filePath:line:timestamp' for parameters

	const logContent = recentLogsBuffer
		.map((entry, index, buffer) => { // Keep index/buffer for potential future use
			// --- Format the log entry ---
			let relativePath = entry.filename;
			const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			if (workspaceRoot) {
				const fullRelativePath = path.relative(workspaceRoot, entry.filename).replace(/\\/g, '/');
				const srcIndex = fullRelativePath.indexOf('/src/');
				if (srcIndex !== -1) {
					relativePath = fullRelativePath.substring(srcIndex + 1);
				} else {
					relativePath = fullRelativePath;
				}
			} else {
				relativePath = entry.filename.replace(/\\/g, '/');
			}

			let formattedValue: string | null = null;

			// --- Process Parameter Group or Single Entry ---
			if (entry.type === 'parameter') {
				const groupId = `${entry.filename}:${entry.line}:${entry.timestamp}`;

				if (processedParamGroups.has(groupId)) {
					return null; // Already processed this group
				}
				processedParamGroups.add(groupId); // Mark as processed

				// Find ALL parameters belonging to this group within the current buffer
				const paramGroupEntries = buffer.filter(e =>
					e.type === 'parameter' &&
					e.filename === entry.filename &&
					e.line === entry.line &&
					e.timestamp === entry.timestamp
				);

				const paramsFormattedMap = new Map<string, string>(); // Use Map to ensure unique param names

				paramGroupEntries.forEach(p => {
					const nameParts = p.name ? p.name.split('|') : [];
					const paramName = nameParts[nameParts.length - 1] || 'unknown';
					// Only add/overwrite if name not already processed for this group
					// (Map automatically handles overwriting if needed, but checking first might be clearer)
					// if (!paramsFormattedMap.has(paramName)) {
					const paramValueStr = formatValueInline(p.value); // Format the value
					paramsFormattedMap.set(paramName, paramValueStr);
					// }
				});

				// Convert map entries to array, sort alphabetically by name, format
				formattedValue = Array.from(paramsFormattedMap.entries())
					.sort((a, b) => a[0].localeCompare(b[0])) // Sort by param name (key)
					.map(p => `${p[0]}: ${p[1]}`) // Format as "name: value"
					.join(' | ');

			} else {
				// --- Process Non-Parameter Entry ---
				formattedValue = formatValueInline(entry.value);
			}

			// --- Final Length Check for *ANY* formatted value ---
			const MAX_LOG_VALUE_LENGTH = 4096; // Set a threshold
			if (formattedValue && formattedValue.length > MAX_LOG_VALUE_LENGTH) {
				formattedValue = '[Content Omitted - Too Long]';
			}

			// --- Construct final line if formattedValue is not null ---
			if (formattedValue !== null) { // Check for null explicitly
				const codeLine = entry.codeLine ? entry.codeLine.trim() : 'N/A';
				// Handle specific format for call-result like in hover
				if (entry.type === 'call-result' && entry.name) {
					return `${relativePath} - line ${entry.line} - ${entry.timestamp} - Code: ${codeLine} | Call: ${entry.name} | Result: ${formattedValue}`;
				} else {
					// Use Type: label for others. For parameters, entry.type is 'parameter'.
					return `${relativePath} - line ${entry.line} - ${entry.timestamp} - Code: ${codeLine} | Type: ${entry.type} | Result: ${formattedValue}`;
				}
			}
			return null; // Skip this entry if formattedValue is null
		})
		.filter(line => line !== null) // Remove nulls (skipped entries)
		.join('\n') + '\n';

	try {
		await fsp.writeFile(logFilePath, logContent, 'utf8');
	} catch (error) {
		console.error(`[File Logging] Error writing to log file ${logFilePath}:`, error);
	}
}
// Debounced version of the file writing function
const debouncedWriteLogBufferToFile = debounce(writeLogBufferToFile, LOG_FILE_WRITE_DEBOUNCE_MS);

// --- Decoration & CodeLens Logic ---
function initializeDecorationTypes() {
	// Existing type for inline values
	valueDecorationType = vscode.window.createTextEditorDecorationType({
		after: {
			margin: '0 0 0 1em',
			color: new vscode.ThemeColor('editorCodeLens.foreground'),
			fontStyle: 'italic',
		},
		rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
	});

	// Spinner decoration type is removed - replaced by CodeLens
}

// Format value for INLINE display (truncated)
function formatValueInline(value: any): string {
	try {
		// Handle our special Request/Response objects first
		if (typeof value === 'object' && value !== null && value._type === 'Request') {
			// DEBUG 
			console.log(`[formatValueInline] Request: bodyStatus=${value.bodyStatus}, hasBody=${!!value.asyncBody}, hasError=${!!value.asyncBodyError}`);
			// END DEBUG

			let status = '';
			if (value.asyncBody) status = '[Body ✓]';
			else if (value.asyncBodyError) status = '[Body ✗]';
			else if (value.bodyStatus === 'pending') status = '[Body ...]';
			else if (value.bodyStatus === 'received') status = '[Body ✓]'; // Backup check
			return `${value.method} ${value.url.substring(value.url.lastIndexOf('/') + 1)} ${status}`.trim();
		}
		if (typeof value === 'object' && value !== null && value._type === 'Response') {
			// DEBUG 
			console.log(`[formatValueInline] Response: bodyStatus=${value.bodyStatus}, hasBody=${!!value.asyncBody}, hasError=${!!value.asyncBodyError}`);
			// END DEBUG

			let status = '';
			if (value.asyncBody) status = '[Body ✓]';
			else if (value.asyncBodyError) status = '[Body ✗]';
			else if (value.bodyStatus === 'pending') status = '[Body ...]';
			else if (value.bodyStatus === 'received') status = '[Body ✓]'; // Backup check
			return `${value.status} ${value.statusText} ${status}`.trim();
		}

		// Original formatting for other types
		if (value === undefined) return 'undefined';
		if (value === null) return 'null';
		if (typeof value !== 'object') return String(value);
		const jsonString = JSON.stringify(value);
		return jsonString;
	} catch (e) {
		return '[unserializable]';
	}
}

// Format value for HOVER display (full, pretty-printed)
function formatValueHover(value: any): string {
	try {
		// Special handling for Request/Response with async body
		if (typeof value === 'object' && value !== null && (value._type === 'Request' || value._type === 'Response')) {
			// --- DEBUG LOG --- 
			console.log(`[formatValueHover] Formatting ${value._type}: ID=${value.correlationId}, Status=${value.bodyStatus}, HasBody=${!!value.asyncBody}, HasError=${!!value.asyncBodyError}, BodyType=${value.bodyType}, ContentType=${value.contentType}, Encoding=${value.bodyEncoding}`);
			// --- END DEBUG LOG ---

			let bodySection = '\n\n---\nBody: [Not Loaded Yet]';
			const contentType = value.contentType || 'unknown';

			if (value.asyncBodyError) {
				bodySection = `\n\n---\nBody Error: ${value.asyncBodyError}`;
			} else if (value.bodyStatus === 'received' && value.asyncBody !== undefined && value.asyncBody !== null) {
				const bodyData = value.asyncBody;
				switch (value.bodyType) {
					case 'json':
						try {
							const parsedBody = JSON.parse(bodyData);
							bodySection = `\n\n---\nBody (JSON - ${contentType}):\n\`\`\`json\n${JSON.stringify(parsedBody, null, 2)}\n\`\`\``;
						} catch (e) {
							console.error(`[formatValueHover] Error parsing supposedly JSON body:`, e);
							bodySection = `\n\n---\nBody (Invalid JSON - ${contentType}):\n\`\`\`text\n${bodyData}\n\`\`\``;
						}
						break;
					case 'binary':
						// Command link is handled by CodeLens
						if (value.bodyEncoding === 'base64' && contentType.startsWith('image/')) {
							// Attempt to show image preview, CodeLens provides action
							bodySection = `\n\n---
Body (Image - ${contentType}):\n![Image](data:${contentType};base64,${bodyData})\n(Use CodeLens link to view)`;
						} else if (value.bodyEncoding === 'base64') {
							// Placeholder for non-image binary
							bodySection = `\n\n---
Body (Binary - ${contentType}):\n[${bodyData.length} chars Base64] - Use CodeLens link to view`;
						} else {
							bodySection = `\n\n---
Body (Binary - ${contentType}):\n[Binary data, unknown encoding] - Use CodeLens link to view`;
						}
						break;
					case 'text':
						// Treat as plain text
						bodySection = `\n\n---\nBody (Text - ${contentType}):\n\`\`\`text\n${bodyData}\n\`\`\``;
						break;
					case 'multipart':
						// Placeholder text, action is via CodeLens
						bodySection = `\n\n---
Body (Multipart - ${contentType}):\n[Multipart Form Data] - Use CodeLens link to view raw data`;
						break;
					default:
						bodySection = `\n\n---\nBody (Unknown Type: ${value.bodyType} - ${contentType}):\n\`\`\`text\n${bodyData}\n\`\`\``;
				}
			} else if (value.bodyStatus === 'pending') {
				bodySection = '\n\n---\nBody: [Loading...]';
			} else if (value.bodyStatus === 'not_applicable_or_used') {
				bodySection = '\n\n---\nBody: [Not Applicable or Already Used]';
			} else if (value.bodyStatus === 'error') {
				bodySection = `\n\n---\nBody Error: ${value.asyncBodyError || 'Unknown error'}`;
			} else {
				// Fallback for unexpected status or missing body data
				bodySection = `\n\n---\nBody: [Status: ${value.bodyStatus || 'Unknown'}, Data Unavailable]`;
				console.log(`[formatValueHover] Warning: Status is '${value.bodyStatus}' but asyncBody is missing or status is unexpected.`);
			}

			// Create a copy excluding the async/status fields for main display
			const displayValue = { ...value };
			delete displayValue.asyncBody;
			delete displayValue.asyncBodyError;
			delete displayValue.bodyStatus;

			return JSON.stringify(displayValue, null, 2) + bodySection;
		}

		// Original formatting
		return JSON.stringify(value, null, 2);
	} catch (e) {
		return '[Error: Could not stringify value]';
	}
}

// Helper function for relative time
function formatTimeAgo(timestamp: number): string {
	const now = Date.now();
	const secondsAgo = Math.round((now - timestamp) / 1000);
	if (secondsAgo < 3) return 'latest'; // Handle < 1 second
	if (secondsAgo < 60) return `${secondsAgo}s ago`;
	const minutesAgo = Math.round(secondsAgo / 60);
	if (minutesAgo < 60) return `${minutesAgo}m ago`;
	const hoursAgo = Math.round(minutesAgo / 60);
	if (hoursAgo < 24) return `${hoursAgo}h ago`;
	const daysAgo = Math.round(hoursAgo / 24);
	return `${daysAgo}d ago`;
}

// --- Value Comparison and Name Priority Helpers ---
function compareValues(v1: any, v2: any): boolean {
	if (typeof v1 !== typeof v2) return false;
	if (v1 === null && v2 === null) return true;
	if (v1 === null || v2 === null) return false;
	if (typeof v1 !== 'object') return v1 === v2;
	try {
		return JSON.stringify(v1) === JSON.stringify(v2);
	} catch {
		return false;
	}
}

function getNamePriority(name?: string): number {
	if (!name) return 0;
	if (name.startsWith('_callee|')) return 1;
	if (name.startsWith('anonymous|')) return 2;
	return 3;
}

// Helper to create hover message content from history
function createHoverMessageFromHistory(history: LogEntry[]): vscode.MarkdownString | undefined {
	if (!history || history.length === 0) return undefined;

	// DEBUG LOG
	console.log(`[Hover Message] Creating hover for ${history.length} entries`);
	history.forEach((entry, idx) => {
		if (entry.value && entry.value._type && entry.value.correlationId) {
			console.log(`[Hover Entry ${idx}] Type=${entry.type}, ValueType=${entry.value._type}, CorrelationID=${entry.value.correlationId}, Status=${entry.value.bodyStatus || 'none'}, HasBody=${!!entry.value.asyncBody}`);
		}
	});
	// END DEBUG LOG

	const md = new vscode.MarkdownString();
	md.isTrusted = true;
	md.supportThemeIcons = true;
	md.appendMarkdown(`#### Log History (Newest First) $(history)\n`);

	let lastProcessedTimestamp: number | null = null;

	for (let i = history.length - 1; i >= 0; i--) {
		const entry = history[i];
		const isNewTimestampGroup = entry.timestamp !== lastProcessedTimestamp;

		if (isNewTimestampGroup) {
			if (lastProcessedTimestamp !== null) {
				md.appendMarkdown('\n---\n');
			}
			lastProcessedTimestamp = entry.timestamp;
			const date = new Date(entry.timestamp);
			const time = date.toLocaleTimeString('en-US', {
				hour12: false,
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit',
				fractionalSecondDigits: 3
			});
			const timeAgo = formatTimeAgo(entry.timestamp);
			const groupType = entry.type;

			// Customize header for call-result
			if (groupType === 'call-result' && entry.name) {
				md.appendMarkdown(`##### **${time}** (${timeAgo}) - Call: \`${entry.name}\``);
			} else {
				md.appendMarkdown(`##### **${time}** (${timeAgo}) - Type: \`${groupType}\``);
			}
		}

		if (entry.type === 'parameter' && entry.name) {
			const nameParts = entry.name.split('|');
			const paramName = nameParts[nameParts.length - 1];
			md.appendMarkdown(`\n\`${paramName}\`:\n`);
			md.appendCodeblock(formatValueHover(entry.value), 'json');
		} else {
			md.appendMarkdown('\n');
			md.appendCodeblock(formatValueHover(entry.value), 'json');
		}
	}

	return md;
}

// Renamed: Updates the inline VALUE decorations
const updateValueDecorationsForEditor = debounce((editor: vscode.TextEditor | undefined) => {
	if (!editor || !valueDecorationType) return;

	const editorFilePath = editor.document.uri.fsPath.replace(/\\/g, '/').toLowerCase();
	const fileLogData = logDataStore.get(editorFilePath);
	const decorationsArray: vscode.DecorationOptions[] = [];

	if (fileLogData && fileLogData.size > 0) {
		fileLogData.forEach((history, line) => {
			if (!history || history.length === 0) return;
			const zeroBasedLine = line - 1;
			if (zeroBasedLine >= 0 && zeroBasedLine < editor.document.lineCount) {
				const lineText = editor.document.lineAt(zeroBasedLine);
				const range = new vscode.Range(zeroBasedLine, lineText.range.end.character, zeroBasedLine, lineText.range.end.character);
				const latestEntry = history[history.length - 1];
				const latestTimestamp = latestEntry.timestamp;
				let contentText = '';
				const latestParamsInline = new Map<string, string>();
				for (let i = history.length - 1; i >= 0; i--) {
					const entry = history[i];
					if (entry.timestamp !== latestTimestamp) break;
					if (entry.type === 'parameter' && entry.name) {
						const nameParts = entry.name.split('|');
						const paramName = nameParts[nameParts.length - 1];
						if (paramName) latestParamsInline.set(paramName, formatValueInline(entry.value));
					}
				}
				if (latestParamsInline.size > 0) {
					const paramStrings = Array.from(latestParamsInline.entries())
						.sort((a, b) => a[0].localeCompare(b[0]))
						.map(([name, value]) => `${name}: ${value}`);
					contentText = ` // => ${paramStrings.join(' | ')}`;
				} else {
					contentText = ` // => ${formatValueInline(latestEntry.value)}`;
				}
				const hoverMessage = createHoverMessageFromHistory(history);
				if (contentText) {
					decorationsArray.push({ range, renderOptions: { after: { contentText } }, hoverMessage });
				}
			}
		});
	}
	try {
		editor.setDecorations(valueDecorationType, decorationsArray);
	} catch (e) { console.error("Value Decoration Error:", e); }
}, 100);

// Removed updateSpinnerDecoration function

// Renamed: Updates VALUE decorations for matching path
function updateValueDecorationsForPath(filePathFromLog: string) {
	const normalizedLogFilePath = filePathFromLog.replace(/\\/g, '/').toLowerCase();
	vscode.window.visibleTextEditors.forEach(editor => {
		const normalizedEditorPath = editor.document.uri.fsPath.replace(/\\/g, '/').toLowerCase();
		if (normalizedEditorPath === normalizedLogFilePath) {
			updateValueDecorationsForEditor(editor); // Call the value updater
		}
	});
}

// Removed updateSpinnerDecorationForPath function

// --- CodeLens Provider for Spinner AND Blob Links ---
// Renamed from SpinnerCodeLensProvider
class LogActionCodeLensProvider implements vscode.CodeLensProvider {
	private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
	public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

	constructor() { }

	public refresh(): void {
		this._onDidChangeCodeLenses.fire();
	}

	public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens[]> {
		const normalizedFilePath = document.uri.fsPath.replace(/\\/g, '/').toLowerCase();
		const linesWithSpinners = activeSpinnerLines.get(normalizedFilePath);
		const codeLenses: vscode.CodeLens[] = [];
		const fileLogData = logDataStore.get(normalizedFilePath);

		// Process Spinners
		if (linesWithSpinners && linesWithSpinners.size > 0) {
			linesWithSpinners.forEach(line => {
				const zeroBasedLine = line - 1;
				if (zeroBasedLine >= 0 && zeroBasedLine < document.lineCount) {
					const range = new vscode.Range(zeroBasedLine, 0, zeroBasedLine, 0); // Position at start of line
					const codeLens = new vscode.CodeLens(range);
					codeLens.command = { // Command is required, but can be no-op
						title: "$(sync~spin) Executing...",
						command: "", // Empty command ID for no action
						arguments: []
					};
					codeLenses.push(codeLens);
				}
			});
		}

		// Process Blob Links
		if (fileLogData) {
			fileLogData.forEach((history, line) => {
				if (history && history.length > 0) {
					const latestEntry = history[history.length - 1];
					const value = latestEntry.value as RequestResponseValue | undefined;

					// Check if latest entry has viewable body data (binary or multipart)
					if (value && value.blobCacheId) {
						const zeroBasedLine = line - 1;
						if (zeroBasedLine >= 0 && zeroBasedLine < document.lineCount) {
							const range = new vscode.Range(zeroBasedLine, 0, zeroBasedLine, 0);
							const blobId = value.blobCacheId;
							console.log(`[CodeLens Provider] Creating blob link for Line ${line} with ID ${blobId}, type: ${value.bodyType}`);
							const args = [blobId];
							// Determine title based on known bodyType
							let title = "$(preview) View Body Content";
							if (value.bodyType === 'multipart') {
								title = "$(list-flat) View Raw Multipart Body";
							} else if (value.contentType?.startsWith('image/')) {
								title = "$(file-media) View Image";
							} else if (value.contentType?.includes('json')) {
								title = "$(code) View JSON Body";
							} else if (value.contentType?.startsWith('text/')) {
								title = "$(file-text) View Text Body";
							}

							const tooltip = `View ${value.contentType || 'body content'}`; // Simplified tooltip

							const command: vscode.Command = {
								title: title,
								command: "betterdebug.viewBlobContent",
								arguments: args,
								tooltip: tooltip
							};
							codeLenses.push(new vscode.CodeLens(range, command));
						}
					}
				}
			});
		}

		return codeLenses;
	}

	// Optional: resolveCodeLens if needed for more complex commands, but not for this spinner
	// public resolveCodeLens(codeLens: vscode.CodeLens, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens> {
	//     return codeLens;
	// }
}

// Helper function to get file extension from MIME type
function getExtensionFromMimeType(mimeType: string): string {
	if (!mimeType) return '.bin';
	const lowerMime = mimeType.toLowerCase();
	switch (lowerMime.split(';')[0]) { // Ignore parameters like charset
		case 'image/jpeg': return '.jpg';
		case 'image/png': return '.png';
		case 'image/gif': return '.gif';
		case 'image/svg+xml': return '.svg';
		case 'image/webp': return '.webp';
		case 'application/json': return '.json';
		case 'text/plain': return '.txt';
		case 'text/html': return '.html';
		case 'text/css': return '.css';
		case 'text/javascript': return '.js';
		case 'application/pdf': return '.pdf';
		case 'application/zip': return '.zip';
		// Add more mappings as needed
		default: return '.bin'; // Default binary extension
	}
}

// Helper to generate HTML for the webview panel
// function getWebviewContent(contentType: string, bodyType: string | undefined, bodyEncoding: string | undefined, bodyData: any): string { ... }

// Simple HTML escaping helper
function escapeHtml(unsafe: string): string {
	return unsafe
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

// --- Activation & WebSocket Server ---
export function activate(context: vscode.ExtensionContext) {
	initializeDecorationTypes(); // Only initializes value decorations now
	initializeLogFilePath(); // Determine log file path on activation
	const port = 8080;
	let wss: WebSocketServer | null = null;

	// Register the command for viewing blobs IN EDITOR / EXTERNALLY
	context.subscriptions.push(
		// Renamed command ID
		vscode.commands.registerCommand('betterdebug.viewBlobContent', async (...commandArgs: any[]) => {
			console.log(`[View Blob Content Command] Raw arguments received:`, commandArgs);

			if (!commandArgs || commandArgs.length === 0 || typeof commandArgs[0] !== 'string') {
				vscode.window.showErrorMessage('Invalid or missing data ID for viewing blob.');
				console.error('[View Blob Content Command] Invalid arguments received:', commandArgs);
				return;
			}

			const tempId: string = commandArgs[0];
			console.log(`[View Blob Content Command] Processing ID: ${tempId}`);
			const data = blobDataCache.get(tempId);

			if (data) {
				// Cache entry is NOT deleted here, relies on timeout for cleanup
				console.log(`[View Blob Content Command] Retrieved data for ID ${tempId}, Content-Type: ${data.contentType}`);
				const contentType = data.contentType || 'application/octet-stream';
				const lowerContentType = contentType.toLowerCase().split(';')[0]; // Ignore params

				try {
					// --- Handle based on Content-Type --- 
					if (lowerContentType === 'application/json') {
						// Open as new untitled JSON file
						const jsonString = Buffer.from(data.base64Data, 'base64').toString('utf8');
						// Attempt to pretty-print
						let formattedJson = jsonString;
						try {
							formattedJson = JSON.stringify(JSON.parse(jsonString), null, 2);
						} catch { /* Ignore formatting errors, show raw */ }

						const doc = await vscode.workspace.openTextDocument({ language: 'json', content: formattedJson });
						await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
						console.log(`[View Blob Content Command] Opened JSON content in untitled editor.`);

					} else if (lowerContentType.startsWith('text/')) {
						// Open as new untitled text file with appropriate language
						const textContent = Buffer.from(data.base64Data, 'base64').toString('utf8');
						let language = 'plaintext';
						if (lowerContentType === 'text/html') language = 'html';
						else if (lowerContentType === 'text/css') language = 'css';
						else if (lowerContentType === 'text/javascript') language = 'javascript';
						else if (lowerContentType === 'text/xml' || lowerContentType === 'application/xml') language = 'xml';
						// Add more text types if needed

						const doc = await vscode.workspace.openTextDocument({ language: language, content: textContent });
						await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
						console.log(`[View Blob Content Command] Opened ${language} content in untitled editor.`);

					} else {
						// Handle Images, Binary, Multipart via temp file 
						const buffer = Buffer.from(data.base64Data, 'base64');
						const extension = getExtensionFromMimeType(contentType);
						const tempFileName = `betterdebug-blob-${randomUUID()}${extension}`;
						const tempFilePath = path.join(os.tmpdir(), tempFileName);

						console.log(`[View Blob Content Command] Writing ${buffer.length} bytes to temp file: ${tempFilePath}`);
						fs.writeFileSync(tempFilePath, buffer);

						const fileUri = vscode.Uri.file(tempFilePath);
						console.log(`[View Blob Content Command] Opening file URI with vscode.open: ${fileUri.toString()}`);
						// Use vscode.open command to let VS Code handle the file (uses internal viewers)
						await vscode.commands.executeCommand('vscode.open', fileUri, {
							preview: false, // Open in a real tab, not preview
							viewColumn: vscode.ViewColumn.Beside // Try opening beside current editor
						});
						// Previous external open:
						// await vscode.env.openExternal(fileUri);
					}

				} catch (error: any) {
					console.error('[View Blob Content Command] Error processing or opening data:', error);
					vscode.window.showErrorMessage(`Failed to display content: ${error.message}`);
				}
			} else {
				// ... (Cache miss handling) ...
			}
		})
	);

	// Create and register the CodeLens provider
	logActionProvider = new LogActionCodeLensProvider();
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider({ scheme: 'file' }, logActionProvider)
	);

	function startServer() {
		if (wss) return;
		try {
			wss = new WebSocketServer({ port });
			vscode.window.showInformationMessage(`Inline Log Display Server started on port ${port}.`);
			wss.on('connection', (ws, req) => {
				ws.on('message', (message) => {
					const messageAsString = message.toString();
					// --- DEBUG LOG: Log raw message --- 
					console.log("[Raw WebSocket Message]:", messageAsString.substring(0, 500) + (messageAsString.length > 500 ? '...' : '')); // Log first 500 chars
					// --- END DEBUG LOG ---

					let parsedData: any = null;
					try {
						parsedData = JSON.parse(messageAsString);
						if (!parsedData) {
							console.error('[Inline Log Display] Failed to parse message or received null/empty data.');
							return;
						}
						const data: LogEntry = parsedData;
						// outputChannel.appendLine(JSON.stringify(data, null, 2)); // Optional: Keep for verbose debugging

						if (typeof data.filename !== 'string' || typeof data.line !== 'number' /*|| data.line <= 0*/ || typeof data.timestamp !== 'number') {
							// Allow line 0 for async messages
							if (!(data.line === 0 && data.filename === 'log-sender-async')) {
								console.error(`[Inline Log Display] Received invalid log entry structure or missing timestamp. File: ${data.filename}, Line: ${data.line}, TS: ${data.timestamp}`);
								return;
							}
						}
						// --- MOVE PROCESSING LOGIC HERE TO AVOID EARLY RETURN ON INVALID STRUCTURE ---
						const normalizedFilePath = typeof data.filename === 'string' ? data.filename.replace(/\\/g, '/').toLowerCase() : 'unknown-file';

						// --- Extensive DEBUG LOGGING ---
						const isAsyncBodyMessage = data.type === 'request-body' || data.type === 'response-body';
						const isAsyncErrorMessage = data.type === 'request-body-error' || data.type === 'response-body-error';

						console.log(`[Log Processing] Parsed message: type=${data.type}, file=${normalizedFilePath}, line=${data.line}, correlationId=${data.correlationId || 'none'}`);

						if (data.correlationId) {
							console.log(`[Correlation Check] Looking for correlationId=${data.correlationId} in map with ${correlationMap.size} entries`);
							const keys = Array.from(correlationMap.keys());
							console.log(`[Correlation Check] Current correlation keys: ${keys.join(', ') || 'none'}`);
						}
						// --- End DEBUG LOGGING ---

						// --- Start: Handle Async Body/Error Messages --- 
						if ((isAsyncBodyMessage || isAsyncErrorMessage) && data.correlationId) {
							console.log(`[Async Handler] Processing ${data.type} with correlationId=${data.correlationId}`);
							const originalLocation = correlationMap.get(data.correlationId);
							if (originalLocation) {
								console.log(`[Async Handler] Found location: file=${originalLocation.filePath}, line=${originalLocation.line}, index=${originalLocation.entryIndex}`);
								const fileData = logDataStore.get(originalLocation.filePath);
								if (fileData) {
									const lineHistory = fileData.get(originalLocation.line);
									if (lineHistory) {
										console.log(`[Async Handler] Found line history with ${lineHistory.length} entries`);
										if (originalLocation.entryIndex >= 0 && originalLocation.entryIndex < lineHistory.length) {
											const originalEntry = lineHistory[originalLocation.entryIndex];
											console.log(`[Async Handler] Found original entry: type=${originalEntry.type}, hasValue=${!!originalEntry.value}, valueType=${originalEntry.value ? typeof originalEntry.value : 'n/a'}`);
											// Ensure the original entry is the correct one (check value's correlationId)
											if (originalEntry.value &&
												typeof originalEntry.value === 'object' &&
												(originalEntry.value._type === 'Request' || originalEntry.value._type === 'Response') &&
												originalEntry.value.correlationId === data.correlationId
											) {
												// Cast to the specific type for safety
												const valueToUpdate = originalEntry.value as RequestResponseValue;
												// No need to deep clone here anymore, modify directly

												if (isAsyncBodyMessage) {
													console.log(`[Async Handler] Updating with body data (${typeof data.value === 'string' ? data.value.length : '?'} bytes)`);
													valueToUpdate.asyncBody = data.value; // Assign body from incoming message
													valueToUpdate.bodyStatus = 'received';
													// Store type info from the incoming message (data)
													valueToUpdate.contentType = (data as any).contentType;
													valueToUpdate.bodyType = (data as any).bodyType;
													valueToUpdate.bodyEncoding = (data as any).bodyEncoding;

													// --- Start: Cache Data for CodeLens (All Types) --- 
													// Always store if body is received successfully
													if (valueToUpdate.bodyStatus === 'received' && data.value !== undefined && data.value !== null) {
														const tempId = randomUUID();
														valueToUpdate.blobCacheId = tempId; // Store ID on the value object
														const cacheDuration = 300000; // Cache for 5 minutes

														// Ensure data is stored as Base64 for consistency in the cache
														let base64DataToCache: string;
														if (valueToUpdate.bodyEncoding === 'base64') {
															base64DataToCache = data.value; // Already base64
														} else { // utf8 (json, text, multipart)
															try {
																base64DataToCache = Buffer.from(data.value, 'utf8').toString('base64');
															} catch (encodeError) {
																console.error(`[Blob Cache] Error encoding ${valueToUpdate.bodyType} to Base64:`, encodeError);
																// Store raw value as fallback, might cause issues later
																base64DataToCache = String(data.value);
															}
														}

														blobDataCache.set(tempId, { base64Data: base64DataToCache, contentType: valueToUpdate.contentType || 'application/octet-stream' });
														console.log(`[Blob Cache] Stored ${valueToUpdate.bodyType} data with ID ${tempId} (Expires in ${cacheDuration / 1000}s)`);
														setTimeout(() => {
															console.log(`[Blob Cache] Cleaning up ID ${tempId}`);
															blobDataCache.delete(tempId);
														}, cacheDuration);
													}
													// --- End: Cache Data ---

												} else { // isAsyncErrorMessage
													console.log(`[Async Handler] Updating with error: ${data.value}`);
													valueToUpdate.asyncBodyError = data.value; // Assign error from incoming message
													valueToUpdate.bodyStatus = 'error';
													valueToUpdate.bodyType = 'error'; // Set body type to error
													valueToUpdate.contentType = (data as any).contentType;
												}

												// No need to replace the object, direct modification is fine now

												// --- DEBUG LOG ---
												console.log(`[Async Handler] Updated entry for ${data.correlationId}:`, JSON.stringify({
													status: valueToUpdate.bodyStatus,
													hasBody: !!valueToUpdate.asyncBody,
													hasError: !!valueToUpdate.asyncBodyError,
													bodyType: valueToUpdate.bodyType,
													encoding: valueToUpdate.bodyEncoding,
													contentType: valueToUpdate.contentType
												}));
												// --- END DEBUG LOG ---

												// --- Force Immediate Decoration Update --- 
												const editor = vscode.window.visibleTextEditors.find(editor =>
													editor.document.uri.fsPath.replace(/\\/g, '/').toLowerCase() === originalLocation.filePath
												);
												if (editor) {
													updateValueDecorationsForEditor.clearTimeout?.(); // Clear any pending debounced update for this editor
													updateValueDecorationsForEditor(editor); // Call the debounced function immediately
												} else {
													// Fallback if editor not visible, still schedule normal update
													updateValueDecorationsForPath(originalLocation.filePath);
												}
												// --- End Force Immediate Update ---

												correlationMap.delete(data.correlationId); // Clean up map
												return; // Skip further processing for this message
											}
										}
									}
								}
							} else {
								console.log(`[Async Handler] Correlation ID ${data.correlationId} not found in map.`);
							}
							// If original location not found or entry mismatch, log it but don't process further
							// console.warn(`[Inline Log Display] Received async body/error for unknown/cleared correlationId: ${data.correlationId}`);
							// return; // Don't return here, allow other processing
						}
						// --- End: Handle Async Body/Error Messages --- 

						// --- Add to File Log Buffer (AFTER parsing and async handling) ---
						if (logFilePath) {
							// We add *every* valid parsed log entry, including async updates or spinner markers if needed for context
							recentLogsBuffer.push(data);
							// Trigger debounced write after adding the new log
							debouncedWriteLogBufferToFile();
						}
						// --- End File Log Buffer Logic ---

						// --- Spinner Logic --- 
						let spinnerStateChanged = false;
						if (!activeSpinnerLines.has(normalizedFilePath)) {
							activeSpinnerLines.set(normalizedFilePath, new Set<number>());
						}
						const fileSpinnerLines = activeSpinnerLines.get(normalizedFilePath)!;

						if (data.type === 'async-keyword-detected') {
							if (!fileSpinnerLines.has(data.line)) {
								fileSpinnerLines.add(data.line);
								spinnerStateChanged = true;
							}
						} else if (data.type === 'async-keyword-detected-end') {
							if (fileSpinnerLines.has(data.line)) {
								fileSpinnerLines.delete(data.line);
								spinnerStateChanged = true;
							}
						}
						// --- Refresh CodeLens if spinner state changed OR if viewable body data arrived ---
						const bodyTypeForRefresh = (data as any).bodyType;
						const shouldRefreshForBody = isAsyncBodyMessage && (bodyTypeForRefresh === 'binary' || bodyTypeForRefresh === 'multipart');
						if (spinnerStateChanged || shouldRefreshForBody) {
							if (logActionProvider) {
								console.log("[CodeLens] Refreshing due to state change.");
								logActionProvider.refresh();
							}
						}

						// --- Value/History Logic --- 
						// Update history store
						if (!logDataStore.has(normalizedFilePath)) logDataStore.set(normalizedFilePath, new Map<number, LogEntry[]>());
						const fileLineData = logDataStore.get(normalizedFilePath)!;

						let shouldAddNewEntry = true;

						// --- Prevent Placeholder Logs from entering History ---
						if ((data.type === 'async-keyword-detected' || data.type === 'async-keyword-detected-end') &&
							typeof data.value === 'string' &&
							data.value.startsWith('[Keyword')) {
							shouldAddNewEntry = false;
						}

						// --- Filtering Logic for Parameters (Example - adjust if needed) --- 
						if (shouldAddNewEntry && (data.type === 'parameter' || data.type === 'return' || data.type === 'variable' || data.type === 'assignment' || data.type === 'condition')) {
							if (!fileLineData.has(data.line)) fileLineData.set(data.line, []);
							const lineHistory = fileLineData.get(data.line)!;
							// Example: Don't add if identical value already exists at the same timestamp
							const exists = lineHistory.some(entry => entry.timestamp === data.timestamp && compareValues(entry.value, data.value));
							if (exists) shouldAddNewEntry = false;
						}

						if (shouldAddNewEntry) {
							if (!fileLineData.has(data.line)) fileLineData.set(data.line, []);
							const lineHistory = fileLineData.get(data.line)!;
							lineHistory.push(data);
							if (lineHistory.length > MAX_HISTORY_PER_LINE) lineHistory.shift();

							// --- Start: Track Correlation ID for Sync Request/Response --- 
							if ((data.value?._type === 'Request' || data.value?._type === 'Response') && data.value?.correlationId && data.value?.bodyStatus === 'pending') {
								const entryIndex = lineHistory.length - 1; // Index of the entry just pushed
								const correlationId = data.value.correlationId;
								console.log(`[Correlation Tracking] Storing correlationId=${correlationId} for ${data.value._type} at ${normalizedFilePath}:${data.line}:${entryIndex}`);
								correlationMap.set(correlationId, {
									filePath: normalizedFilePath,
									line: data.line,
									entryIndex: entryIndex
								});
							}
							// --- End: Track Correlation ID --- 
						}

						// Update VALUE decorations for the path
						updateValueDecorationsForPath(normalizedFilePath);
						// No longer need to call spinner update here - CodeLens handles it via event

					} catch (error) {
						console.error(`[Inline Log Display] Error processing message: ${messageAsString.substring(0, 200)}...`, error);
					}
				});
				ws.on('close', () => { });
				ws.on('error', (error) => {
					console.error(`[Inline Log Display] Client connection error: ${error.message}`);
				});
			});
			wss.on('error', (error) => {
				vscode.window.showErrorMessage(`Inline Log Display Server error: ${error.message}`);
				console.error(`[Inline Log Display] Server error: ${error.message}`);
				if (wss) { wss.close(); wss = null; }
				setTimeout(startServer, 10000);
			});
			wss.on('close', () => { wss = null; });
		} catch (error) {
			console.error(`[Inline Log Display] Failed to start server: ${error instanceof Error ? error.message : String(error)}`);
			if (!wss) {
				vscode.window.showErrorMessage(`Failed to start Inline Log Display Server on port ${port}. Is the port in use?`);
			}
			wss = null;
			setTimeout(startServer, 10000);
		}
	}
	startServer();

	// --- Periodic Refresh Timer --- 
	const REFRESH_INTERVAL_MS = 10000; // Keep refreshing values periodically
	refreshInterval = setInterval(() => {
		vscode.window.visibleTextEditors.forEach(editor => {
			updateValueDecorationsForEditor(editor); // Refresh values/hover
			// CodeLens provider refreshes automatically via its event emitter
		});
	}, REFRESH_INTERVAL_MS);

	// --- Event Listeners & Cleanup --- 
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor) {
				updateValueDecorationsForEditor(editor);
				// CodeLens refreshes automatically when editor becomes active
			}
		})
	);
	context.subscriptions.push(
		vscode.window.onDidChangeVisibleTextEditors(editors => {
			editors.forEach(editor => {
				updateValueDecorationsForEditor(editor);
				// CodeLens refreshes automatically for newly visible editors
			});
		})
	);
	context.subscriptions.push(
		vscode.workspace.onDidCloseTextDocument(document => {
			const normalizedFilePath = document.uri.fsPath.replace(/\\/g, '/').toLowerCase();
			if (logDataStore.has(normalizedFilePath)) {
				// Clear any pending correlations for this file from the map
				correlationMap.forEach((value, key) => {
					if (value.filePath === normalizedFilePath) {
						correlationMap.delete(key);
					}
				});
				logDataStore.delete(normalizedFilePath);
			}
			// Clear active spinners for the closed file
			if (activeSpinnerLines.has(normalizedFilePath)) {
				activeSpinnerLines.delete(normalizedFilePath);
				// Trigger CodeLens refresh for any remaining visible editors showing this file (unlikely but possible)
				if (logActionProvider) logActionProvider.refresh();
			}
		})
	);
	context.subscriptions.push(
		vscode.workspace.onDidSaveTextDocument(document => {
			const normalizedFilePath = document.uri.fsPath.replace(/\\/g, '/').toLowerCase();
			// Clear value history on save
			if (logDataStore.has(normalizedFilePath)) {
				// Clear any pending correlations for this file from the map
				correlationMap.forEach((value, key) => {
					if (value.filePath === normalizedFilePath) {
						correlationMap.delete(key);
					}
				});
				logDataStore.delete(normalizedFilePath);
				updateValueDecorationsForPath(normalizedFilePath); // Clear value decos
			}
			// Clear active spinners on save
			if (activeSpinnerLines.has(normalizedFilePath)) {
				activeSpinnerLines.delete(normalizedFilePath);
				// Trigger CodeLens refresh for editors showing this file
				if (logActionProvider) logActionProvider.refresh();
			}
		})
	);
	context.subscriptions.push({
		dispose: () => {
			if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
			if (valueDecorationType) { valueDecorationType.dispose(); valueDecorationType = null; }
			if (wss) { wss.close(); wss = null; }
			// Ensure pending log writes are flushed if possible (or just clear buffer)
			debouncedWriteLogBufferToFile.clearTimeout?.(); // Clear any pending write timeout
			recentLogsBuffer = []; // Clear buffer on deactivate/dispose
			logFilePath = null; // Reset log file path
			// logActionProvider reference cleanup (handled by subscription disposal)
			correlationMap.clear(); // Clear correlation map on disposal
			blobDataCache.clear(); // Clear blob cache on disposal
		}
	});
}
export function deactivate() {
	if (refreshInterval) {
		clearInterval(refreshInterval);
		refreshInterval = null;
	}
	// Clear buffer and path on explicit deactivation as well
	recentLogsBuffer = [];
	logFilePath = null;
	debouncedWriteLogBufferToFile.clearTimeout?.();
	// Other cleanup is handled by the dispose function registered in activate
}