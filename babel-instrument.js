#!/usr/bin/env node

// ! THIS WORKS WITH UNIVERSAL NODE APPLICATIONS. DIFFERENT THAN WITHBETTERDEBUG()
// THEY ARE SIMILAR.

/**
 * A robust line instrumenter using Babel's AST parsing
 * Requires these packages:
 * - @babel/core
 * - @babel/preset-typescript
 * - @babel/preset-env
 * - @babel/plugin-transform-typescript
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

// Keep track of processed files
const processedFiles = new Set();
const tempFiles = [];
const fileImports = new Map();

// Received logs storage
const receivedLogs = [];

// This script will work once the dependencies are installed
// You can install them with:
// npm install --save-dev @babel/core @babel/cli @babel/preset-typescript @babel/preset-env @babel/plugin-transform-typescript

// Function to create a Babel plugin for code instrumentation
function createInstrumentationPlugin(fileName, sourceLines) {
    return function instrumentationPlugin({ types: t }) {
        // Keep track of nodes that we've already processed to avoid recursion
        const processedNodes = new WeakSet();
        // Keep track of imports for this file
        const imports = [];

        // Helper function to create logger setup
        function createLoggerSetup() {
            return t.variableDeclaration('const', [
                t.variableDeclarator(
                    t.identifier('_sendLog'),
                    t.arrowFunctionExpression(
                        [t.identifier('message'), t.identifier('value'), t.identifier('logType')],
                        t.blockStatement([
                            // Add regex to extract file and line info
                            t.variableDeclaration('const', [
                                t.variableDeclarator(
                                    t.identifier('fileLineMatch'),
                                    t.callExpression(
                                        t.memberExpression(
                                            t.identifier('message'),
                                            t.identifier('match')
                                        ),
                                        [t.regExpLiteral('\\[(.*?):(\\d+)\\]')]
                                    )
                                )
                            ]),

                            // Extract the actual content/message part
                            t.variableDeclaration('const', [
                                t.variableDeclarator(
                                    t.identifier('contentMatch'),
                                    t.callExpression(
                                        t.memberExpression(
                                            t.identifier('message'),
                                            t.identifier('match')
                                        ),
                                        [t.regExpLiteral('\\]\\s+(.*?)\\s+=?\\s*$')]
                                    )
                                )
                            ]),

                            // Prepare structured data object
                            t.variableDeclaration('const', [
                                t.variableDeclarator(
                                    t.identifier('logData'),
                                    t.objectExpression([
                                        t.objectProperty(
                                            t.identifier('type'),
                                            t.stringLiteral('log')
                                        ),
                                        t.objectProperty(
                                            t.identifier('logType'),
                                            t.conditionalExpression(
                                                t.binaryExpression(
                                                    '===',
                                                    t.unaryExpression('typeof', t.identifier('logType')),
                                                    t.stringLiteral('string')
                                                ),
                                                t.identifier('logType'),
                                                t.stringLiteral('value')
                                            )
                                        ),
                                        t.objectProperty(
                                            t.identifier('rawMessage'),
                                            t.identifier('message')
                                        ),
                                        t.objectProperty(
                                            t.identifier('value'),
                                            t.identifier('value')
                                        ),
                                        t.objectProperty(
                                            t.identifier('file'),
                                            t.conditionalExpression(
                                                t.logicalExpression(
                                                    '&&',
                                                    t.identifier('fileLineMatch'),
                                                    t.memberExpression(
                                                        t.identifier('fileLineMatch'),
                                                        t.numericLiteral(1),
                                                        true
                                                    )
                                                ),
                                                t.memberExpression(
                                                    t.identifier('fileLineMatch'),
                                                    t.numericLiteral(1),
                                                    true
                                                ),
                                                t.stringLiteral('unknown')
                                            )
                                        ),
                                        t.objectProperty(
                                            t.identifier('line'),
                                            t.conditionalExpression(
                                                t.logicalExpression(
                                                    '&&',
                                                    t.identifier('fileLineMatch'),
                                                    t.memberExpression(
                                                        t.identifier('fileLineMatch'),
                                                        t.numericLiteral(2),
                                                        true
                                                    )
                                                ),
                                                t.callExpression(
                                                    t.identifier('parseInt'),
                                                    [
                                                        t.memberExpression(
                                                            t.identifier('fileLineMatch'),
                                                            t.numericLiteral(2),
                                                            true
                                                        ),
                                                        t.numericLiteral(10)
                                                    ]
                                                ),
                                                t.numericLiteral(0)
                                            )
                                        ),
                                        t.objectProperty(
                                            t.identifier('content'),
                                            t.conditionalExpression(
                                                t.logicalExpression(
                                                    '&&',
                                                    t.identifier('contentMatch'),
                                                    t.memberExpression(
                                                        t.identifier('contentMatch'),
                                                        t.numericLiteral(1),
                                                        true
                                                    )
                                                ),
                                                t.memberExpression(
                                                    t.identifier('contentMatch'),
                                                    t.numericLiteral(1),
                                                    true
                                                ),
                                                t.stringLiteral('')
                                            )
                                        ),
                                        t.objectProperty(
                                            t.identifier('timestamp'),
                                            t.newExpression(
                                                t.identifier('Date'),
                                                []
                                            )
                                        )
                                    ])
                                )
                            ]),

                            // Create try/catch to handle errors gracefully
                            t.tryStatement(
                                t.blockStatement([
                                    // if (process && typeof process.send === 'function')
                                    t.ifStatement(
                                        t.logicalExpression(
                                            '&&',
                                            t.identifier('process'),
                                            t.binaryExpression(
                                                '===',
                                                t.unaryExpression('typeof', t.memberExpression(t.identifier('process'), t.identifier('send'))),
                                                t.stringLiteral('function')
                                            )
                                        ),
                                        // process.send(logData)
                                        t.blockStatement([
                                            t.expressionStatement(
                                                t.callExpression(
                                                    t.memberExpression(t.identifier('process'), t.identifier('send')),
                                                    [t.identifier('logData')]
                                                )
                                            )
                                        ]),
                                        // Fallback to console.log with structured data
                                        t.blockStatement([
                                            t.expressionStatement(
                                                t.callExpression(
                                                    t.memberExpression(t.identifier('console'), t.identifier('log')),
                                                    [
                                                        t.callExpression(
                                                            t.memberExpression(t.identifier('JSON'), t.identifier('stringify')),
                                                            [t.identifier('logData'), t.nullLiteral(), t.numericLiteral(2)]
                                                        )
                                                    ]
                                                )
                                            )
                                        ])
                                    )
                                ]),
                                t.catchClause(
                                    t.identifier('e'),
                                    t.blockStatement([
                                        t.expressionStatement(
                                            t.callExpression(
                                                t.memberExpression(t.identifier('console'), t.identifier('error')),
                                                [t.stringLiteral('Error in log sending:'), t.identifier('e')]
                                            )
                                        )
                                    ])
                                )
                            )
                        ])
                    )
                )
            ]);
        }

        // Helper function to create a serializable check function as AST
        function createSerializableCheckFunction(path) {
            const serializableCheckId = path.scope.generateUidIdentifier('isSerializable');
            const serializableCheckDecl = t.variableDeclaration('const', [
                t.variableDeclarator(
                    serializableCheckId,
                    t.functionExpression(
                        null,
                        [t.identifier('v')],
                        t.blockStatement([
                            // if (v === null || v === undefined) return true;
                            t.ifStatement(
                                t.binaryExpression(
                                    '===',
                                    t.identifier('v'),
                                    t.nullLiteral()
                                ),
                                t.returnStatement(t.booleanLiteral(true))
                            ),
                            t.ifStatement(
                                t.binaryExpression(
                                    '===',
                                    t.identifier('v'),
                                    t.identifier('undefined')
                                ),
                                t.returnStatement(t.booleanLiteral(true))
                            ),
                            // if (typeof v === 'function') return false;
                            t.ifStatement(
                                t.binaryExpression(
                                    '===',
                                    t.unaryExpression('typeof', t.identifier('v')),
                                    t.stringLiteral('function')
                                ),
                                t.returnStatement(t.booleanLiteral(false))
                            ),
                            // Simple primitive type check for strings
                            t.ifStatement(
                                t.binaryExpression(
                                    '===',
                                    t.unaryExpression('typeof', t.identifier('v')),
                                    t.stringLiteral('string')
                                ),
                                t.returnStatement(t.booleanLiteral(true))
                            ),
                            // Simple primitive type check for numbers
                            t.ifStatement(
                                t.binaryExpression(
                                    '===',
                                    t.unaryExpression('typeof', t.identifier('v')),
                                    t.stringLiteral('number')
                                ),
                                t.returnStatement(t.booleanLiteral(true))
                            ),
                            // Simple primitive type check for booleans
                            t.ifStatement(
                                t.binaryExpression(
                                    '===',
                                    t.unaryExpression('typeof', t.identifier('v')),
                                    t.stringLiteral('boolean')
                                ),
                                t.returnStatement(t.booleanLiteral(true))
                            ),
                            // Try JSON.stringify
                            t.tryStatement(
                                t.blockStatement([
                                    t.expressionStatement(
                                        t.callExpression(
                                            t.memberExpression(t.identifier('JSON'), t.identifier('stringify')),
                                            [t.identifier('v')]
                                        )
                                    ),
                                    t.returnStatement(t.booleanLiteral(true))
                                ]),
                                t.catchClause(
                                    t.identifier('e'),
                                    t.blockStatement([
                                        t.returnStatement(t.booleanLiteral(false))
                                    ])
                                )
                            )
                        ])
                    )
                )
            ]);

            return { serializableCheckId, serializableCheckDecl };
        }

        return {
            name: "babel-instrument",

            pre(state) {
                fileImports.set(state.opts.filename, []);
            },

            visitor: {
                // Import declarations - track them for processing
                ImportDeclaration(path, state) {
                    const importPath = path.node.source.value;

                    // Skip non-relative imports (node_modules)
                    if (!importPath.startsWith('.')) {
                        return;
                    }

                    // Store import path for later processing
                    fileImports.get(state.opts.filename).push(importPath);

                    // Rewrite import to point to instrumented version
                    // Simple string manipulation instead of using path functions
                    let instrumentedPath = importPath;
                    const lastDotIndex = importPath.lastIndexOf('.');

                    if (lastDotIndex > 0 && lastDotIndex > importPath.lastIndexOf('/')) {
                        // Has extension
                        instrumentedPath = importPath.substring(0, lastDotIndex) + '.instrumented';
                    } else {
                        // No extension
                        instrumentedPath = importPath + '.instrumented';
                    }

                    path.node.source.value = instrumentedPath;

                    // Don't add logging for imports as requested
                },

                // Helper function to safely get line number
                Program: {
                    enter(path) {
                        // Add a global helper function to get line numbers safely
                        global.getLineNumber = (path) => {
                            if (!path || !path.node || !path.node.loc || !path.node.loc.start) {
                                return 'unknown';
                            }
                            return path.node.loc.start.line;
                        };

                        // Add our logger function to the top of the file
                        path.unshiftContainer('body', createLoggerSetup());
                    }
                },

                // Handle variable declarations (let, const, var)
                VariableDeclaration(path) {
                    // Skip nodes without location info or already processed nodes
                    if (!path.node.loc || !path.node.loc.start || processedNodes.has(path.node)) return;
                    processedNodes.add(path.node);

                    const lineNumber = path.node.loc.start.line;
                    const lineContent = sourceLines[lineNumber - 1] ? sourceLines[lineNumber - 1].trim() : '';

                    // Skip import-related variable declarations (typically at the top of files)
                    if (lineContent.startsWith('import ') || path.node.leadingComments?.some(c => c.value.includes('import'))) {
                        return;
                    }

                    // Process only top-level declarations for simplicity
                    if (path.parent.type !== 'Program' &&
                        path.parent.type !== 'BlockStatement' &&
                        path.parent.type !== 'ExportNamedDeclaration') {
                        return;
                    }

                    // Each variable declaration can have multiple declarators
                    path.node.declarations.forEach(declarator => {
                        if (declarator.init && declarator.id.type === 'Identifier') {
                            const varName = declarator.id.name;

                            // Skip logging if the value is a function or import-related
                            if (declarator.init.type === 'ArrowFunctionExpression' ||
                                declarator.init.type === 'FunctionExpression' ||
                                varName.startsWith('_') && /^[A-Za-z]+$/.test(varName.slice(1))) { // Common pattern for import variables
                                return;
                            }

                            // Create a log statement using our custom logger
                            const logStatement = t.expressionStatement(
                                t.callExpression(
                                    t.identifier('_sendLog'),
                                    [
                                        t.stringLiteral(`[${fileName}:${lineNumber}] ${lineContent} => ${varName} = `),
                                        t.identifier(varName),
                                        t.stringLiteral('variable')
                                    ]
                                )
                            );

                            // Insert the log after the variable declaration
                            path.insertAfter(logStatement);
                        }
                    });
                },

                // Handle if statements
                IfStatement(path) {
                    // Skip nodes without location info or already processed nodes
                    if (!path.node.loc || !path.node.loc.start || processedNodes.has(path.node)) return;
                    processedNodes.add(path.node);

                    // Skip deeply nested if statements to avoid recursion issues
                    let parent = path.parentPath;
                    let depth = 0;

                    while (parent && depth < 4) {
                        if (parent.type === 'IfStatement') {
                            depth++;
                        }
                        parent = parent.parentPath;
                    }

                    if (depth >= 3) return; // Skip if too deeply nested

                    const lineNumber = path.node.loc.start.line;
                    const lineContent = sourceLines[lineNumber - 1] ? sourceLines[lineNumber - 1].trim() : '';
                    let testCode;

                    try {
                        testCode = path.get('test').toString();
                    } catch (e) {
                        testCode = 'condition';
                    }

                    // Create a new variable to hold the condition result
                    const conditionId = path.scope.generateUidIdentifier('condition');

                    // Create variable declaration for the condition
                    const condVarDecl = t.variableDeclaration('const', [
                        t.variableDeclarator(conditionId, path.node.test)
                    ]);

                    // Use _sendLog instead of console.log
                    const conditionLogStmt = t.expressionStatement(
                        t.callExpression(
                            t.identifier('_sendLog'),
                            [
                                t.stringLiteral(`[${fileName}:${lineNumber}] ${lineContent} => ${testCode} = `),
                                conditionId, // Direct reference to the identifier, not a string concatenation
                                t.stringLiteral('condition')
                            ]
                        )
                    );

                    // Insert the statements
                    path.insertBefore([condVarDecl, conditionLogStmt]);

                    // Replace the test with our stored condition
                    path.node.test = conditionId;
                },

                // Handle function calls
                CallExpression(path, state) {
                    // Skip nodes without location info or already processed nodes
                    if (!path.node.loc || !path.node.loc.start || processedNodes.has(path.node)) return;
                    processedNodes.add(path.node);

                    const callee = path.node.callee;

                    // Skip console.log calls to avoid infinite recursion 
                    if (callee.type === 'MemberExpression' &&
                        callee.object && callee.object.name === 'console' &&
                        callee.property && (callee.property.name === 'log' || callee.property.name === 'error' || callee.property.name === 'warn')) {
                        return;
                    }

                    // Skip _sendLog calls to avoid recursion
                    if (callee.type === 'Identifier' && callee.name === '_sendLog') {
                        return;
                    }

                    // Skip process.send calls
                    if (callee.type === 'MemberExpression' &&
                        callee.object && callee.object.name === 'process' &&
                        callee.property && callee.property.name === 'send') {
                        return;
                    }

                    const lineNumber = path.node.loc.start.line;
                    const lineContent = sourceLines[lineNumber - 1] ? sourceLines[lineNumber - 1].trim() : '';

                    // Get function name
                    let funcName;
                    if (t.isIdentifier(callee)) {
                        funcName = callee.name;
                    } else if (t.isMemberExpression(callee)) {
                        try {
                            funcName = path.get('callee').toString();
                        } catch (e) {
                            funcName = 'method';
                        }
                    } else {
                        funcName = 'anonymous';
                    }

                    // Skip function calls in unsupported contexts
                    if (path.parent &&
                        (path.parent.type === 'MemberExpression' ||
                            path.parent.type === 'LogicalExpression' ||
                            path.parent.type === 'BinaryExpression' ||
                            path.parent.type === 'AssignmentExpression' ||
                            path.parent.type === 'ObjectProperty')) {
                        console.warn(`Skipping function call at ${fileName}:${lineNumber} in ${path.parent.type} context`);
                        return;
                    }

                    // Only create log statements if there are arguments
                    if (path.node.arguments.length === 0) {
                        return;
                    }

                    // Only proceed if we can properly instrument this call
                    let shouldAddLogs = true;

                    // Try to get parent type to avoid problematic contexts
                    try {
                        const parentType = path.parent.type;
                        if (parentType &&
                            parentType !== 'ExpressionStatement' &&
                            parentType !== 'VariableDeclarator') {
                            console.warn(`Skipping function call at ${fileName}:${lineNumber} - unsupported parent type ${parentType}`);
                            shouldAddLogs = false;
                        }
                    } catch (e) {
                        // If we can't determine the parent type, skip the logs
                        shouldAddLogs = false;
                    }

                    // Create temporary variables to capture argument values
                    const argVars = [];
                    const newArgs = [];

                    // For each argument, create a temporary variable
                    path.node.arguments.forEach((arg, index) => {
                        const argId = path.scope.generateUidIdentifier(`arg${index}`);
                        argVars.push(
                            t.variableDeclarator(argId, arg)
                        );
                        newArgs.push(argId);
                    });

                    // Create the variable declaration for all arguments
                    const argDeclaration = t.variableDeclaration('const', argVars);

                    // Replace original arguments with our temporary variables
                    path.node.arguments = newArgs;

                    // Only add logs if we determined it's safe to do so
                    if (shouldAddLogs) {
                        // Get the serializable check function
                        const { serializableCheckId, serializableCheckDecl } = createSerializableCheckFunction(path);

                        // Create counter to track non-serializable arguments
                        const counterVarId = path.scope.generateUidIdentifier('nonSerializableCount');
                        const counterDecl = t.variableDeclaration('let', [
                            t.variableDeclarator(
                                counterVarId,
                                t.numericLiteral(0)
                            )
                        ]);

                        // Create array for serializable parameters
                        const filteredArrayId = path.scope.generateUidIdentifier('filteredParams');
                        const filteredArrayDecl = t.variableDeclaration('const', [
                            t.variableDeclarator(
                                filteredArrayId,
                                t.callExpression(
                                    t.memberExpression(
                                        t.arrayExpression(newArgs),
                                        t.identifier('map')
                                    ),
                                    [
                                        t.arrowFunctionExpression(
                                            [t.identifier('p')],
                                            t.blockStatement([
                                                t.ifStatement(
                                                    t.unaryExpression(
                                                        '!',
                                                        t.callExpression(serializableCheckId, [t.identifier('p')])
                                                    ),
                                                    t.expressionStatement(
                                                        t.updateExpression(
                                                            '++',
                                                            counterVarId,
                                                            false
                                                        )
                                                    )
                                                ),
                                                t.returnStatement(
                                                    t.conditionalExpression(
                                                        t.callExpression(serializableCheckId, [t.identifier('p')]),
                                                        t.identifier('p'),
                                                        t.stringLiteral('[Not Serializable]')
                                                    )
                                                )
                                            ])
                                        )
                                    ]
                                )
                            )
                        ]);

                        // Create the conditional log statement that only logs if not all params are non-serializable
                        const conditionalLogStatement = t.ifStatement(
                            t.binaryExpression(
                                '<',
                                counterVarId,
                                t.memberExpression(
                                    filteredArrayId,
                                    t.identifier('length')
                                )
                            ),
                            t.expressionStatement(
                                t.callExpression(
                                    t.identifier('_sendLog'),
                                    [
                                        t.stringLiteral(`[${fileName}:${lineNumber}] Call to ${funcName} with parameters:`),
                                        filteredArrayId,
                                        t.stringLiteral('function_call')
                                    ]
                                )
                            )
                        );

                        // Insert the declarations and log before the function call
                        try {
                            if (path.parentPath && path.parentPath.isExpressionStatement()) {
                                path.parentPath.insertBefore(serializableCheckDecl);
                                path.parentPath.insertBefore(argDeclaration);
                                path.parentPath.insertBefore(counterDecl);
                                path.parentPath.insertBefore(filteredArrayDecl);
                                path.parentPath.insertBefore(conditionalLogStatement);
                            } else if (path.parent && path.parent.type === 'VariableDeclarator') {
                                // For variable declarations like: const result = func(args)
                                path.parentPath.parentPath.insertBefore(serializableCheckDecl);
                                path.parentPath.parentPath.insertBefore(argDeclaration);
                                path.parentPath.parentPath.insertBefore(counterDecl);
                                path.parentPath.parentPath.insertBefore(filteredArrayDecl);
                                path.parentPath.parentPath.insertBefore(conditionalLogStatement);
                            }
                        } catch (e) {
                            console.warn(`Error instrumenting function call at ${fileName}:${lineNumber}: ${e.message}`);
                        }
                    } else {
                        // Just insert the arg declaration
                        try {
                            if (path.parentPath && path.parentPath.isExpressionStatement()) {
                                path.parentPath.insertBefore(argDeclaration);
                            } else if (path.parent && path.parent.type === 'VariableDeclarator') {
                                path.parentPath.parentPath.insertBefore(argDeclaration);
                            }
                        } catch (e) {
                            console.warn(`Error instrumenting function call at ${fileName}:${lineNumber}: ${e.message}`);
                        }
                    }
                },

                // Handle return statements
                ReturnStatement(path) {
                    // Skip nodes without location info or already processed nodes
                    if (!path.node.loc || !path.node.loc.start || processedNodes.has(path.node)) return;
                    processedNodes.add(path.node);

                    const lineNumber = path.node.loc.start.line;
                    const lineContent = sourceLines[lineNumber - 1] ? sourceLines[lineNumber - 1].trim() : '';

                    // Only process returns with arguments
                    if (path.node.argument) {
                        // Create a unique variable name for the return value
                        const returnId = path.scope.generateUidIdentifier('returnValue');

                        // Create a variable declaration for the return value
                        const returnVarDecl = t.variableDeclaration('const', [
                            t.variableDeclarator(returnId, path.node.argument)
                        ]);

                        // Use _sendLog instead of console.log for function calls
                        const returnLogStmt = t.expressionStatement(
                            t.callExpression(
                                t.identifier('_sendLog'),
                                [
                                    t.stringLiteral(`[${fileName}:${lineNumber}] ${lineContent} => Return value: `),
                                    returnId, // Direct reference to the identifier 
                                    t.stringLiteral('return')
                                ]
                            )
                        );

                        // Insert the statements
                        path.insertBefore([returnVarDecl, returnLogStmt]);

                        // Replace the return argument with our stored value
                        path.node.argument = returnId;
                    }
                },

                // Handle assignments
                AssignmentExpression(path) {
                    // Skip nodes without location info or already processed nodes
                    if (!path.node.loc || !path.node.loc.start || processedNodes.has(path.node)) return;
                    processedNodes.add(path.node);

                    // Skip if not in a statement context
                    if (!path.parentPath || !path.parentPath.isStatement()) {
                        return;
                    }

                    const lineNumber = path.node.loc.start.line;
                    const lineContent = sourceLines[lineNumber - 1] ? sourceLines[lineNumber - 1].trim() : '';
                    let varName;

                    // Get the name of the variable being assigned
                    if (t.isIdentifier(path.node.left)) {
                        varName = path.node.left.name;
                    } else if (t.isMemberExpression(path.node.left) && t.isIdentifier(path.node.left.object)) {
                        try {
                            varName = path.get('left').toString();
                        } catch (e) {
                            varName = 'property';
                        }
                    } else {
                        return; // Skip complex assignments
                    }

                    // Use _sendLog instead of console.log for function calls
                    const assignmentLogStmt = t.expressionStatement(
                        t.callExpression(
                            t.identifier('_sendLog'),
                            [
                                t.stringLiteral(`[${fileName}:${lineNumber}] ${lineContent} => Updated value of ${varName}: `),
                                path.node.left, // Direct reference to the left side identifier
                                t.stringLiteral('assignment')
                            ]
                        )
                    );

                    // Insert the log after the assignment
                    try {
                        if (path.parentPath && path.parentPath.isExpressionStatement()) {
                            path.parentPath.insertAfter(assignmentLogStmt);
                        } else {
                            path.insertAfter(assignmentLogStmt);
                        }
                    } catch (e) {
                        // If we can't insert after, just skip this node
                        console.warn(`Couldn't instrument assignment at ${fileName}:${lineNumber}`);
                    }
                },

                // Handle function declarations to log parameters when called
                FunctionDeclaration(path) {
                    // Skip nodes without location info or already processed nodes
                    if (!path.node.loc || !path.node.loc.start || processedNodes.has(path.node)) return;
                    processedNodes.add(path.node);

                    const lineNumber = path.node.loc.start.line;
                    const funcName = path.node.id ? path.node.id.name : 'anonymous';
                    const lineContent = sourceLines[lineNumber - 1] ? sourceLines[lineNumber - 1].trim() : '';

                    // Only instrument if the function has parameters
                    if (path.node.params.length === 0) {
                        return;
                    }

                    // Get the serializable check function
                    const { serializableCheckId, serializableCheckDecl } = createSerializableCheckFunction(path);

                    // Create log statements for each parameter
                    const logStatements = [serializableCheckDecl];
                    path.node.params.forEach((param, index) => {
                        // Only handle simple identifiers for now
                        if (t.isIdentifier(param)) {
                            const paramName = param.name;
                            // Create a conditional log that only logs if value is serializable
                            const conditionalLog = t.ifStatement(
                                t.callExpression(serializableCheckId, [t.identifier(paramName)]),
                                t.expressionStatement(
                                    t.callExpression(
                                        t.identifier('_sendLog'),
                                        [
                                            t.stringLiteral(`[${fileName}:${lineNumber}] Function ${funcName} param[${index}] ${paramName} = `),
                                            t.identifier(paramName),
                                            t.stringLiteral('parameter')
                                        ]
                                    )
                                )
                            );

                            logStatements.push(conditionalLog);
                        } else if (t.isObjectPattern(param)) {
                            // For object destructuring, log a placeholder
                            logStatements.push(
                                t.expressionStatement(
                                    t.callExpression(
                                        t.identifier('_sendLog'),
                                        [
                                            t.stringLiteral(`[${fileName}:${lineNumber}] Function ${funcName} param[${index}] (destructured object)`),
                                            t.nullLiteral(),
                                            t.stringLiteral('parameter_destructured')
                                        ]
                                    )
                                )
                            );
                        } else if (t.isArrayPattern(param)) {
                            // For array destructuring, log a placeholder
                            logStatements.push(
                                t.expressionStatement(
                                    t.callExpression(
                                        t.identifier('_sendLog'),
                                        [
                                            t.stringLiteral(`[${fileName}:${lineNumber}] Function ${funcName} param[${index}] (destructured array)`),
                                            t.nullLiteral(),
                                            t.stringLiteral('parameter_destructured')
                                        ]
                                    )
                                )
                            );
                        }
                    });

                    // Add the log statements at the beginning of the function body
                    if (logStatements.length > 0) {
                        const body = path.get('body');
                        if (body && t.isBlockStatement(body.node)) {
                            body.unshiftContainer('body', logStatements);
                        }
                    }
                },

                // Handle arrow functions
                ArrowFunctionExpression(path) {
                    // Skip nodes without location info or already processed nodes
                    if (!path.node.loc || !path.node.loc.start || processedNodes.has(path.node)) return;
                    processedNodes.add(path.node);

                    const lineNumber = path.node.loc.start.line;
                    const lineContent = sourceLines[lineNumber - 1] ? sourceLines[lineNumber - 1].trim() : '';

                    // Only instrument if the function has parameters and a block body
                    if (path.node.params.length === 0 || !t.isBlockStatement(path.node.body)) {
                        return;
                    }

                    // Get the serializable check function
                    const { serializableCheckId, serializableCheckDecl } = createSerializableCheckFunction(path);

                    // Create log statements for each parameter
                    const logStatements = [serializableCheckDecl];
                    path.node.params.forEach((param, index) => {
                        // Only handle simple identifiers for now
                        if (t.isIdentifier(param)) {
                            const paramName = param.name;
                            // Create a conditional log that only logs if value is serializable
                            const conditionalLog = t.ifStatement(
                                t.callExpression(serializableCheckId, [t.identifier(paramName)]),
                                t.expressionStatement(
                                    t.callExpression(
                                        t.identifier('_sendLog'),
                                        [
                                            t.stringLiteral(`[${fileName}:${lineNumber}] Arrow function param[${index}] ${paramName} = `),
                                            t.identifier(paramName),
                                            t.stringLiteral('parameter')
                                        ]
                                    )
                                )
                            );

                            logStatements.push(conditionalLog);
                        } else if (t.isObjectPattern(param) || t.isArrayPattern(param)) {
                            // For destructuring, create a generic log
                            logStatements.push(
                                t.expressionStatement(
                                    t.callExpression(
                                        t.identifier('_sendLog'),
                                        [
                                            t.stringLiteral(`[${fileName}:${lineNumber}] Arrow function param[${index}] (destructured)`),
                                            t.nullLiteral(),
                                            t.stringLiteral('parameter_destructured')
                                        ]
                                    )
                                )
                            );
                        }
                    });

                    // Add the log statements at the beginning of the function body
                    if (logStatements.length > 0) {
                        const body = path.get('body');
                        if (body && t.isBlockStatement(body.node)) {
                            body.unshiftContainer('body', logStatements);
                        }
                    }
                },

                // Handle function expressions and method definitions
                FunctionExpression(path) {
                    // Skip nodes without location info or already processed nodes
                    if (!path.node.loc || !path.node.loc.start || processedNodes.has(path.node)) return;
                    processedNodes.add(path.node);

                    const lineNumber = path.node.loc.start.line;
                    let funcName = 'anonymous';

                    // Try to get the function name
                    if (path.node.id && path.node.id.name) {
                        funcName = path.node.id.name;
                    } else if (path.parent && path.parent.key && path.parent.key.name) {
                        funcName = path.parent.key.name; // For method definitions
                    } else if (path.parent && path.parent.id && path.parent.id.name) {
                        funcName = path.parent.id.name; // For variable declarations
                    }

                    const lineContent = sourceLines[lineNumber - 1] ? sourceLines[lineNumber - 1].trim() : '';

                    // Only instrument if the function has parameters
                    if (path.node.params.length === 0) {
                        return;
                    }

                    // Get the serializable check function
                    const { serializableCheckId, serializableCheckDecl } = createSerializableCheckFunction(path);

                    // Create log statements for each parameter
                    const logStatements = [serializableCheckDecl];
                    path.node.params.forEach((param, index) => {
                        // Only handle simple identifiers for now
                        if (t.isIdentifier(param)) {
                            const paramName = param.name;
                            // Create a conditional log that only logs if value is serializable
                            const conditionalLog = t.ifStatement(
                                t.callExpression(serializableCheckId, [t.identifier(paramName)]),
                                t.expressionStatement(
                                    t.callExpression(
                                        t.identifier('_sendLog'),
                                        [
                                            t.stringLiteral(`[${fileName}:${lineNumber}] Function ${funcName} param[${index}] ${paramName} = `),
                                            t.identifier(paramName),
                                            t.stringLiteral('parameter')
                                        ]
                                    )
                                )
                            );

                            logStatements.push(conditionalLog);
                        } else if (t.isObjectPattern(param) || t.isArrayPattern(param)) {
                            // For destructuring, create a generic log
                            logStatements.push(
                                t.expressionStatement(
                                    t.callExpression(
                                        t.identifier('_sendLog'),
                                        [
                                            t.stringLiteral(`[${fileName}:${lineNumber}] Function ${funcName} param[${index}] (destructured)`),
                                            t.nullLiteral(),
                                            t.stringLiteral('parameter_destructured')
                                        ]
                                    )
                                )
                            );
                        }
                    });

                    // Add the log statements at the beginning of the function body
                    if (logStatements.length > 0) {
                        const body = path.get('body');
                        if (body && t.isBlockStatement(body.node)) {
                            body.unshiftContainer('body', logStatements);
                        }
                    }
                }
            }
        };
    };
}

// Function to resolve import paths
function resolveImportPath(importPath, baseDir) {
    // Try with different extensions and paths
    const possiblePaths = [
        path.join(baseDir, importPath),
        path.join(baseDir, `${importPath}.ts`),
        path.join(baseDir, `${importPath}.js`),
        path.join(baseDir, importPath, 'index.ts'),
        path.join(baseDir, importPath, 'index.js')
    ];

    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            return p;
        }
    }

    return null;
}

// Process a single file and return any imports it contains
async function processFile(filePath, babel) {
    // Skip if already processed or from node_modules
    const absolutePath = path.resolve(filePath);
    if (processedFiles.has(absolutePath) || absolutePath.includes('node_modules')) {
        return [];
    }

    console.log(`Instrumenting file: ${filePath}`);
    processedFiles.add(absolutePath);

    // Read the original file
    const originalCode = fs.readFileSync(filePath, 'utf8');
    const sourceLines = originalCode.split('\n');
    const fileName = path.basename(filePath);
    const baseDir = path.dirname(filePath);

    // Create instrumentation plugin
    const instrumentationPlugin = createInstrumentationPlugin(fileName, sourceLines);

    // Transform with Babel
    const result = await babel.transformAsync(originalCode, {
        filename: absolutePath,
        presets: [
            '@babel/preset-typescript',
            ['@babel/preset-env', { targets: { node: 'current' } }]
        ],
        plugins: [
            [instrumentationPlugin, { filename: absolutePath }],
            '@babel/plugin-transform-typescript'
        ],
        ast: true,
        sourceMaps: true,
        comments: true,
        parserOpts: {
            tokens: true,
            locations: true
        }
    });

    // Create instrumented file
    const ext = path.extname(filePath);
    const outExt = '.js';
    const tempFileName = `${path.basename(filePath, ext)}.instrumented${outExt}`;
    const tempFilePath = path.join(baseDir, tempFileName);

    fs.writeFileSync(tempFilePath, result.code, 'utf8');
    tempFiles.push(tempFilePath);
    console.log(`Created instrumented file: ${tempFilePath}`);

    // Return any imports found in this file
    return fileImports.get(absolutePath) || [];
}

// Clean up temporary files
function cleanupTempFiles() {
    for (const file of tempFiles) {
        if (fs.existsSync(file)) {
            fs.unlinkSync(file);
            console.log(`Removed temporary file: ${file}`);
        }
    }
}

// Main function to run the instrumentation
async function runInstrumentation() {
    try {
        const babel = require('@babel/core');
        const args = process.argv.slice(2);

        if (args.length === 0) {
            console.error('Please provide a file to instrument.');
            process.exit(1);
        }

        const filePath = args[0];

        // Make sure the file exists
        if (!fs.existsSync(filePath)) {
            console.error(`File not found: ${filePath}`);
            process.exit(1);
        }

        // Process the main file and collect its imports
        const absoluteFilePath = path.resolve(filePath);
        const baseDir = path.dirname(absoluteFilePath);
        const imports = await processFile(absoluteFilePath, babel);

        // Process all imports recursively
        const pendingImports = [...imports];
        while (pendingImports.length > 0) {
            const importPath = pendingImports.shift();
            const resolvedPath = resolveImportPath(importPath, baseDir);

            if (resolvedPath) {
                const newImports = await processFile(resolvedPath, babel);
                pendingImports.push(...newImports);
            } else {
                console.warn(`Could not resolve import: ${importPath}`);
            }
        }

        // Get the path to the instrumented main file
        const ext = path.extname(filePath);
        const tempFileName = `${path.basename(filePath, ext)}.instrumented.js`;
        const instrumentedFilePath = path.join(path.dirname(filePath), tempFileName);

        if (!fs.existsSync(instrumentedFilePath)) {
            console.error('Failed to instrument the file.');
            process.exit(1);
        }

        console.log(`\nRunning instrumented file...`);
        // Set up the child process with IPC enabled
        const nodeProcess = spawn('node', [instrumentedFilePath], {
            stdio: ['inherit', 'pipe', 'pipe', 'ipc'] // Pipe stderr and stdout instead of inheriting
        });

        // Buffer to collect stderr output
        let stderrOutput = '';
        let stdoutOutput = '';

        // Capture and display stdout in real time
        nodeProcess.stdout.on('data', (data) => {
            const output = data.toString();
            stdoutOutput += output;
            process.stdout.write(output);
        });

        // Capture stderr in real time and store it
        nodeProcess.stderr.on('data', (data) => {
            const output = data.toString();
            stderrOutput += output;
            process.stderr.write(output);
        });

        console.log(`Process started with PID: ${nodeProcess.pid}`);
        console.log('Press Ctrl+C to stop the process and clean up temporary files.');

        // Handle log messages from the child process
        nodeProcess.on('message', (msg) => {
            if (msg && msg.type === 'log') {
                receivedLogs.push(msg);
                console.log(msg);
            }
        });

        nodeProcess.on('error', (err) => {
            console.error('Failed to start process:', err);
            cleanupTempFiles();
            process.exit(1);
        });

        nodeProcess.on('exit', (code, signal) => {
            // Display any collected stderr output if process exited abnormally
            if (code !== 0 && stderrOutput) {
                console.error('\n--- Error output from child process ---');
                console.error(stderrOutput);
                console.error('--- End of error output ---\n');
            }

            console.log(`Process exited with code ${code || 0} and signal ${signal || 'none'}. \x1b[31mKILLED OR CRASHED. TRY RUNNING WITHOUT INSTRUMENTATION.\x1b[0m`);
            cleanupTempFiles();

            // If the process crashed with a non-zero exit code, exit with that code
            if (code !== 0 && code !== null) {
                process.exit(code);
            }
        });

        // Handle SIGINT to clean up
        process.on('SIGINT', () => {
            console.log('\nReceived SIGINT. Cleaning up...');
            if (!nodeProcess.killed) {
                nodeProcess.kill('SIGINT');
            }
            cleanupTempFiles();
            process.exit(0);
        });

        // Also handle SIGTERM for more robust cleanup
        process.on('SIGTERM', () => {
            console.log('\nReceived SIGTERM. Cleaning up...');
            if (!nodeProcess.killed) {
                nodeProcess.kill('SIGTERM');
            }
            cleanupTempFiles();
            process.exit(0);
        });
    } catch (error) {
        console.error('Error running instrumentation:', error);
        cleanupTempFiles();
        process.exit(1);
    }
}

// Run the instrumentation
runInstrumentation(); 