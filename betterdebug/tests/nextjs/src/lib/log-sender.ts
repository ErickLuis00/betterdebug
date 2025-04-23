import { randomUUID } from 'crypto'; // Import randomUUID for Node.js

let wsClient: any = null;
let isNode = false;
let NodeWebSocket: any = null;
let isConnecting = false;
let connectionEstablished = false;
const messageQueue: string[] = [];
const WS_URL = 'ws://localhost:8080';
let reconnectTimeout: NodeJS.Timeout | null = null;

// Environment detection
try {
    isNode = Object.prototype.toString.call(global.process) === '[object process]';
} catch (e) { /* ignore */ }

// Dynamically import 'ws' in Node.js environment
async function loadWs() {
    if (isNode && !NodeWebSocket) {
        try {
            const wsModule = await import('ws');
            NodeWebSocket = wsModule.default || wsModule; // Handle different module export styles
        } catch (err) {
            console.error('[Log Sender] Failed to load ws module:', err);
            // Handle error, perhaps disable logging in Node if ws isn't available
        }
    }
}

function connectWebSocket() {
    if (isConnecting || connectionEstablished) {
        // console.log('[Log Sender] Connection attempt skipped (already connecting or established).');
        return;
    }
    isConnecting = true;
    if (reconnectTimeout) clearTimeout(reconnectTimeout);

    // console.log('[Log Sender] Attempting to connect to', WS_URL);

    const WebSocketImpl = isNode ? NodeWebSocket : WebSocket;

    if (!WebSocketImpl) {
        // console.error('[Log Sender] WebSocket implementation not available.');
        isConnecting = false;
        // Maybe schedule retry for ws loading?
        return;
    }

    try {
        wsClient = new WebSocketImpl(WS_URL);
    } catch (error) {
        console.error('[Log Sender] Failed to create WebSocket:', error);
        isConnecting = false;
        scheduleReconnect();
        return;
    }

    wsClient.onopen = () => {
        // console.log('[Log Sender] WebSocket connection established.');
        connectionEstablished = true;
        isConnecting = false;
        // Send any queued messages
        while (messageQueue.length > 0) {
            const message = messageQueue.shift();
            if (message) {
                try {
                    wsClient.send(message);
                } catch (sendError) {
                    console.error('[Log Sender] Error sending queued message:', sendError);
                    // Re-queue or discard?
                    messageQueue.unshift(message); // Re-queue at the beginning
                    connectionEstablished = false;
                    scheduleReconnect();
                    break;
                }
            }
        }
    };

    wsClient.onclose = (event: any) => {
        // console.log('[Log Sender] WebSocket connection closed. Code:', event.code, 'Reason:', event.reason);
        connectionEstablished = false;
        isConnecting = false;
        wsClient = null;
        scheduleReconnect();
    };

    wsClient.onerror = (error: any) => {
        console.error('[Log Sender] WebSocket error:', isNode ? error : error.message || 'Unknown browser error');
        connectionEstablished = false;
        isConnecting = false;
        // wsClient might be null or in a closing state already
        if (wsClient && typeof wsClient.close === 'function') {
            try { wsClient.close(); } catch (e) {/* ignore */ }
        }
        wsClient = null;
        // Don't schedule reconnect here, onclose will handle it
    };

    // We don't expect messages from the server
    // wsClient.onmessage = (event) => { ... };
}

function scheduleReconnect() {
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    // console.log('[Log Sender] Scheduling reconnect...');
    reconnectTimeout = setTimeout(() => {
        if (!connectionEstablished && !isConnecting) {
            // console.log('[Log Sender] Attempting reconnect...');
            connectWebSocket();
        }
    }, 5000); // Reconnect after 5 seconds
}

// --- Simple ID Generator (Browser/Node compatible) ---
function generateUUID(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    } else if (isNode) {
        // Fallback for Node.js environments where global crypto might not be standard yet
        // Requires Node >= 14.17.0 or experimental flag
        try {
            const nodeCrypto = require('crypto');
            return nodeCrypto.randomUUID();
        } catch (e) {
            // Basic fallback if crypto module not available
            return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
        }
    } else {
        // Basic fallback for older browsers
        return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    }
}

// --- Define the new Payload Interface ---
interface LogPayload {
    filename: string;
    line: number;
    type: string; // Extend as needed
    name?: string; // Variable/param name, condition text
    value: any;    // The actual value being logged
    codeLine: string;
    timestamp: number;
    env: 'node' | 'browser';
    correlationId?: string; // Added for async correlation
    // Fields specifically for async body messages
    contentType?: string | null; // Added: Original Content-Type
    bodyType?: 'json' | 'text' | 'binary' | 'error' | 'multipart'; // Added: Detected type
    bodyEncoding?: 'utf8' | 'base64'; // Added: How body is encoded in 'value'
}

