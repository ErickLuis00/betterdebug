const { build } = require('esbuild')
const fs = require('fs')
const path = require('path')

// Function to copy a directory recursively
function copyDir(src, dest) {
    // Create destination directory if it doesn't exist
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true })
    }

    // Read all files/folders in the source directory
    const entries = fs.readdirSync(src, { withFileTypes: true })

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name)
        const destPath = path.join(dest, entry.name)

        if (entry.isDirectory()) {
            // Recursively copy subdirectories
            copyDir(srcPath, destPath)
        } else {
            // Copy files
            fs.copyFileSync(srcPath, destPath)
        }
    }
}

async function main() {
    try {
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
        console.log('Build complete!');

        // Copy interceptor folder to out directory
        const srcInterceptorDir = './interceptor'
        const destInterceptorDir = './out/interceptor'
        copyDir(srcInterceptorDir, destInterceptorDir)
        console.log('Interceptor folder copied to out directory');
    } catch (err) {
        console.error('Build failed:', err);
        process.exit(1);
    }
}

main();
