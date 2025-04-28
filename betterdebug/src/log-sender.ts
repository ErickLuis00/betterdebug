// ! LOG SENDER IIFE - CROSS ENVIRONMENT (NODE AND BROWSER)
// SHOULD NOT IMPORT ANY PACKAGE, ALL PACKAGES SHOULD BE ONLY IFNODE AND INLINE REQUIRES.

(function () {

    // Define a unique global key for the shared state
    const globalKey = '__betterdebug_logSenderState__';

    // --- Initialize or Get Shared State ---
    if (!(globalThis as any)[globalKey]) {
        // First time initialization
        console.log('[Log Sender] Initializing shared state.');
        const isNode = typeof (globalThis as any).process !== 'undefined' && (globalThis as any).process.versions != null && (globalThis as any).process.versions.node != null;
        const isBrowser = typeof (globalThis as any).window !== 'undefined' && typeof (globalThis as any).document !== 'undefined' && !isNode;
        const config = (globalThis as any).betterdebug?.config || {};

        (globalThis as any)[globalKey] = {
            wsClient: null,
            isConnecting: false,
            connectionEstablished: false,
            messageQueue: [],
            reconnectTimeout: null,
            _cachedWebSocketImpl: null,
            _extensionPath: null,
            WS_URL: `ws://localhost:${53117}`,
            isNode: isNode,
            isBrowser: isBrowser,
        };
    }

    // Get a reference to the shared state
    const state = (globalThis as any)[globalKey];

    // --- Update potentially changed config values ---
    const currentConfig = (globalThis as any).betterdebug?.config || {};
    state._extensionPath = currentConfig.extensionPath || state._extensionPath; // Keep old if new is missing
    state.WS_URL = currentConfig.wsPort ? `ws://localhost:${currentConfig.wsPort}` : state.WS_URL; // Keep old if new is missing

    // --- WebSocket Implementation Getter ---
    function getWebSocketImplementation(): any {
        if (state._cachedWebSocketImpl) return state._cachedWebSocketImpl;

        if (state.isBrowser && (globalThis as any).WebSocket) {
            state._cachedWebSocketImpl = (globalThis as any).WebSocket;
            return state._cachedWebSocketImpl;
        } else if (typeof process !== 'undefined' && process.versions && process.versions.node && state.isNode) {
            if (!state._extensionPath) {
                console.error('[Log Sender] Error: log-sender not initialized with extension path. Cannot load \'ws\'.')
                return null
            }
            try {
                console.log("[Log Sender] [NODE BLOCK] Attempting to require Node.js modules...");
                const path = require('path')
                const { createRequire } = require('module')
                console.log("[Log Sender] [NODE BLOCK] Successfully required 'path' and 'module'.");
                const customRequire = createRequire(path.join(state._extensionPath, 'dummy.js'))
                const wsModule = customRequire('./node_modules/ws')
                console.log('[Log Sender] [NODE BLOCK] Successfully required \'ws\':', wsModule);
                state._cachedWebSocketImpl = wsModule.default || wsModule
                return state._cachedWebSocketImpl
            } catch (err) {
                console.error('[Log Sender] Failed to require ws module:', err);
                return null;
            }
        } else {
            console.error('[Log Sender] WebSocket implementation not found for this environment.');
            return null;
        }
    }

    async function connectWebSocket() {
        if (state.isConnecting || state.connectionEstablished) {
            return;
        }
        state.isConnecting = true;
        if (state.reconnectTimeout) clearTimeout(state.reconnectTimeout);
        state.reconnectTimeout = null; // Clear timer ID after use

        if (!state.WS_URL) {
            console.error('[Log Sender] WS_URL is not configured. Cannot connect.');
            state.isConnecting = false;
            return; // Cannot proceed without URL
        }

        // console.log('[Log Sender] Attempting to connect to', state.WS_URL);

        const WebSocketImpl = getWebSocketImplementation();
        // console.log('WebSocketImpl acquired:', WebSocketImpl ? 'Yes' : 'No');
        // console.log('Environment:', state.isNode ? 'Node' : state.isBrowser ? 'Browser' : 'Unknown');
        // console.log('[Log Sender] Using WebSocketImpl:', WebSocketImpl);


        if (!WebSocketImpl) {
            console.error('[Log Sender] WebSocket implementation not available.');
            state.isConnecting = false;
            // Maybe schedule retry for ws loading? Consider if needed.
            return;
        }

        try {
            state.wsClient = new WebSocketImpl(state.WS_URL);
        } catch (error) {
            console.error('[Log Sender] Failed to create WebSocket:', error, 'env', state.isNode ? 'node' : state.isBrowser ? 'browser' : 'unknown');
            state.isConnecting = false;
            scheduleReconnect();
            return;
        }

        state.wsClient.onopen = () => {
            // console.log('[Log Sender] WebSocket connection established.');
            state.connectionEstablished = true;
            state.isConnecting = false;
            // Send any queued messages
            while (state.messageQueue.length > 0) {
                const message = state.messageQueue.shift();
                if (message) {
                    try {
                        state.wsClient.send(message);
                    } catch (sendError) {
                        console.error('[Log Sender] Error sending queued message:', sendError, 'env', state.isNode ? 'node' : 'browser');
                        state.messageQueue.unshift(message); // Re-queue
                        if (state.wsClient) {
                            try { state.wsClient.close(); } catch (e) {/* ignore */ }
                        }
                        state.connectionEstablished = false;
                        state.isConnecting = false;
                        state.wsClient = null;
                        scheduleReconnect();
                        break;
                    }
                }
            }
        };

        state.wsClient.onclose = (event: any) => {
            // console.log('[Log Sender] WebSocket connection closed. Code:', event.code, 'Reason:', event.reason);
            state.connectionEstablished = false;
            state.isConnecting = false;
            state.wsClient = null;
            scheduleReconnect();
        };

        state.wsClient.onerror = (error: any) => {
            console.error('[Log Sender] WebSocket error:', error.message || error);
            state.connectionEstablished = false;
            state.isConnecting = false;
            if (state.wsClient && typeof state.wsClient.close === 'function') {
                try { state.wsClient.close(); } catch (e) {/* ignore */ }
            }
            state.wsClient = null;
            // onclose will handle scheduling reconnect
        };
    }

    function scheduleReconnect() {
        if (state.reconnectTimeout) clearTimeout(state.reconnectTimeout); // Clear existing timer
        // console.log('[Log Sender] Scheduling reconnect...');
        state.reconnectTimeout = setTimeout(() => {
            state.reconnectTimeout = null; // Clear timer ID before attempting connect
            if (!state.connectionEstablished && !state.isConnecting) {
                // console.log('[Log Sender] Attempting reconnect...');
                connectWebSocket();
            }
        }, 5000);
    }

    // --- Simple ID Generator (Browser/Node compatible, using globalThis) ---
    function generateUUID(): string {
        if (typeof (globalThis as any).crypto !== 'undefined' && (globalThis as any).crypto.randomUUID) {
            return (globalThis as any).crypto.randomUUID();
        }
        if (typeof process !== 'undefined' && process.versions && process.versions.node && state.isNode) {
            try {
                console.log("[Log Sender] [NODE BLOCK] Attempting to require Node.js 'crypto' module...");
                const nodeCrypto = require('crypto');
                if (nodeCrypto.randomUUID) {
                    console.log("[Log Sender] [NODE BLOCK] Successfully required 'crypto' and found randomUUID.");
                    return nodeCrypto.randomUUID();
                }
            } catch (e) {
                console.warn('[Log Sender] Failed to use Node crypto.randomUUID, falling back.', e);
            }
        }
        console.warn('[Log Sender] Using basic fallback for UUID generation.');
        return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
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

    // Helper function to convert ArrayBuffer to Base64 (using globalThis)
    function arrayBufferToBase64(buffer: ArrayBuffer): string {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        if (state.isBrowser && typeof (globalThis as any).btoa === 'function') {
            return (globalThis as any).btoa(binary);
        } else if (state.isNode && typeof Buffer !== 'undefined') {
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
            if (typeof Promise !== 'undefined' && originalValue instanceof Promise) {
                return '[Promise]';
            }
            else if (originalValue instanceof Error) {
                let errorRepresentation: any = {
                    _type: 'Error',
                    name: originalValue.name,
                    message: originalValue.message,
                    stack: originalValue.stack?.split('\n')?.slice(0, 5).join('\n') + '...'
                };
                if ('cause' in originalValue && originalValue.cause !== undefined) {
                    try {
                        const causeValue = originalValue.cause;
                        if (typeof causeValue === 'object' && causeValue !== null) {
                            errorRepresentation.cause = `[Object: ${causeValue.constructor?.name || 'Unknown'}]`;
                        } else {
                            errorRepresentation.cause = JSON.stringify(causeValue);
                        }
                    } catch {
                        errorRepresentation.cause = '[Unserializable Cause]';
                    }
                }
                return errorRepresentation;
            } else if (typeof (globalThis as any).Request !== 'undefined' && originalValue instanceof (globalThis as any).Request) {
                const correlationId = generateUUID();
                const requestContentType = originalValue.headers?.get('content-type') || null;
                const requestInfo: any = {
                    _type: 'Request',
                    url: originalValue.url,
                    method: originalValue.method,
                    headers: originalValue.headers ? Object.fromEntries(originalValue.headers.entries()) : {},
                    contentType: requestContentType,
                    correlationId: correlationId,
                    bodyStatus: 'pending',
                };

                if (!['GET', 'HEAD'].includes(originalValue.method) && !originalValue.bodyUsed) {
                    const processRequestBody = async () => {
                        try {
                            const clonedRequest = originalValue.clone();
                            let bodyValue: any;
                            let bodyType: LogPayload['bodyType'] = 'text';
                            let bodyEncoding: LogPayload['bodyEncoding'] = 'utf8';

                            if (requestContentType?.startsWith('multipart/form-data')) {
                                // console.log(`[log-sender] Reading request body as multipart text for ${correlationId}`);
                                bodyValue = await clonedRequest.text();
                                bodyType = 'multipart';
                                bodyEncoding = 'utf8';
                            } else if (isLikelyBinary(requestContentType)) {
                                // console.log(`[log-sender] Reading request body as binary for ${correlationId}`);
                                bodyValue = await clonedRequest.arrayBuffer();
                                bodyValue = arrayBufferToBase64(bodyValue);
                                bodyType = 'binary';
                                bodyEncoding = 'base64';
                            } else {
                                // console.log(`[log-sender] Reading request body as text for ${correlationId}`);
                                bodyValue = await clonedRequest.text();
                                try {
                                    JSON.parse(bodyValue);
                                    bodyType = 'json';
                                    // console.log(`[log-sender] Request body for ${correlationId} parsed as JSON.`);
                                } catch (jsonError) {
                                    bodyType = 'text';
                                    // console.log(`[log-sender] Request body for ${correlationId} treated as text.`);
                                }
                                bodyEncoding = 'utf8';
                            }

                            // console.log(`[log-sender] Successfully read request body for ${correlationId}, type=${bodyType}, encoding=${bodyEncoding}, calling _sendLog.`);
                            // Call _sendLog which correctly uses shared state
                            _sendLog({
                                filename: 'log-sender-async',
                                line: 0,
                                type: 'request-body',
                                name: `Body for ${correlationId}`,
                                value: bodyValue,
                                codeLine: `[Async Request Body Result]`,
                                timestamp: Date.now(),
                                env: state.isNode ? 'node' : 'browser', // Use state for env
                                correlationId: correlationId,
                                contentType: requestContentType,
                                bodyType: bodyType,
                                bodyEncoding: bodyEncoding
                            });
                        } catch (err: any) {
                            // console.error(`[log-sender] Error reading request body for ${correlationId}:`, err);
                            _sendLog({
                                filename: 'log-sender-async',
                                line: 0,
                                type: 'request-body-error',
                                name: `Body Error for ${correlationId}`,
                                value: err.message || String(err),
                                codeLine: `[Async Request Body Error]`,
                                timestamp: Date.now(),
                                env: state.isNode ? 'node' : 'browser', // Use state for env
                                correlationId: correlationId,
                                contentType: requestContentType,
                                bodyType: 'error',
                                bodyEncoding: 'utf8'
                            });
                        }
                    };
                    processRequestBody();
                } else {
                    requestInfo.bodyStatus = 'not_applicable_or_used';
                }
                return requestInfo;

            } else if (typeof (globalThis as any).Response !== 'undefined' && originalValue instanceof (globalThis as any).Response) {
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
                    contentType: responseContentType,
                    correlationId: correlationId,
                    bodyStatus: 'pending'
                };

                if (originalValue.body && !originalValue.bodyUsed) {
                    const processResponseBody = async () => {
                        try {
                            const clonedResponse = originalValue.clone();
                            let bodyValue: any;
                            let bodyType: LogPayload['bodyType'] = 'text';
                            let bodyEncoding: LogPayload['bodyEncoding'] = 'utf8';

                            if (isLikelyBinary(responseContentType)) {
                                console.log(`[log-sender] Reading response body as binary for ${correlationId}`);
                                bodyValue = await clonedResponse.arrayBuffer();
                                bodyValue = arrayBufferToBase64(bodyValue);
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
                                env: state.isNode ? 'node' : 'browser', // Use state for env
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
                                env: state.isNode ? 'node' : 'browser', // Use state for env
                                correlationId: correlationId,
                                contentType: responseContentType,
                                bodyType: 'error',
                                bodyEncoding: 'utf8'
                            });
                        }
                    };
                    processResponseBody();
                } else {
                    responseInfo.bodyStatus = 'not_applicable_or_used';
                }
                return responseInfo;
            } else if (originalValue instanceof Date) {
                return { _type: 'Date', iso: originalValue.toISOString() };
            } else if (originalValue instanceof RegExp) {
                return { _type: 'RegExp', source: originalValue.source, flags: originalValue.flags };
            } else if (originalValue instanceof Map) {
                const mapArray = Array.from(originalValue.entries()).slice(0, 10);
                return {
                    _type: 'Map',
                    entries: mapArray.map(([key, value]) => [transformLogValue(key), transformLogValue(value)]),
                    size: originalValue.size,
                    ...(originalValue.size > 10 && { _truncated: true })
                };
            } else if (originalValue instanceof Set) {
                const setArray = Array.from(originalValue.values()).slice(0, 10);
                return {
                    _type: 'Set',
                    values: setArray.map(transformLogValue),
                    size: originalValue.size,
                    ...(originalValue.size > 10 && { _truncated: true })
                };
            } else if (originalValue instanceof ArrayBuffer) {
                return { _type: 'ArrayBuffer', byteLength: originalValue.byteLength };
            } else if (ArrayBuffer.isView(originalValue) && !(originalValue instanceof DataView)) {
                return {
                    _type: originalValue.constructor.name,
                    byteLength: originalValue.byteLength,
                    byteOffset: originalValue.byteOffset,
                    length: (originalValue as any).length
                };
            } else if (typeof (globalThis as any).Element !== 'undefined' && originalValue instanceof (globalThis as any).Element) {
                return `[Element <${originalValue.tagName.toLowerCase()}>]`;
            } else if (typeof (globalThis as any).Event !== 'undefined' && originalValue instanceof (globalThis as any).Event) {
                return {
                    _type: 'Event',
                    type: originalValue.type,
                    isTrusted: originalValue.isTrusted,
                    bubbles: originalValue.bubbles,
                    cancelable: originalValue.cancelable,
                };
            }
            else {
                try {
                    JSON.stringify(originalValue);
                    return originalValue;
                } catch (stringifyError: any) {
                    return `[Serialization Error: ${stringifyError.message}]`;
                }
            }
        }
        return originalValue;
    }

    // --- Updated _sendLog Function ---
    // This now accesses the shared state object correctly
    function _sendLog(logData: LogPayload) {
        let message: string;
        try {
            let valueToSend: any;
            const originalValue = logData.value;

            if (logData.type.startsWith('console-') && Array.isArray(originalValue)) {
                valueToSend = originalValue.map(arg => transformLogValue(arg));
            } else {
                valueToSend = transformLogValue(originalValue);
            }

            // Ensure env comes from shared state
            message = JSON.stringify({ ...logData, value: valueToSend, env: state.isNode ? 'node' : 'browser' });

        } catch (e: any) {
            console.error('[Log Sender] Critical error during log data processing:', e);
            try {
                message = JSON.stringify({
                    filename: logData.filename,
                    line: logData.line,
                    type: 'processing-error',
                    name: 'Log Send Error',
                    value: `[Log Processing Error: ${e.message}]`,
                    codeLine: logData.codeLine,
                    timestamp: logData.timestamp,
                    env: state.isNode ? 'node' : 'browser', // Use state for env
                    error: 'Log processing failed'
                });
            } catch (finalError) {
                console.error('[Log Sender] Failed to stringify final error log.');
                return;
            }
        }

        // WebSocket sending logic using shared state
        if (state.connectionEstablished && state.wsClient) {
            const WsImplementation = getWebSocketImplementation(); // Gets cached impl from state
            if (WsImplementation && state.wsClient.readyState === WsImplementation.OPEN) {
                try {
                    state.wsClient.send(message);
                } catch (sendError) {
                    console.error('[Log Sender] Error sending message:', sendError, 'env', state.isNode ? 'node' : 'browser');
                    state.messageQueue.push(message); // Use shared queue
                    state.connectionEstablished = false;
                    state.isConnecting = false;
                    if (state.wsClient && typeof state.wsClient.close === 'function') {
                        try { state.wsClient.close(); } catch (e) {/* ignore */ }
                    }
                    state.wsClient = null;
                    scheduleReconnect(); // Uses shared timer state
                }
            } else {
                // console.log('CONNECTION ESTABLISHED BUT NOT READY, Queuing message. State:', state.wsClient.readyState);
                state.messageQueue.push(message); // Use shared queue
            }
        } else {
            // console.log('CONNECTION NOT ESTABLISHED, Queuing message.');
            state.messageQueue.push(message); // Use shared queue
            if (!state.isConnecting && !state.connectionEstablished) { // Check both flags before attempting connection
                // Ensure connection attempt starts if not already connecting and not established
                connectWebSocket(); // Uses shared state
            }
        }
    }

    // --- Make _sendLog globally accessible for external calls (if needed) ---
    // Attach it to the shared state object itself to avoid polluting globalThis directly
    if (!state._sendLog) { // Define only once
        state._sendLog = _sendLog;
    }

    // Example of how external code *could* potentially call sendLog, though likely unnecessary
    // if instrumentation handles it internally via the eval'd scope.
    // (globalThis as any).__betterdebug_logSenderState__?._sendLog?.({ ... });

}()); // End IIFE