// Helper function to convert ArrayBuffer to Base64
function arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    // Use btoa in browser, Buffer in Node
    if (typeof btoa === 'function') {
        return btoa(binary);
    } else if (isNode) {
        return Buffer.from(binary, 'binary').toString('base64');
    } else {
        console.error('[log-sender] Cannot encode Base64 in this environment.');
        return '[Base64 Encoding Not Supported]';
    }
}

// Helper function to check if content type suggests binary data
function isLikelyBinary(contentType: string | null): boolean {
    if (!contentType) return false;
    const type = contentType.split(';')[0].toLowerCase();
    return [
        'image/',
        'audio/',
        'video/',
        'application/octet-stream',
        'application/pdf',
        'application/zip',
        'application/gzip'
        // Add more binary MIME types as needed
    ].some(prefix => type.startsWith(prefix));
}

// Helper function to apply specific serialization logic to a single value
function transformLogValue(originalValue: any): any {
    const valueType = typeof originalValue;

    if (valueType === 'function') {
        return '[Function]';
    } else if (valueType === 'symbol') {
        return originalValue.toString();
    } else if (valueType === 'undefined') {
        return 'undefined';
    } else if (valueType === 'object' && originalValue !== null) {
        // Handle specific known object types that don't serialize well
        // --- CHECK PROMISE FIRST --- (Promises are objects)
        if (typeof Promise !== 'undefined' && originalValue instanceof Promise) {
            return '[Promise]'; // Represent Promise objects clearly
        }
        // --- THEN OTHER TYPES --- 
        else if (originalValue instanceof Error) {
            // Basic Error info
            let errorRepresentation: any = {
                _type: 'Error',
                name: originalValue.name,
                message: originalValue.message,
                stack: originalValue.stack?.split('\n')?.slice(0, 5).join('\n') + '...' // Keep stack short
            };
            // Check for cause property and try to serialize it (basic)
            if ('cause' in originalValue && originalValue.cause !== undefined) {
                try {
                    // Avoid deep recursion / complex causes
                    const causeValue = originalValue.cause;
                    if (typeof causeValue === 'object' && causeValue !== null) {
                        errorRepresentation.cause = `[Object: ${causeValue.constructor?.name || 'Unknown'}]`; // Represent cause simply
                    } else {
                        errorRepresentation.cause = JSON.stringify(causeValue); // Try simple stringify for primitives
                    }
                } catch {
                    errorRepresentation.cause = '[Unserializable Cause]';
                }
            }
            return errorRepresentation;
        } else if (typeof Request !== 'undefined' && originalValue instanceof Request) {
            const correlationId = generateUUID();
            const requestContentType = originalValue.headers?.get('content-type') || null;
            const requestInfo: any = {
                _type: 'Request',
                url: originalValue.url,
                method: originalValue.method,
                headers: originalValue.headers ? Object.fromEntries(originalValue.headers.entries()) : {},
                contentType: requestContentType, // Store Content-Type
                correlationId: correlationId, // Add correlation ID
                bodyStatus: 'pending', // Initial status
            };

            // Asynchronously read body if applicable and not already read
            if (!['GET', 'HEAD'].includes(originalValue.method) && !originalValue.bodyUsed) {
                const processRequestBody = async () => {
                    try {
                        const clonedRequest = originalValue.clone();
                        let bodyValue: any;
                        let bodyType: LogPayload['bodyType'] = 'text';
                        let bodyEncoding: LogPayload['bodyEncoding'] = 'utf8';

                        // Check for multipart first
                        if (requestContentType?.startsWith('multipart/form-data')) {
                            console.log(`[log-sender] Reading request body as multipart text for ${correlationId}`);
                            bodyValue = await clonedRequest.text(); // Read raw multipart as text
                            bodyType = 'multipart';
                            bodyEncoding = 'utf8';
                        } else if (isLikelyBinary(requestContentType)) {
                            console.log(`[log-sender] Reading request body as binary for ${correlationId}`);
                            bodyValue = await clonedRequest.arrayBuffer();
                            bodyValue = arrayBufferToBase64(bodyValue);
                            bodyType = 'binary';
                            bodyEncoding = 'base64';
                        } else {
                            console.log(`[log-sender] Reading request body as text for ${correlationId}`);
                            bodyValue = await clonedRequest.text();
                            try {
                                JSON.parse(bodyValue);
                                bodyType = 'json';
                                console.log(`[log-sender] Request body for ${correlationId} parsed as JSON.`);
                            } catch (jsonError) {
                                bodyType = 'text';
                                console.log(`[log-sender] Request body for ${correlationId} treated as text.`);
                            }
                            bodyEncoding = 'utf8';
                        }

                        console.log(`[log-sender] Successfully read request body for ${correlationId}, type=${bodyType}, encoding=${bodyEncoding}, calling _sendLog.`);
                        _sendLog({
                            filename: 'log-sender-async',
                            line: 0,
                            type: 'request-body',
                            name: `Body for ${correlationId}`,
                            value: bodyValue,
                            codeLine: `[Async Request Body Result]`,
                            timestamp: Date.now(),
                            env: isNode ? 'node' : 'browser',
                            correlationId: correlationId,
                            contentType: requestContentType,
                            bodyType: bodyType,
                            bodyEncoding: bodyEncoding
                        });
                    } catch (err: any) {
                        console.error(`[log-sender] Error reading request body for ${correlationId}:`, err);
                        _sendLog({
                            filename: 'log-sender-async',
                            line: 0,
                            type: 'request-body-error',
                            name: `Body Error for ${correlationId}`,
                            value: err.message || String(err),
                            codeLine: `[Async Request Body Error]`,
                            timestamp: Date.now(),
                            env: isNode ? 'node' : 'browser',
                            correlationId: correlationId,
                            contentType: requestContentType,
                            bodyType: 'error' // Mark as error type
                        });
                    }
                };
                processRequestBody(); // Fire off the async processing
            } else {
                requestInfo.bodyStatus = 'not_applicable_or_used'; // Update status if no body read attempt
            }
            return requestInfo;

        } else if (typeof Response !== 'undefined' && originalValue instanceof Response) {
            const correlationId = generateUUID();
            const responseContentType = originalValue.headers?.get('content-type') || null;
            const responseInfo: any = {
                _type: 'Response',
                ok: originalValue.ok,
                status: originalValue.status,
                statusText: originalValue.statusText,
                url: originalValue.url,
                type: originalValue.type,
                redirected: originalValue.redirected,
                headers: originalValue.headers ? Object.fromEntries(originalValue.headers.entries()) : {},
                contentType: responseContentType, // Store Content-Type
                correlationId: correlationId, // Add correlation ID
                bodyStatus: 'pending' // Initial status
            };

            // Asynchronously read body if applicable and not already read
            if (originalValue.body && !originalValue.bodyUsed) { // Read regardless of status code for now
                const processResponseBody = async () => {
                    try {
                        const clonedResponse = originalValue.clone();
                        let bodyValue: any;
                        let bodyType: LogPayload['bodyType'] = 'text';
                        let bodyEncoding: LogPayload['bodyEncoding'] = 'utf8';

                        if (isLikelyBinary(responseContentType)) {
                            console.log(`[log-sender] Reading response body as binary for ${correlationId}`);
                            bodyValue = await clonedResponse.arrayBuffer();
                            bodyValue = arrayBufferToBase64(bodyValue); // Encode as Base64
                            bodyType = 'binary';
                            bodyEncoding = 'base64';
                        } else {
                            console.log(`[log-sender] Reading response body as text for ${correlationId}`);
                            bodyValue = await clonedResponse.text();
                            try {
                                JSON.parse(bodyValue);
                                bodyType = 'json';
                                console.log(`[log-sender] Response body for ${correlationId} parsed as JSON.`);
                            } catch (jsonError) {
                                bodyType = 'text';
                                console.log(`[log-sender] Response body for ${correlationId} treated as text.`);
                            }
                            bodyEncoding = 'utf8';
                        }

                        console.log(`[log-sender] Successfully read response body for ${correlationId}, type=${bodyType}, encoding=${bodyEncoding}, calling _sendLog.`);
                        _sendLog({
                            filename: 'log-sender-async',
                            line: 0,
                            type: 'response-body',
                            name: `Body for ${correlationId}`,
                            value: bodyValue,
                            codeLine: `[Async Response Body Result]`,
                            timestamp: Date.now(),
                            env: isNode ? 'node' : 'browser',
                            correlationId: correlationId,
                            contentType: responseContentType,
                            bodyType: bodyType,
                            bodyEncoding: bodyEncoding
                        });
                    } catch (err: any) {
                        console.error(`[log-sender] Error reading response body for ${correlationId}:`, err);
                        _sendLog({
                            filename: 'log-sender-async',
                            line: 0,
                            type: 'response-body-error',
                            name: `Body Error for ${correlationId}`,
                            value: err.message || String(err),
                            codeLine: `[Async Response Body Error]`,
                            timestamp: Date.now(),
                            env: isNode ? 'node' : 'browser',
                            correlationId: correlationId,
                            contentType: responseContentType,
                            bodyType: 'error' // Mark as error type
                        });
                    }
                };
                processResponseBody(); // Fire off the async processing
            } else {
                responseInfo.bodyStatus = 'not_applicable_or_used'; // Update status
            }
            return responseInfo;
        } else if (originalValue instanceof Date) {
            return {
                _type: 'Date',
                iso: originalValue.toISOString()
            };
        } else if (originalValue instanceof RegExp) {
            return {
                _type: 'RegExp',
                source: originalValue.source,
                flags: originalValue.flags
            };
        } else if (originalValue instanceof Map) {
            const mapArray = Array.from(originalValue.entries()).slice(0, 10); // Limit entries
            return {
                _type: 'Map',
                entries: mapArray.map(([key, value]) => [transformLogValue(key), transformLogValue(value)]), // Recursively transform entries
                size: originalValue.size,
                ...(originalValue.size > 10 && { _truncated: true })
            };
        } else if (originalValue instanceof Set) {
            const setArray = Array.from(originalValue.values()).slice(0, 10); // Limit entries
            return {
                _type: 'Set',
                values: setArray.map(transformLogValue), // Recursively transform values
                size: originalValue.size,
                ...(originalValue.size > 10 && { _truncated: true })
            };
        } else if (originalValue instanceof ArrayBuffer) {
            return {
                _type: 'ArrayBuffer',
                byteLength: originalValue.byteLength
            };
        } else if (ArrayBuffer.isView(originalValue) && !(originalValue instanceof DataView)) {
            return {
                _type: originalValue.constructor.name,
                byteLength: originalValue.byteLength,
                byteOffset: originalValue.byteOffset,
                length: (originalValue as any).length
            };
        } else if (typeof Element !== 'undefined' && originalValue instanceof Element) {
            return `[Element <${originalValue.tagName.toLowerCase()}>]`;
        } else if (typeof Event !== 'undefined' && originalValue instanceof Event) {
            return {
                _type: 'Event',
                type: originalValue.type,
                isTrusted: originalValue.isTrusted,
                bubbles: originalValue.bubbles,
                cancelable: originalValue.cancelable,
            };
        }
        else {
            // For other objects (including plain arrays that aren't console args),
            // try standard JSON stringify, handle circular refs
            try {
                JSON.stringify(originalValue); // Test stringify first
                return originalValue; // Return original if it's safe
            } catch (stringifyError: any) {
                return `[Serialization Error: ${stringifyError.message}]`;
            }
        }
    }
    // Primitives like string, number, boolean, null fall through
    return originalValue;
}

