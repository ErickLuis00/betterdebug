import { defineConfig } from 'vite'
// import react from '@vitejs/plugin-react'
import babel from '@rollup/plugin-babel'
// https://vite.dev/config/
export default defineConfig({

    plugins: [


        // ! FUNCIONA MAS AS LINHAS TA INCORRETO, PQ ELE RECEBE MODIFICADO JÁ PELOS OUTROS PLUGINS ACHO.
        // Rollup‐Babel plugin to cover other TS/TSX/JS files
        babel({
            // Ensure Babel helpers are bundled
            babelHelpers: 'bundled',
            // Exclude node_modules
            exclude: 'node_modules/**',
            // Include your TypeScript (and potentially JavaScript) source files
            include: ['src/**/*.ts', 'src/**/*.js'], // Adjust pattern if needed
            // Explicitly tell Babel to handle these extensions
            extensions: ['.js', '.ts'],
            // Presets needed for TypeScript and modern JavaScript
            presets: [
                // Handles TypeScript syntax
                "@babel/preset-typescript",
                // Handles modern JS syntax (optional but good practice, Vite also does this)
                // Set modules: false for ES module compatibility
                ["@babel/preset-env", { modules: false }]
            ],
            // Add your custom Babel plugin
            plugins: [
                ["C:/CodeProjects_Insync/_MadeInCursor/log-all-lines-mcp/betterdebug/out/babel-plugin-loglines.js", { extensionPath: "c:/CodeProjects_Insync/_MadeInCursor/log-all-lines-mcp/betterdebug" }],
            ]
        })
    ],
})
