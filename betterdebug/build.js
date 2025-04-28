const { build } = require('esbuild')
const fs = require('fs')
const path = require('path')
// Function to copy a directory recursively

async function main() {
    try {
        // Build main extension
        await build({
            entryPoints: ['./src/extension.ts'],
            bundle: true,
            outfile: './out/extension.js',
            external: ['vscode'],
            format: 'cjs',
            platform: 'node',
            minify: true,
            sourcemap: true,
            treeShaking: true
        });
        console.log('Main extension build complete!');

        // Build log-sender.ts as a cross-environment script
        await build({
            entryPoints: ['./src/log-sender.ts'],
            bundle: true,
            outfile: './out/log-sender.js', // Single output file
            external: ['ws'], // Keep 'ws' external, it will be required conditionally at runtime
            format: 'cjs', // Use CJS format for easier conditional require
            platform: 'neutral', // Avoid browser/node specific assumptions during build
            define: {
                // Define a global constant that Babel plugin can also use if needed
                // Might not be strictly necessary if log-sender is self-contained
                // 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
            },
            sourcemap: false,
            minify: false, // Keep readable for now
            treeShaking: false // Allow tree shaking
        });
        console.log('log-sender.ts compiled for cross-environment usage!');


        // Build babel-plugin-loglines (Assuming it's Node only)
        await build({
            entryPoints: ['./src/babel-plugin-loglines.js'],
            bundle: true,
            outfile: './out/babel-plugin-loglines.js',
            format: 'cjs',
            platform: 'node',
            minify: true,
            sourcemap: false,
            treeShaking: true
        });
        console.log('Babel plugin build complete!');

        // ! COMPILE FRAMEWORKS WRAPPERS
        for (let entryPoint of ['nextjs']) {
            await build({
                entryPoints: ["./src/frameworks/" + entryPoint + ".ts"],
                bundle: true,
                outfile: './out/frameworks/' + entryPoint + '.js',
                format: 'cjs',
                platform: 'node',
                minify: false,
                sourcemap: false,
                treeShaking: true
            });
            console.log('✅ ' + entryPoint + ' wrapper build complete!');
        }


    } catch (err) {
        console.error('Build failed:', err);
        process.exit(1);
    }
}

main();