// --- Updated _sendLog Function ---
// Make sure to include optional fields from LogPayload
export function _sendLog(logData: LogPayload) {
    let message: string;
    try {
        let valueToSend: any;
        const originalValue = logData.value;

        // Check if it's a console log and the value is an array
        if (logData.type.startsWith('console-') && Array.isArray(originalValue)) {
            // Apply transformation to each argument in the console log
            valueToSend = originalValue.map(arg => transformLogValue(arg));
        } else {
            // Apply transformation to the single value for other log types
            valueToSend = transformLogValue(originalValue);
        }

        // Final Stringification of the whole payload
        message = JSON.stringify({ ...logData, value: valueToSend });

    } catch (e: any) {
        // Catch unexpected errors during the value processing itself
        console.error('[Log Sender] Critical error during log data processing:', e);
        try {
            // Attempt to send a minimal error message
            message = JSON.stringify({
                filename: logData.filename,
                line: logData.line,
                type: 'processing-error',
                name: 'Log Send Error',
                value: `[Log Processing Error: ${e.message}]`,
                codeLine: logData.codeLine,
                timestamp: logData.timestamp,
                env: logData.env,
                error: 'Log processing failed'
            });
        } catch (finalError) {
            // If even *that* fails, give up
            console.error('[Log Sender] Failed to stringify final error log.');
            return; // Abort sending
        }
    }

    // WebSocket sending logic (keep as is)
    if (connectionEstablished && wsClient && wsClient.readyState === (isNode ? NodeWebSocket.OPEN : WebSocket.OPEN)) {
        try {
            wsClient.send(message);
        } catch (sendError) {
            console.error('[Log Sender] Error sending message:', sendError);
            messageQueue.push(message);
            connectionEstablished = false;
            if (wsClient && typeof wsClient.close === 'function') {
                try { wsClient.close(); } catch (e) {/* ignore */ }
            }
            wsClient = null;
            scheduleReconnect();
        }
    } else {
        // console.log('[Log Sender] Queuing message, connection not ready.');
        messageQueue.push(message);
        if (!isConnecting) {
            // Ensure connection attempt starts if not already connecting
            connectWebSocket();
        }
    }
}

// Initial setup
async function initializeLogSender() {
    if (isNode) {
        await loadWs();
    }
    // Attempt initial connection
    connectWebSocket();
}

initializeLogSender(); // Start the process 