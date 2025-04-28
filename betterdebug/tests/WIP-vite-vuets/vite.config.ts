import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
// import babel from '@rollup/plugin-babel'

// https://vite.dev/config/
export default defineConfig({
  // disable Vite’s esbuild TS transform so Babel sees original code
  esbuild: false,

  plugins: [
    // Vue SFC support
    vue(),

    // Instrument JS/TS (and .vue script blocks) with our log‐lines plugin
    // babel({
    //   // let Babel parse .js/.jsx/.ts/.tsx and .vue files
    //   extensions: ['.js', '.jsx', '.ts', '.tsx', '.vue'],
    //   babelHelpers: 'bundled',
    //   exclude: 'node_modules/**',
    //   include: ['src/**/*.{js,jsx,ts,tsx,vue}'],

    //   // Env + TS stripping
    //   presets: [
    //     ['@babel/preset-env', { modules: false }],
    //     ['@babel/preset-typescript']
    //   ],

    //   // Your custom loglines plugin
    //   plugins: [
    //     [
    //       'C:/CodeProjects_Insync/_MadeInCursor/log-all-lines-mcp/betterdebug/out/babel-plugin-loglines.js',
    //       { extensionPath: 'c:/CodeProjects_Insync/_MadeInCursor/log-all-lines-mcp/betterdebug' }
    //     ]
    //   ],


    // })
  ]
})