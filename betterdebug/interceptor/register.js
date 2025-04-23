/**
 * Babel register setup for intercepting require() calls
 * and applying transformations on the fly
 */

const path = require('path');

// Get the project root directory path
const projectRoot = path.resolve(__dirname, '..');

// Full path to util.ts
const utilFilePath = path.join(projectRoot, 'src', 'lib', 'util.ts');

// Setup @babel/register to intercept require calls
require('@babel/register')({
    extensions: ['.js', '.ts'],
    // Only target the util.ts file
    only: [
        // Escape backslashes in Windows paths for regex
        new RegExp(utilFilePath.replace(/\\/g, '\\\\').replace(/\./g, '\\.') + '$')
    ],
    // Configure TypeScript and ESM->CommonJS presets
    presets: [
        '@babel/preset-typescript',
        ['@babel/preset-env', { modules: 'commonjs' }]
    ],
    // Configure the plugins to use
    plugins: [
        path.join(__dirname, 'babel-plugins', 'debugWrapperPlugin.js')
    ]
});

console.log('>>> Babel register hook initialized for testing');
console.log(`>>> Only instrumenting: ${utilFilePath}`); 