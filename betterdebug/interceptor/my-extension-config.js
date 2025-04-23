'use strict';

const path = require('path');

// !WARNING, should handle better pq se usuario tiver custom config pode dar problema,
// então tenq ver melhor como fica.só ´ra adicionar loader sem subscever dos usuarios.

/**
 * Merges custom Turbopack rules AND Webpack config needed by the extension into the Next.js config.
 *
 * @param {import('next').NextConfig} nextConfig The user's original Next.js configuration.
 * @returns {import('next').NextConfig} The modified Next.js configuration.
 */
function withBetterDebug(nextConfig = {}) {
    // Log a colored message to indicate the extension is being applied
    console.log('\x1b[36m%s\x1b[0m', 'APPLYING BETTER DEBUG CONFIG TO NEXTJS!');

    // Define the path to the plugin consistently
    const logPluginPath = path.resolve(__dirname, 'babel-plugins/log-lines-plugin.js');

    // --- Turbopack Configuration --- 
    const myExtensionTurbopackRules = {
        // Apply babel-loader with our plugin to TS files in src
        '**/src/**/*.ts': {
            loaders: [
                {
                    loader: 'babel-loader',
                    options: {
                        presets: [
                            ['next/babel', {
                                'preset-env': {
                                    exclude: ['@babel/plugin-transform-block-scoping', '@babel/plugin-transform-typeof-symbol']
                                },
                                'preset-react': {
                                    runtime: 'automatic'
                                },
                                'transform-runtime': {
                                    useESModules: false
                                }
                            }]
                        ],
                        plugins: [
                            logPluginPath
                        ],
                    },
                },
            ],
            as: '*.js',
        },
        // Apply babel-loader with our plugin to TSX files in src, excluding layout.tsx
        '**/src/**/*.tsx': {
            '!**/src/app/layout.tsx': true,
            loaders: [
                {
                    loader: 'babel-loader',
                    options: {
                        presets: [
                            ['next/babel', {
                                'preset-env': {
                                    exclude: ['@babel/plugin-transform-block-scoping', '@babel/plugin-transform-typeof-symbol']
                                },
                                'preset-react': {
                                    runtime: 'automatic'
                                },
                                'transform-runtime': {
                                    useESModules: false
                                }
                            }]
                        ],
                        plugins: [
                            logPluginPath
                        ],
                    },
                },
            ],
            as: '*.js',
        },
    };

    // Deep copy the original config to avoid modifying it directly
    // Note: JSON.stringify won't copy functions, so we handle webpack separately
    const modifiedConfig = { ...nextConfig }; // Shallow copy is enough for top-level, handle nested objects carefully

    // Ensure turbopack and turbopack.rules exist and merge
    if (!modifiedConfig.turbopack) {
        modifiedConfig.turbopack = {};
    }
    if (!modifiedConfig.turbopack.rules) {
        modifiedConfig.turbopack.rules = {};
    }
    Object.assign(modifiedConfig.turbopack.rules, myExtensionTurbopackRules);

    // --- Webpack Configuration --- 
    const originalWebpack = modifiedConfig.webpack;

    modifiedConfig.webpack = (config, options) => {
        // Call the original webpack function if it exists
        const updatedConfig = originalWebpack ? originalWebpack(config, options) : config;

        const srcDir = path.resolve(__dirname, 'src');

        // Add the babel-loader rule for .ts and .tsx files in the src directory
        updatedConfig.module.rules.push({
            test: (resource) => {
                // Check if the file is within the src directory and ends with .ts or .tsx
                return resource.startsWith(srcDir) && /\.(ts|tsx)$/.test(resource);
            },
            exclude: /node_modules/, // Exclude node_modules
            use: {
                loader: 'babel-loader',
                options: {
                    // Use next/babel but exclude the block-scoping transform to preserve 'const'
                    presets: [
                        ['next/babel', {
                            'preset-env': {
                                exclude: ['@babel/plugin-transform-block-scoping', '@babel/plugin-transform-typeof-symbol'],
                            },
                            'preset-react': {
                                runtime: 'automatic'
                            },
                            'transform-runtime': {
                                useESModules: false
                            }
                        }]
                    ],
                    plugins: [
                        logPluginPath,
                        '@babel/plugin-transform-runtime'
                    ],
                },
            },
        });

        // Return the modified config
        return updatedConfig;
    };

    // --- Other Configurations (Example) --- 
    if (!modifiedConfig.serverExternalPackages) {
        modifiedConfig.serverExternalPackages = [];
    }
    // Example: Add 'ws' if not already present (though it was in the original user config)
    if (!modifiedConfig.serverExternalPackages.includes('ws')) {
        modifiedConfig.serverExternalPackages.push('ws');
    }

    return modifiedConfig;
}

module.exports = { withBetterDebug }; 