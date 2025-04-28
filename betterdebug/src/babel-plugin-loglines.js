// ! THIS BABEL PLUGIN WORKS WITH ANY PROJECT, THERE IS A WRAPPER SPECIFIC FOR EACH FRAMEWORK.
// BUT ALL OF THEM USES THE SAME PLUGIN, IF JS/TS/TSX, IF VUE/SVELTE THEN NOT WORKING YET.

const { declare } = require('@babel/helper-plugin-utils');
const { types: t } = require('@babel/core');
const path = require('path');
const fs = require('fs'); // Import fs

// Function to create a serializable check function AST
function createSerializableCheckFunctionAST() {
    const serializableCheckId = t.identifier('_isSerializable'); // Use a fixed name for simplicity
    const typeofId = t.identifier('_typeof'); // Reference to our helper
    const valueId = t.identifier('v');
    const serializableCheckDecl = t.variableDeclaration('const', [
        t.variableDeclarator(
            serializableCheckId,
            t.functionExpression(
                null, // Function name (can be anonymous)
                [valueId], // Argument 'v'
                t.blockStatement([ // Function body
                    // Basic types: null, undefined
                    t.ifStatement(
                        t.binaryExpression('===', valueId, t.nullLiteral()),
                        t.returnStatement(t.booleanLiteral(true))
                    ),
                    t.ifStatement(
                        t.binaryExpression('===', t.callExpression(typeofId, [valueId]), t.stringLiteral('undefined')),
                        t.returnStatement(t.booleanLiteral(true))
                    ),
                    // Primitive types: string, number, boolean
                    t.ifStatement(
                        t.binaryExpression('===', t.callExpression(typeofId, [valueId]), t.stringLiteral('string')),
                        t.returnStatement(t.booleanLiteral(true))
                    ),
                    t.ifStatement(
                        t.binaryExpression('===', t.callExpression(typeofId, [valueId]), t.stringLiteral('number')),
                        t.returnStatement(t.booleanLiteral(true))
                    ),
                    t.ifStatement(
                        t.binaryExpression('===', t.callExpression(typeofId, [valueId]), t.stringLiteral('boolean')),
                        t.returnStatement(t.booleanLiteral(true))
                    ),
                    // Avoid functions and symbols
                    t.ifStatement(
                        t.binaryExpression('===', t.callExpression(typeofId, [valueId]), t.stringLiteral('function')),
                        t.returnStatement(t.booleanLiteral(false))
                    ),
                    t.ifStatement(
                        t.binaryExpression('===', t.callExpression(typeofId, [valueId]), t.stringLiteral('symbol')),
                        t.returnStatement(t.booleanLiteral(false))
                    ),
                    // Try JSON stringify for arrays/objects
                    t.tryStatement(
                        t.blockStatement([
                            t.expressionStatement(t.callExpression(
                                t.memberExpression(t.identifier('JSON'), t.identifier('stringify')),
                                [valueId]
                            )),
                            t.returnStatement(t.booleanLiteral(true))
                        ]),
                        t.catchClause(
                            t.identifier('e'),
                            t.blockStatement([t.returnStatement(t.booleanLiteral(false))])
                        )
                    )
                ])
            )
        )
    ]);
    return { serializableCheckId, serializableCheckDecl };
}

// Helper to create a simple typeof helper AST
function createTypeofHelperAST() {
    return t.functionDeclaration(
        t.identifier('_typeof'),
        [t.identifier('obj')],
        t.blockStatement([
            t.returnStatement(
                t.unaryExpression('typeof', t.identifier('obj'))
            )
        ])
    )
}

