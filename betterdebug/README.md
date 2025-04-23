# Easy Run JS/TS Functions with AI Mock Generator

> ⚠️ **IMPORTANT**: This extension requires both an **OpenAI API key** and **Quokka.js** (community plan is sufficient) to function properly. Please ensure you have both configured before use.

 ![image](https://github.com/user-attachments/assets/41d19bb5-951b-401a-968c-b7ab68c95a31)

A VS Code extension that adds "Generate Mock and Run" buttons above Javascript/TypeScript functions to quickly test them with Quokka.js. It uses AI to automatically generate mock values for your function parameters based on their types.

## Features

* Adds CodeLens buttons above each TypeScript function
* When clicked, it automatically:
  * Analyzes your function signature and parameter types
  * Uses AI to generate appropriate mock values based on those types
  * Creates a function call with realistic data
  * Runs the file with Quokka.js to see the results instantly
* Supports complex TypeScript types including interfaces, arrays, and nested objects
* Maintains generated code with markers for easy management

## Requirements

* Visual Studio Code 1.99.0 or higher
* [Quokka.js](https://marketplace.visualstudio.com/items?itemName=WallabyJs.quokka-vscode) extension must be installed
* **OpenAI API key (for AI-powered mock data generation)**

## Setup


1. Install the extension from the VS Code Marketplace
2. Install the Quokka.js extension if you haven't already
3. Configure your OpenAI API key:
   * Open Settings (File > Preferences > Settings)
   * Search for "function-run"
   * Enter your OpenAI API key in the "OpenAI API Key" field
   * Or use the command "Function Run: Set OpenAI API Key" from the command palette

## How to Use

Open any JavaScript or TypeScript file


1. You'll see a "✨ Generate Mock and Run" button above each function
2. Click the button to:
   * Generate parameter values based on your function's signature
   * Run the function with Quokka for instant results
3. Once generated, you'll also see:
   * "▶ Run Function" - Run without regenerating parameters
   * "🗑 Remove Function Call" - Clean up generated code
   * "⏹ Stop Run" - Stop Quokka execution (when running)

## Extension Settings

This extension contributes the following settings:

* `function-run.enableCodeLens`: Enable/disable the CodeLens for running functions
* `function-run.openAIApiKey`: Your OpenAI API key for AI-powered mock generation
* `function-run.useProxy`: Enable if you need to use a proxy for OpenAI API calls
* `function-run.proxyUrl`: Proxy URL to use when useProxy is enabled

## Known Issues

* Complex recursive types might not be fully supported
* Very large type definitions might be truncated in AI prompts


