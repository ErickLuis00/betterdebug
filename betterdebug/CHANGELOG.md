# Change Log

All notable changes to the "Function Run" extension will be documented in this file.


## \[1.1.1\] - 2025-04-18

* Added icon

## \[1.1.0\] - 2025-04-18

### Added

* Support for JavaScript files (.js and .jsx)
* JavaScript parameter extraction using regex-based approach
* Enhanced function detection for JavaScript syntax

## \[1.0.0\] - 2025-04-18

### Added

* AI-powered mock data generation for function parameters
* Integration with OpenAI API for intelligent parameter values
* Multiple CodeLens buttons:
  * "Generate Mock and Run" - Create mock data and run with Quokka
  * "Run Function" - Execute with existing mock data
  * "Remove Function Call" - Clean up generated code
  * "Stop Run" - Stop Quokka execution
* Support for complex TypeScript types including interfaces and objects
* Type extraction from imports and project files
* Function name embedding in markers for more reliable code management
* Settings for OpenAI API key and proxy configuration

### Changed

* Improved type analysis for better mock data generation
* Enhanced marker format to associate generated code with specific functions

### Fixed

* Handling of optional parameters in function signatures
* Better detection of function declarations in various formats