// Function to create the _sendLog call
function createSendLogCall(state, nodePath, type, name, valueIdentifier, codeLine) {
    const line = nodePath.node.loc?.start?.line ?? 0;
    // Use the absolute path directly from Babel's state
    const filename = state.file.opts.filename
        ? state.file.opts.filename.replace(/\\/g, '/') // Normalize separators
        : 'unknown_file';

    const escapedCodeLine = codeLine
        ? codeLine.replace(/`/g, '\\`').replace(/\${/g, '\\${')
        : '[Code not available]';

    const logPayload = t.objectExpression([
        t.objectProperty(t.identifier('filename'), t.stringLiteral(filename)),
        t.objectProperty(t.identifier('line'), t.numericLiteral(line)),
        t.objectProperty(t.identifier('type'), t.stringLiteral(type)),
        t.objectProperty(t.identifier('name'), t.stringLiteral(name || '')),
        t.objectProperty(t.identifier('value'), valueIdentifier), // Pass the identifier directly
        t.objectProperty(t.identifier('codeLine'), t.stringLiteral(escapedCodeLine)),
        t.objectProperty(t.identifier('timestamp'), t.callExpression(t.memberExpression(t.identifier('Date'), t.identifier('now')), [])),
        t.objectProperty(t.identifier('env'), t.conditionalExpression( // Determine env at runtime
            t.binaryExpression('!==', t.unaryExpression('typeof', t.identifier('window')), t.stringLiteral('undefined')),
            t.stringLiteral('browser'),
            t.stringLiteral('node')
        ))
    ]);

    // Target the _sendLog function attached to the global state object
    const sendLogCallee = t.memberExpression(
        t.memberExpression(t.identifier('globalThis'), t.identifier('__betterdebug_logSenderState__')),
        t.identifier('_sendLog')
    );

    const call = t.expressionStatement(t.callExpression(sendLogCallee, [logPayload]));
    call._generated = true; // Mark as generated

    // Wrap the call in a check for the global state and function
    const check = t.logicalExpression(
        '&&',
        t.memberExpression(t.identifier('globalThis'), t.identifier('__betterdebug_logSenderState__')),
        sendLogCallee // Checks if globalThis.__betterdebug_logSenderState__._sendLog exists
    );

    const safeCall = t.ifStatement(check, t.blockStatement([call]));
    safeCall._generated = true; // Mark the whole if statement as generated

    return safeCall;
}

// Moved function visitor logic outside the main visitor object
function _FunctionVisitorHandler(nodePath, state, funcType, serializableCheckId) {
    if (state.file.get('isLoggerModule') || !nodePath.node.loc || nodePath.node._generated) return;

    // Allow functions without bodies (like interface declarations) or with non-block bodies
    if (!nodePath.node.body) return;

    const hasBlockBody = t.isBlockStatement(nodePath.node.body);
    // Removed the check that required a block body here

    const codeLine = getCodeLine(nodePath, state);
    let funcName = '';
    if (nodePath.node.id) {
        funcName = nodePath.node.id.name;
    } else if (nodePath.parentPath.isVariableDeclarator() && t.isIdentifier(nodePath.parentPath.node.id)) {
        funcName = nodePath.parentPath.node.id.name;
    } else if (nodePath.parentPath.isObjectProperty() && t.isIdentifier(nodePath.parentPath.node.key)) {
        funcName = nodePath.parentPath.node.key.name;
    }
    funcName = funcName || 'anonymous';

    const logStatements = [];
    nodePath.get('params').forEach((paramPath, index) => {
        if (paramPath.isIdentifier()) {
            const paramName = paramPath.node.name;
            const paramId = t.identifier(paramName);
            const logStmt = t.ifStatement(
                t.callExpression(serializableCheckId, [paramId]),
                createSendLogCall(state, paramPath, 'parameter', `${funcName}|${paramName}`, paramId, codeLine)
            );
            logStmt._generated = true;
            logStatements.push(logStmt);
        } else if (paramPath.isAssignmentPattern() && t.isIdentifier(paramPath.node.left)) {
            const paramName = paramPath.node.left.name;
            const paramId = t.identifier(paramName);
            const logStmt = t.ifStatement(
                t.callExpression(serializableCheckId, [paramId]),
                createSendLogCall(state, paramPath, 'parameter', `${funcName}|${paramName}`, paramId, codeLine)
            );
            logStmt._generated = true;
            logStatements.push(logStmt);
        } else {
            const placeholderValue = t.stringLiteral(`[${paramPath.node.type}]`);
            const logStmt = createSendLogCall(state, paramPath, 'parameter', `${funcName}|param${index}`, placeholderValue, codeLine);
            // Mark the generated IfStatement directly
            logStmt._generated = true;
            logStatements.push(logStmt);
        }
    });

    if (logStatements.length > 0) {
        try {
            if (hasBlockBody) {
                // Existing logic: Insert logs at the start of the block
                nodePath.get('body').unshiftContainer('body', logStatements);
            } else {
                // New logic: Wrap expression body in a block with logs and return
                const originalBody = nodePath.node.body;
                const returnStmt = t.returnStatement(originalBody);
                const newBlockBody = t.blockStatement([...logStatements, returnStmt]);
                // Mark the new block itself or its contents? Mark the block for simplicity.
                newBlockBody._generated = true;
                nodePath.node.body = newBlockBody;
            }
        } catch (e) {
            console.error(`[log-values-plugin] Error inserting parameter logs for ${funcName}: ${e.message} in ${state.file.opts.filename}`);
        }
    }
}

// Helper to check if a node is inside a log call to prevent recursion
const isInsideLogCall = (path) => {
    return path.findParent((p) =>
        p.isCallExpression() &&
        p.get('callee').isIdentifier({ name: '_sendLog' })
    );
};

// Helper to get source code line
const getCodeLine = (nodePath, state) => {
    const line = nodePath.node.loc?.start?.line;
    if (!line || !state.file.code) return '[Code not available]';
    const lines = state.file.code.split(/\r?\n/);
    return (lines[line - 1] || '').trim();
}

// Helper function to check if a node represents a structure containing only static literals
function isStaticLiteralStructure(nodePath) {
    if (!nodePath || !nodePath.node) return false; // Guard against null/undefined paths/nodes
    const node = nodePath.node;

    if (t.isLiteral(node)) { // Base case: includes string, number, boolean, null, regex
        return true;
    }

    if (t.isArrayExpression(node)) {
        // Recursively check elements
        return node.elements.every((element, index) => {
            if (element === null) return true; // Handle sparse arrays
            // Get the path for the element to recurse correctly
            const elementPath = nodePath.get(`elements.${index}`);
            return elementPath && isStaticLiteralStructure(elementPath);
        });
    }

    if (t.isObjectExpression(node)) {
        // Recursively check property values
        return node.properties.every((prop, index) => {
            if (t.isObjectProperty(prop)) {
                // Get the path for the value to recurse correctly
                const valuePath = nodePath.get(`properties.${index}.value`);
                return valuePath && isStaticLiteralStructure(valuePath);
            }
            // Consider spread elements or methods as non-static for simplicity
            return false;
        });
    }

    // Any other node type (Identifier, CallExpression, BinaryExpression, etc.) is considered dynamic
    return false;
}

// --- Main Plugin --- 
module.exports = declare((api, options) => {
    api.assertVersion(7);

    // --- Read log-sender.ts content --- 
    let logSenderCode = '';
    const logSenderPath = path.resolve(__dirname, '..', 'out', 'log-sender.js'); // Correct path relative to plugin
    try {
        logSenderCode = fs.readFileSync(logSenderPath, 'utf8');
        console.log(`[log-values-plugin] Successfully read log-sender code from: ${logSenderPath}`);
        console.log(`[log-values-plugin] logSenderCode: ${logSenderCode}`);
    } catch (err) {
        console.error(`[log-values-plugin] FATAL ERROR: Could not read log-sender.ts from ${logSenderPath}. Plugin disabled.`, err);
        // Return an empty visitor object to effectively disable the plugin if the core code is missing
        return { name: 'log-values-disabled' };
    }
    // Add config object before eval - necessary for log-sender initialization
    // This assumes the wsPort and extensionPath are known at build time or passed via options
    // TODO: Consider passing these via plugin options for flexibility
    const wsPort = options.wsPort || 53117; // Default or from options
    const extensionPath = (options.extensionPath || process.cwd()).replace(/\\/g, '/'); // Default or from options, normalize slashes
    const configCode = `
    if (typeof globalThis.betterdebug === 'undefined') { globalThis.betterdebug = {}; }
    if (typeof globalThis.betterdebug.config === 'undefined') {
      globalThis.betterdebug.config = { wsPort: ${wsPort}, extensionPath: "${extensionPath}" };
    } else {
      globalThis.betterdebug.config.wsPort = ${wsPort};
      globalThis.betterdebug.config.extensionPath = "${extensionPath}";
    }
    `;
    const finalCodeToEval = configCode + logSenderCode; // Restore config concatenation
    // --- End Reading log-sender.ts ---

    const { serializableCheckId, serializableCheckDecl } = createSerializableCheckFunctionAST();

    return {
        name: 'log-values',
        visitor: {
            Program: {
                enter(programPath, state) {
                    // No need to check logger module path anymore, as we eval everywhere
                    // const currentFilePath = state.file.opts.filename;
                    // if (currentFilePath && path.resolve(currentFilePath) === loggerModulePath) {
                    //     state.file.set('isLoggerModule', true);
                    //     return;
                    // }

                    // Check if helpers and eval code have been injected
                    if (state.file.get('loggerSetupDone')) {
                        return;
                    }

                    // --- Inject log-sender code via eval --- 
                    const logSenderCodeLiteral = t.stringLiteral(finalCodeToEval); // Use the code read from file
                    const evalCall = t.callExpression(t.identifier('eval'), [logSenderCodeLiteral]);
                    // Guard: Only eval if the global state hasn't been set up yet
                    const evalCheck = t.ifStatement(
                        t.binaryExpression(
                            '===',
                            t.unaryExpression('typeof', t.memberExpression(t.identifier('globalThis'), t.identifier('__betterdebug_logSenderState__'))),
                            t.stringLiteral('undefined')
                        ),
                        t.blockStatement([t.expressionStatement(evalCall)])
                    );
                    evalCheck._generated = true; // Mark the node itself before injecting
                    programPath.unshiftContainer('body', evalCheck);
                    // --- End eval injection ---

                    // Inject _typeof helper function
                    const typeofHelperNode = createTypeofHelperAST();
                    typeofHelperNode._generated = true; // Mark before injecting
                    programPath.unshiftContainer('body', typeofHelperNode);

                    // Inject _isSerializable helper function
                    const serializableHelperNode = serializableCheckDecl; // It's already a node
                    serializableHelperNode._generated = true; // Mark before injecting
                    programPath.unshiftContainer('body', serializableHelperNode);

                    state.file.set('loggerSetupDone', true);
                }
            },

            // --- Specific Visitors --- 

            VariableDeclaration(nodePath, state) {
                if (state.file.get('isLoggerModule') || !nodePath.node.loc || nodePath.node._generated || isInsideLogCall(nodePath)) return;
                if (nodePath.parentPath.isProgram() || nodePath.parentPath.isExportNamedDeclaration() || nodePath.parentPath.isExportDefaultDeclaration()) return; // Avoid top-level for now

                const codeLine = getCodeLine(nodePath, state);

                nodePath.node.declarations.forEach(declaration => {
                    if (declaration.init && t.isIdentifier(declaration.id)) {
                        // Skip function/class declarations assigned to vars
                        if (t.isFunction(declaration.init) || t.isClass(declaration.init)) {
                            return;
                        }

                        const varName = declaration.id.name;
                        const valueIdentifier = t.identifier(varName);

                        // Create log statement conditional on serializability
                        const logStmt = t.ifStatement(
                            t.callExpression(serializableCheckId, [valueIdentifier]),
                            createSendLogCall(state, nodePath, 'variable', varName, valueIdentifier, codeLine)
                        );
                        logStmt._generated = true;

                        // Try to insert after the declaration
                        try {
                            if (nodePath.parentPath.isBlockStatement() || nodePath.parentPath.isForStatement() || nodePath.inList) {
                                nodePath.insertAfter(logStmt);
                            } else {
                                // console.warn(`[log-values-plugin] Could not instrument VariableDeclaration at ${filename}:L${line}`);
                            }
                        } catch (e) {
                            console.error(`[log-values-plugin] Error inserting variable log: ${e.message}`);
                        }
                    }
                });
            },

            AssignmentExpression(nodePath, state) {
                if (state.file.get('isLoggerModule') || !nodePath.node.loc || nodePath.node._generated || isInsideLogCall(nodePath)) return;
                if (!nodePath.parentPath.isExpressionStatement()) return; // Only log assignments that are standalone statements

                // Skip function/class assignments
                if (t.isFunction(nodePath.node.right) || t.isClass(nodePath.node.right)) {
                    return;
                }

                const codeLine = getCodeLine(nodePath, state);
                let varName = '[complex assignment]';
                let valueIdentifier = nodePath.node.right; // Use the right side directly initially

                if (t.isIdentifier(nodePath.node.left)) {
                    varName = nodePath.node.left.name;
                    valueIdentifier = t.identifier(varName); // Log the variable itself after assignment
                } else if (t.isMemberExpression(nodePath.node.left)) {
                    try {
                        // Attempt to get a string representation (e.g., 'obj.prop')
                        varName = nodePath.get('left').toString();
                        valueIdentifier = nodePath.node.left; // Log the member expression itself
                    } catch (e) { /* ignore, keep default */ }
                }

                const logStmt = t.ifStatement(
                    t.callExpression(serializableCheckId, [valueIdentifier]),
                    createSendLogCall(state, nodePath, 'assignment', varName, valueIdentifier, codeLine)
                );
                logStmt._generated = true;

                try {
                    nodePath.parentPath.insertAfter(logStmt);
                } catch (e) {
                    console.error(`[log-values-plugin] Error inserting assignment log: ${e.message}`);
                }
            },

            IfStatement(nodePath, state) {
                if (state.file.get('isLoggerModule') || !nodePath.node.loc || nodePath.node._generated || isInsideLogCall(nodePath)) return;

                const codeLine = getCodeLine(nodePath, state);
                const testExpression = nodePath.get('test');
                let testCode = 'condition';
                try {
                    testCode = testExpression.toString();
                } catch (e) { /* ignore */ }

                const conditionResultId = nodePath.scope.generateUidIdentifier("conditionResult");

                // Declare variable for the result: const conditionResult = ...test...
                const condVarDecl = t.variableDeclaration('const', [
                    t.variableDeclarator(conditionResultId, nodePath.node.test)
                ]);
                condVarDecl._generated = true;

                // Log the result: _sendLog({ ..., value: conditionResult, ... })
                const logStmt = createSendLogCall(state, nodePath, 'condition', testCode, conditionResultId, codeLine);

                // Replace original test with the variable: if (conditionResult)
                nodePath.node.test = t.identifier(conditionResultId.name);

                try {
                    nodePath.insertBefore([condVarDecl, logStmt]);
                } catch (e) {
                    console.error(`[log-values-plugin] Error inserting condition log: ${e.message}`);
                }
            },

            // Common logic for function parameters is now outside

            FunctionDeclaration(nodePath, state) {
                _FunctionVisitorHandler(nodePath, state, 'FunctionDeclaration', serializableCheckId);
            },
            ArrowFunctionExpression(nodePath, state) {
                _FunctionVisitorHandler(nodePath, state, 'ArrowFunctionExpression', serializableCheckId);
            },
            FunctionExpression(nodePath, state) {
                _FunctionVisitorHandler(nodePath, state, 'FunctionExpression', serializableCheckId);
            },
            ObjectMethod(nodePath, state) {
                _FunctionVisitorHandler(nodePath, state, 'ObjectMethod', serializableCheckId);
            },
            ClassMethod(nodePath, state) {
                _FunctionVisitorHandler(nodePath, state, 'ClassMethod', serializableCheckId);
            },

            ReturnStatement(nodePath, state) {
                if (state.file.get('isLoggerModule') || !nodePath.node.loc || nodePath.node._generated || isInsideLogCall(nodePath)) return;
                if (!nodePath.node.argument) return; // Only log returns with a value

                // Avoid logging return if it's just a function/class expression
                if (t.isFunction(nodePath.node.argument) || t.isClass(nodePath.node.argument)) {
                    return;
                }

                const codeLine = getCodeLine(nodePath, state);

                const returnValueId = nodePath.scope.generateUidIdentifier("returnValue");

                // Declare variable: const returnValue = ...argument...
                const returnVarDecl = t.variableDeclaration('const', [
                    t.variableDeclarator(returnValueId, nodePath.node.argument)
                ]);
                returnVarDecl._generated = true;

                // Log if serializable: if(_isSerializable(returnValue)) _sendLog({ ..., value: returnValue, ... })
                const logStmt = t.ifStatement(
                    t.callExpression(serializableCheckId, [returnValueId]),
                    createSendLogCall(state, nodePath, 'return', '', returnValueId, codeLine)
                );
                logStmt._generated = true;

                // Replace original argument: return returnValue;
                nodePath.node.argument = t.identifier(returnValueId.name);

                try {
                    nodePath.insertBefore([returnVarDecl, logStmt]);
                } catch (e) {
                    console.error(`[log-values-plugin] Error inserting return log: ${e.message}`);
                }
            },

            // Potentially add CallExpression visitor later if needed (can be complex)

            // Clean up generic statement visitor (no longer needed)
            /*
            Statement: {
                enter(nodePath, state) {
                    // ... old code removed ... 
                }
            }
            */

            // --- Log Async Operations ---

            // @NEXTJS USING SWC DOESNT TRIGGER THIS VISITOR.
            // AwaitExpression(nodePath, state) {
            //     console.log(`[log-lines-plugin DEBUG] >>> ENTER AwaitExpression visitor for: ${state.file.opts.filename}`);
            //     if (state.file.get('isLoggerModule')) {
            //         console.log(`[log-lines-plugin DEBUG] <<< EXIT AwaitExpression (isLoggerModule)`);
            //         return;
            //     }
            //     if (!nodePath.node.loc) {
            //         console.log(`[log-lines-plugin DEBUG] <<< EXIT AwaitExpression (no loc)`);
            //         return;
            //     }
            //     if (nodePath.node._generated) {
            //         console.log(`[log-lines-plugin DEBUG] <<< EXIT AwaitExpression (_generated node)`);
            //         return;
            //     }
            //     if (isInsideLogCall(nodePath)) {
            //         console.log(`[log-lines-plugin DEBUG] <<< EXIT AwaitExpression (inside _sendLog)`);
            //         return;
            //     }
            //     console.log(`[log-lines-plugin DEBUG] --- Processing AwaitExpression at line: ${nodePath.node.loc?.start?.line}`);

            //     // Find the parent statement to insert before
            //     const parentStmt = nodePath.getStatementParent();
            //     if (!parentStmt) {
            //         console.log(`[log-lines-plugin DEBUG] <<< EXIT AwaitExpression (no parent statement found)`);
            //         return; // Should have a statement parent
            //     }

            //     const codeLine = getCodeLine(nodePath, state);
            //     const argument = nodePath.get('argument');

            //     let expressionName = '[await expression]';
            //     try {
            //         expressionName = argument.toString();
            //     } catch (e) {
            //         console.log(`[log-lines-plugin DEBUG] Error getting await argument string: ${e.message}`);
            //     }
            //     console.log(`[log-lines-plugin DEBUG] Await Expression Name: ${expressionName}`);

            //     const promiseId = nodePath.scope.generateUidIdentifier("awaitedPromise");

            //     // Declare variable: const awaitedPromise = ...argument...
            //     const promiseVarDecl = t.variableDeclaration('const', [
            //         t.variableDeclarator(promiseId, nodePath.node.argument)
            //     ]);
            //     promiseVarDecl._generated = true;

            //     // Log if serializable: if(_isSerializable(awaitedPromise)) _sendLog({ ..., type: 'async-await', name: expressionName, value: awaitedPromise, ... })
            //     const logStmt = t.ifStatement(
            //         t.callExpression(serializableCheckId, [promiseId]),
            //         createSendLogCall(state, nodePath, 'async-await', expressionName, promiseId, codeLine),
            //     );
            //     logStmt._generated = true;

            //     // Replace original argument: await awaitedPromise;
            //     nodePath.node.argument = t.identifier(promiseId.name);

            //     console.log(`[log-lines-plugin DEBUG] --- Attempting to insert await log before statement at line ${parentStmt.node.loc?.start?.line}`);
            //     try {
            //         // Insert before the statement containing the await
            //         parentStmt.insertBefore([promiseVarDecl, logStmt]);
            //         console.log(`[log-lines-plugin DEBUG] --- Successfully inserted await log`);
            //     } catch (e) {
            //         console.error(`[log-values-plugin] Error inserting await log: ${e.message} at ${state.file.opts.filename}:${parentStmt.node.loc?.start?.line}`);
            //     }
            //     console.log(`[log-lines-plugin DEBUG] <<< EXIT AwaitExpression (processed)`);
            // },

            // ALTERNATIVA: detect if next code LINE has await or .then ai manda log.tr 

            // CallExpression(nodePath, state) {
            //     // console.log(`[log-lines-plugin DEBUG] >>> ENTER CallExpression visitor  at line ${nodePath.node.loc?.start?.line}`);
            //     const codeLine = getCodeLine(nodePath, state);
            //     if (state.file.get('isLoggerModule')) {
            //         // console.log(`[log-lines-plugin DEBUG] --- Skip CallExpression (isLoggerModule)`);
            //         return; // Minor optimization: don't log skips for common visitors unless needed
            //     }
            //     if (!nodePath.node.loc) {
            //         console.log(`[log-lines-plugin DEBUG] --- Skip CallExpression (no loc) at ${codeLine}`);
            //         return;
            //     }
            //     if (nodePath.node._generated) {
            //         console.log(`[log-lines-plugin DEBUG] --- Skip CallExpression (_generated node) at ${codeLine}`);
            //         return;
            //     }
            //     if (isInsideLogCall(nodePath)) {
            //         console.log(`[log-lines-plugin DEBUG] --- Skip CallExpression (inside _sendLog) at ${codeLine}`);
            //         return;
            //     }

            //     const callee = nodePath.node.callee;
            //     if (!t.isMemberExpression(callee)) {
            //         console.log(`[log-lines-plugin DEBUG] --- Skip CallExpression (callee not MemberExpression) at ${codeLine}`);
            //         return; // Must be like promise.then()
            //     }

            //     const property = callee.property;
            //     if (!t.isIdentifier(property)) {
            //         console.log(`[log-lines-plugin DEBUG] --- Skip CallExpression (callee property not Identifier) at ${codeLine}`);
            //         return; // Property must be an identifier
            //     }

            //     const promiseMethods = ['then', 'catch', 'finally'];
            //     if (!promiseMethods.includes(property.name)) {
            //         console.log(`[log-lines-plugin DEBUG] --- Skip CallExpression (not a promise method: ${property.name}) at ${codeLine}   `);
            //         return; // Must be a promise method
            //     }

            //     console.log(`[log-lines-plugin DEBUG] --- Processing potential promise CallExpression (${property.name}) at line: ${nodePath.node.loc?.start?.line}`);

            //     // Find the parent statement to insert before
            //     const parentStmt = nodePath.getStatementParent();
            //     if (!parentStmt) {
            //         console.log(`[log-lines-plugin DEBUG] <<< EXIT CallExpression (no parent statement found for ${property.name}) at ${codeLine}`);
            //         return;
            //     }

            //     // const codeLine = getCodeLine(nodePath, state);
            //     const object = nodePath.get('callee.object');

            //     let objectName = '[promise object]';
            //     try {
            //         objectName = object.toString();
            //     } catch (e) {
            //         console.log(`[log-lines-plugin DEBUG] Error getting promise object string: ${e.message}`);
            //     }
            //     console.log(`[log-lines-plugin DEBUG] Promise Object Name: ${objectName}, Method: ${property.name}`);

            //     const promiseObjectId = nodePath.scope.generateUidIdentifier("promiseObject");

            //     // Declare variable: const promiseObject = ...original object...
            //     const promiseObjectVarDecl = t.variableDeclaration('const', [
            //         t.variableDeclarator(promiseObjectId, nodePath.node.callee.object)
            //     ]);
            //     promiseObjectVarDecl._generated = true;

            //     // Log before the call: if(_isSerializable(promiseObject)) _sendLog({ type: 'async-promise', name: objectName + '.' + property.name, value: promiseObject, ... })
            //     const logStmt = t.ifStatement(
            //         t.callExpression(serializableCheckId, [promiseObjectId]),
            //         createSendLogCall(state, nodePath, `async-${property.name}`, objectName, promiseObjectId, codeLine),
            //     );
            //     logStmt._generated = true;

            //     // Replace original object: promiseObject.then(...)
            //     nodePath.node.callee.object = t.identifier(promiseObjectId.name);

            //     console.log(`[log-lines-plugin DEBUG] --- Attempting to insert promise (${property.name}) log before statement at line ${parentStmt.node.loc?.start?.line}`);
            //     try {
            //         // Insert before the statement containing the call
            //         parentStmt.insertBefore([promiseObjectVarDecl, logStmt]);
            //         console.log(`[log-lines-plugin DEBUG] --- Successfully inserted promise (${property.name}) log`);
            //     } catch (e) {
            //         console.error(`[log-values-plugin] Error inserting promise call log: ${e.message} at ${state.file.opts.filename}:${parentStmt.node.loc?.start?.line}`);
            //     }
            //     console.log(`[log-lines-plugin DEBUG] <<< EXIT CallExpression (processed ${property.name})`);
            // }

            // --- ALTERNATIVE: Keyword Detection on Line (Likely Inaccurate) ---

            Statement: { // Visit generic statements first
                enter(nodePath, state) {
                    // Apply standard guards first
                    if (state.file.get('isLoggerModule') || !nodePath.node.loc || nodePath.node._generated || isInsideLogCall(nodePath)) {
                        return;
                    }
                    // Only process top-level statements or those within blocks for simplicity
                    if (!(nodePath.parentPath.isProgram() || nodePath.parentPath.isBlockStatement())) {
                        return;
                    }

                    const codeLine = getCodeLine(nodePath, state);
                    const lineNum = nodePath.node.loc.start.line;

                    let keywordFound = null;

                    // Check for keywords using regex (slightly better than plain includes)
                    if (/\bawait\b/.test(codeLine)) {
                        keywordFound = 'await';
                    } else if (/\.then\s*\(/.test(codeLine)) {
                        keywordFound = '.then';
                    }

                    if (keywordFound) {
                        console.log(`[log-lines-plugin DEBUG] Keyword '${keywordFound}' detected via text search on line ${lineNum}: "${codeLine}"`);

                        // --- Create the "start" log ---
                        const startLogPayloadValue = t.stringLiteral(`[Keyword '${keywordFound}' Start on Line ${lineNum}]`);
                        const startLogStmt = createSendLogCall(
                            state,
                            nodePath,
                            'async-keyword-detected', // Log type
                            keywordFound,
                            startLogPayloadValue,
                            codeLine
                        );
                        startLogStmt._generated = true;

                        // --- Create the "end" log (only for await) ---
                        let endLogStmt = null;
                        if (keywordFound === 'await') {
                            const endLogPayloadValue = t.stringLiteral(`[Keyword 'await' End on Line ${lineNum}]`);
                            endLogStmt = createSendLogCall(
                                state,
                                nodePath, // Location context remains the same statement
                                'async-keyword-detected-end', // New Log type
                                keywordFound, // Still 'await'
                                endLogPayloadValue,
                                codeLine
                            );
                            endLogStmt._generated = true;
                        }

                        try {
                            // Insert the "start" log call before the statement
                            nodePath.insertBefore(startLogStmt);
                            console.log(`[log-lines-plugin DEBUG] Inserted keyword '${keywordFound}' START log before statement on line ${lineNum}`);

                            // Insert the "end" log call after the statement (only if created)
                            if (endLogStmt) {
                                nodePath.insertAfter(endLogStmt);
                                console.log(`[log-lines-plugin DEBUG] Inserted keyword 'await' END log after statement on line ${lineNum}`);
                            }
                        } catch (e) {
                            console.error(`[log-values-plugin] Error inserting keyword detection log(s) for line ${lineNum}: ${e.message} in ${state.file.opts.filename}`);
                        }

                        // Important: Stop further processing of this node by other statement visitors
                        nodePath.skip();
                    }
                }
            },

            // --- Console Call Logging ---
            CallExpression(nodePath, state) {
                // Basic guards
                if (state.file.get('isLoggerModule') || !nodePath.node.loc || nodePath.node._generated || isInsideLogCall(nodePath)) {
                    return;
                }

                const callee = nodePath.get('callee');

                // Check if it's a console method call (e.g., console.log)
                if (callee.isMemberExpression()) {
                    const obj = callee.get('object');
                    const prop = callee.get('property');

                    if (obj.isIdentifier({ name: 'console' }) && prop.isIdentifier()) {
                        const consoleMethod = prop.node.name;
                        const supportedMethods = ['log', 'warn', 'error', 'info', 'debug'];

                        if (supportedMethods.includes(consoleMethod)) {
                            // Ensure this is a statement (e.g., console.log(...) and not part of another expression)
                            if (!nodePath.parentPath.isExpressionStatement()) {
                                return;
                            }

                            const lineNum = nodePath.node.loc.start.line;
                            const codeLine = getCodeLine(nodePath, state);
                            const args = nodePath.node.arguments;

                            console.log(`[log-lines-plugin DEBUG] console.${consoleMethod} call detected on line ${lineNum}: "${codeLine}"`);

                            // Create an AST node for the array of arguments
                            const argsArrayAst = t.arrayExpression(args);

                            // Create a temporary variable to hold the arguments array
                            const argsArrayVarId = nodePath.scope.generateUidIdentifier("consoleArgs");
                            const argsVarDecl = t.variableDeclaration('const', [
                                t.variableDeclarator(argsArrayVarId, argsArrayAst)
                            ]);
                            argsVarDecl._generated = true;

                            // Create the _sendLog call, checking if the args array is serializable
                            const logStmt = t.ifStatement(
                                t.callExpression(serializableCheckId, [argsArrayVarId]),
                                createSendLogCall(
                                    state,
                                    nodePath, // Use console call node for location
                                    `console-${consoleMethod}`,
                                    consoleMethod, // Name of the method
                                    argsArrayVarId, // Pass the variable holding the args array
                                    codeLine
                                ),
                                // Optional: Log a placeholder if args aren't serializable? 
                                // For console logs, maybe we don't log if not serializable to avoid noise.
                                null
                            );
                            logStmt._generated = true;

                            try {
                                // Insert the variable declaration and the log statement *before* the original console call statement
                                nodePath.parentPath.insertBefore([argsVarDecl, logStmt]);
                                console.log(`[log-lines-plugin DEBUG] Inserted _sendLog for console.${consoleMethod} on line ${lineNum}`);
                            } catch (e) {
                                console.error(`[log-values-plugin] Error inserting console log for ${consoleMethod} on line ${lineNum}: ${e.message} in ${state.file.opts.filename}`);
                            }

                            // We instrumented, don't let the generic Statement visitor process this line again
                            // if the console call line also happened to contain 'await' or '.then'
                            nodePath.parentPath.skip();
                        }
                    }
                }

                // --- Add General Call Result Logging AFTER console check ---

                // Check if the console handling already processed this node
                if (nodePath.node._handledByConsoleVisitor) return;

                // Skip if parent is ObjectProperty (it will be handled there if dynamic)
                if (nodePath.parentPath.isObjectProperty()) {
                    return;
                }

                // Avoid logging results for standalone calls where the result is unused
                if (nodePath.parentPath.isExpressionStatement()) {
                    return;
                }
                // Also avoid redundant logging if result assigned directly to var (handled by VarDecl/Assignment visitors)
                if (nodePath.parentPath.isVariableDeclarator() || nodePath.parentPath.isAssignmentExpression()) {
                    return;
                }
                // Skip if it's the _sendLog call itself or the isSerializable check
                if (nodePath.get("callee").isIdentifier({ name: "_sendLog" }) ||
                    nodePath.get("callee").isIdentifier({ name: serializableCheckId.name })) {
                    return;
                }

                // --- Instrument to log the result --- 
                const lineNum = nodePath.node.loc?.start.line;
                const codeLine = getCodeLine(nodePath, state);
                let funcName = '[unknown_call]';
                try {
                    funcName = nodePath.get('callee').toString();
                } catch (e) { /* ignore */ }

                console.log(`[log-lines-plugin DEBUG] Instrumenting call result for ${funcName} on line ${lineNum}: "${codeLine}"`);

                const callResultId = nodePath.scope.generateUidIdentifier("callResult");
                const originalCallNode = t.cloneNode(nodePath.node); // Clone the original call

                // Declare the temp variable before the statement using the result
                const resultVarDecl = t.variableDeclaration('const', [
                    t.variableDeclarator(callResultId, originalCallNode)
                ]);
                resultVarDecl._generated = true;

                // Create the log statement for the temp variable
                const logStmt = t.ifStatement(
                    t.callExpression(serializableCheckId, [callResultId]),
                    createSendLogCall(
                        state,
                        nodePath, // Use call node for location
                        'call-result', // New type
                        funcName,      // Name of the function called
                        callResultId,  // Log the result variable
                        codeLine
                    ),
                    null // Don't log if not serializable
                );
                logStmt._generated = true;

                try {
                    // Find the statement containing the call
                    const stmtParent = nodePath.getStatementParent();
                    if (stmtParent) {
                        // Insert variable declaration and log *before* the statement
                        stmtParent.insertBefore([resultVarDecl, logStmt]);

                        // Replace the original call expression with the variable identifier
                        nodePath.replaceWith(callResultId);

                        console.log(`[log-lines-plugin DEBUG] Inserted result log for ${funcName} on line ${lineNum}`);
                    } else {
                        console.warn(`[log-values-plugin] Could not find statement parent for call ${funcName} on line ${lineNum} to insert result log.`);
                    }
                } catch (e) {
                    console.error(`[log-values-plugin] Error instrumenting call result for ${funcName} on line ${lineNum}: ${e.message} in ${state.file.opts.filename}`);
                }
            },

            // --- UNCOMMENTED OBJECT PROPERTY VISITOR --- 
            // --- Object Property Value Logging ---
            ObjectProperty(nodePath, state) {
                // Basic guards
                if (state.file.get('isLoggerModule') || !nodePath.node.loc || !nodePath.parentPath.isObjectExpression() || nodePath.node._generated || isInsideLogCall(nodePath)) {
                    return;
                }

                // --- Check if inside a Font Loader Call that needs literals (Keep as safeguard) ---
                const objectExpression = nodePath.parentPath;
                const parentCallExpression = objectExpression.parentPath;
                if (parentCallExpression.isCallExpression()) {
                    const callee = parentCallExpression.get('callee');
                    const fontFunctionNames = ['Geist', 'Geist_Mono', 'Inter', 'Roboto']; // Expand as needed
                    if (callee.isIdentifier() && fontFunctionNames.includes(callee.node.name)) {
                        console.log(`[log-lines-plugin DEBUG] Skipping property instrumentation inside font call ${callee.node.name}`);
                        return; // Skip instrumentation for properties inside these calls
                    }
                }
                // --- End Font Loader Check ---

                const valuePath = nodePath.get('value');

                // --- NEW CHECK: Skip if value is statically analyzable literal structure ---
                if (isStaticLiteralStructure(valuePath)) {
                    console.log(`[log-lines-plugin DEBUG] Skipping static literal property value for key '${nodePath.get('key').toString()}'`);
                    return;
                }
                // --- END NEW CHECK ---

                // Also skip if it's just a function definition assigned to a property
                if (valuePath.isFunction()) {
                    return;
                }

                // --- Instrument the property value expression (only runs if not static literal) --- 
                const lineNum = nodePath.node.loc.start.line;
                const codeLine = getCodeLine(nodePath, state);
                const keyPath = nodePath.get('key');
                let propName = '[computed_property]';

                if (keyPath.isIdentifier()) {
                    propName = keyPath.node.name;
                } else if (keyPath.isLiteral()) { // Handle string/number keys
                    propName = String(keyPath.node.value);
                } // Could add more key types if needed

                console.log(`[log-lines-plugin DEBUG] Instrumenting property value for ${propName} on line ${lineNum}: "${codeLine}"`);

                const propValueId = nodePath.scope.generateUidIdentifier("propValue");
                const originalValueNode = t.cloneNode(nodePath.node.value); // Clone the original value expression

                // Declare the temp variable before the statement containing the object
                const valueVarDecl = t.variableDeclaration('const', [
                    t.variableDeclarator(propValueId, originalValueNode)
                ]);
                valueVarDecl._generated = true;

                // Create the log statement for the temp variable
                const logStmt = t.ifStatement(
                    t.callExpression(serializableCheckId, [propValueId]),
                    createSendLogCall(
                        state,
                        nodePath, // Use property node for location context
                        'property-value', // New type
                        propName,      // Name of the property
                        propValueId,   // Log the result variable
                        codeLine
                    ),
                    null // Don't log if not serializable
                );
                logStmt._generated = true;

                try {
                    // Find the statement containing the object literal
                    const stmtParent = nodePath.getStatementParent();
                    if (stmtParent) {
                        // Insert variable declaration and log *before* the statement
                        stmtParent.insertBefore([valueVarDecl, logStmt]);

                        // Replace the original property value expression with the variable identifier
                        valuePath.replaceWith(propValueId);

                        console.log(`[log-lines-plugin DEBUG] Inserted property value log for ${propName} on line ${lineNum}`);
                    } else {
                        console.warn(`[log-values-plugin] Could not find statement parent for property ${propName} on line ${lineNum} to insert value log.`);
                    }
                } catch (e) {
                    console.error(`[log-values-plugin] Error instrumenting property value for ${propName} on line ${lineNum}: ${e.message} in ${state.file.opts.filename}`);
                }
            }
            // --- END UNCOMMENTED OBJECT PROPERTY VISITOR --- 
        }
    };
}); 