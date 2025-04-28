'use strict';

import * as path from 'path';

// !WARNING, should handle better pq se usuario tiver custom config pode dar problema,
// então tenq ver melhor como fica.só ´ra adicionar loader sem subscever dos usuarios.
// ADD SUPORT FOR TYPES FROM NEXTJS ETC.

interface BetterDebugOptions {
    extensionPath: string;
}

interface TurbopackRule {
    loaders: Array<{
        loader: string;
        options: {
            presets: any[];
            plugins: any[];
            [key: string]: any;
        };
    }>;
    as?: string;
}

interface TurbopackRules {
    [pattern: string]: TurbopackRule;
}

interface TurbopackConfig {
    rules: TurbopackRules;
}

interface WebpackOptions {
    dir: string;
    dev: boolean;
    isServer: boolean;
    buildId: string;
    config: any;
    [key: string]: any;
}

interface WebpackConfig {
    module: {
        rules: any[];
    };
    [key: string]: any;
}

interface NextConfig {
    turbopack?: TurbopackConfig;
    webpack?: (config: WebpackConfig, options: WebpackOptions) => WebpackConfig;
    serverExternalPackages?: string[];
    [key: string]: any;
}

// CONSTRUCTOR FUNCTION TO RECEIVE OPTIONS AND RETURN A FUNCTION TO APPLY THE CONFIG.
export default function (options: BetterDebugOptions = {} as BetterDebugOptions) {
    const { extensionPath } = options;

    if (!extensionPath) {
        throw new Error('[BetterDebug] extensionPath must be provided to withBetterDebug.');
    }

    /**
     * Merges custom Turbopack rules AND Webpack config needed by the extension into the Next.js config.
     *
     * @param {object} options Configuration options.
     * @param {import('next').NextConfig} options.nextConfig The user's original Next.js configuration.
     * @param {string} options.extensionPath The absolute path to the root of the BetterDebug extension installation.
     * @returns {import('next').NextConfig} The modified Next.js configuration.
     */
    function withBetterDebug(nextConfig: NextConfig = {}): NextConfig {


        // Log a colored message to indicate the extension is being applied
        console.log('\x1b[36m%s\x1b[0m', 'APPLYING BETTER DEBUG CONFIG TO NEXTJS!');
        console.log('\x1b[36m%s\x1b[0m', `Extension path: ${extensionPath}`);

        // Define the custom babel-loader path using extensionPath
        const customBabelLoaderPath = path.resolve(extensionPath, 'node_modules/babel-loader');
        console.log('\x1b[36m%s\x1b[0m', `Using custom babel-loader from: ${customBabelLoaderPath}`);

        // Define the babel plugin path using extensionPath
        // Assuming the plugin is located at 'interceptor/babel-plugins/babel-plugin-loglines.js' relative to the extension root
        const logPluginPath = path.resolve(extensionPath, 'out/babel-plugin-loglines.js');
        console.log('logPluginPath', logPluginPath);

        // --- Turbopack Configuration --- 
        const myExtensionTurbopackRules: TurbopackRules = {
            // Apply babel-loader with our plugin to TS files in src
            '**/src/**/*.ts': {
                loaders: [
                    {
                        // Using custom babel-loader path for Turbopack
                        loader: customBabelLoaderPath,
                        options: {
                            // You can set a custom cache directory with cacheDirectory option
                            // cacheDirectory: '/custom/cache/path',
                            presets: [
                                ['next/babel', {
                                    'preset-env': {
                                        exclude: ['@babel/plugin-transform-block-scoping', '@babel/plugin-transform-typeof-symbol']
                                    },
                                    'preset-react': {
                                        runtime: 'automatic'
                                    },
                                    'transform-runtime': {
                                        useESModules: true,
                                        helpers: false  // Change to false to avoid external helpers and avoid BREAK WITH TURBOPACK
                                    }
                                }]
                            ],
                            plugins: [
                                [logPluginPath, { extensionPath }]
                            ],
                        },
                    },
                ],
            },
            // Apply babel-loader with our plugin to TSX files in src, excluding layout.tsx
            '**/src/**/*.tsx': {
                // '!**/src/app/layout.tsx': true,
                loaders: [
                    {
                        // Using custom babel-loader path for Turbopack
                        loader: customBabelLoaderPath,
                        options: {
                            presets: [
                                ['next/babel', {
                                    'preset-env': {
                                        exclude: ['@babel/plugin-transform-block-scoping', '@babel/plugin-transform-typeof-symbol',]
                                    },
                                    'preset-react': {
                                        runtime: 'automatic',
                                    },
                                    'transform-runtime': {
                                        useESModules: true,
                                        helpers: false  // Change to false to avoid external helpers and avoid BREAK WITH TURBOPACK
                                    }
                                }]
                            ],
                            plugins: [
                                [logPluginPath, { extensionPath }]
                            ],
                        },
                    },
                ],
            },
        };

        // Deep copy the original config to avoid modifying it directly
        // Note: JSON.stringify won't copy functions, so we handle webpack separately
        const modifiedConfig: NextConfig = { ...nextConfig }; // Shallow copy is enough for top-level, handle nested objects carefully

        // Ensure turbopack and turbopack.rules exist and merge
        if (!modifiedConfig.turbopack) {
            modifiedConfig.turbopack = { rules: {} };
        }
        // After ensuring turbopack exists, we can safely assert it's not undefined
        if (!modifiedConfig.turbopack!.rules) {
            modifiedConfig.turbopack!.rules = {};
        }
        // The non-null assertion tells TypeScript that turbopack is definitely not null at this point
        Object.assign(modifiedConfig.turbopack!.rules, myExtensionTurbopackRules);

        // --- Webpack Configuration --- 
        const originalWebpack = modifiedConfig.webpack;

        modifiedConfig.webpack = (config: WebpackConfig, webpackOptions: WebpackOptions) => {
            // Call the original webpack function if it exists
            const updatedConfig = originalWebpack ? originalWebpack(config, webpackOptions) : config;

            // Correctly resolve the src directory relative to the Next.js project root
            const projectRoot = webpackOptions.dir; // The root directory of the Next.js project
            const srcDir = path.resolve(projectRoot, 'src');
            console.log('\x1b[33m%s\x1b[0m', `[BetterDebug Webpack] Targeting source directory: ${srcDir}`); // Added log

            // Find existing JS/TS rule to potentially modify or ensure our loader runs correctly
            // This part might need more sophisticated logic depending on the exact default Next.js config

            // Add the babel-loader rule for .ts and .tsx files in the project's src directory
            updatedConfig.module.rules.push({
                test: (resource: string) => {
                    // Check if the file is within the resolved src directory and ends with .ts or .tsx
                    const isTargetFile = resource.startsWith(srcDir) && /\.(ts|tsx)$/.test(resource);
                    // if (isTargetFile) {
                    //     console.log(`\x1b[32m%s\x1b[0m', '[BetterDebug Webpack] Applying babel-loader to:', resource); // Verbose log
                    // }
                    return isTargetFile;
                },
                exclude: /node_modules/, // Exclude node_modules
                use: {
                    // Using custom babel-loader path for Webpack
                    loader: customBabelLoaderPath,
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
                                    useESModules: true,
                                    helpers: false  // NOT NECESSARY WITH WEBPACK (NON TURBOPACK) BUT KEEPING FOR CONSISTENCY
                                }
                            }]
                        ],
                        plugins: [
                            [logPluginPath, { extensionPath }]
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

    return { withBetterDebug };
}
