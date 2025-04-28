import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// import babel from '@rollup/plugin-babel'
// https://vite.dev/config/
export default defineConfig({

  plugins: [
    // React plugin with custom Babel pipeline
    react(
      {
        babel: {
          exclude: 'node_modules/**',
          include: ['src/**/*.js', 'src/**/*.jsx', 'src/**/*.ts', 'src/**/*.tsx'],
          presets: [
            ["@babel/preset-env", { modules: false }],
            ["@babel/preset-react", { runtime: "automatic" }]
          ],
          plugins: [
            ["C:/CodeProjects_Insync/_MadeInCursor/log-all-lines-mcp/betterdebug/out/babel-plugin-loglines.js", { extensionPath: "c:/CodeProjects_Insync/_MadeInCursor/log-all-lines-mcp/betterdebug" }],

          ]
        }
      }
    ),

    // ! FUNCIONA MAS AS LINHAS TA INCORRETO, PQ ELE RECEBE MODIFICADO JÁ PELOS OUTROS PLUGINS ACHO.
    // Rollup‐Babel plugin to cover other TS/TSX/JS files
    // babel({
    //   babelHelpers: 'bundled',
    //   exclude: 'node_modules/**',
    //   include: ['src/**/*.js', 'src/**/*.jsx', 'src/**/*.ts', 'src/**/*.tsx'],
    //   presets: [
    //     ["@babel/preset-env", { modules: false }],
    //     ["@babel/preset-react", { runtime: "automatic" }]
    //   ],
    //   plugins: [
    //     ["C:/CodeProjects_Insync/_MadeInCursor/log-all-lines-mcp/betterdebug/out/babel-plugin-loglines.js", { extensionPath: "c:/CodeProjects_Insync/_MadeInCursor/log-all-lines-mcp/betterdebug" }],

    //   ]
    // })
  ],
})
