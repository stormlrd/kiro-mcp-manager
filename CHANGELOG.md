# Changelog

All notable changes to the Kiro MCP Manager extension will be documented in this file.

## [1.4.7] - 2024-11-13

### Added
- Security check for .gitignore file on extension activation
- Automatic detection if .kiro/settings folder is excluded from Git
- Warning prompts when sensitive configuration files are not protected
- One-click option to create .gitignore or add exclusions for sensitive files
- Protection for env-vars.json and mcp.json files containing credentials

### Fixed
- Corrected publisher name back to "Stormlrd" to prevent duplicate extension installations

### Security
- Prevents accidental commit of sensitive MCP server credentials and API keys

## [1.4.6] - 2024-11-13

### Fixed
- Fixed master-servers.json structure to use "servers" key instead of "mcpServers" for proper server list display
- Corrected JSON format compatibility with extension's server loading mechanism

### Changed
- Updated config files with additional MCP server configurations
- Added new environment variables for genomics search functionality

## [1.4.5] - 2024-11-13

### Fixed
- Removed .kiro/settings folder from repository (added to .gitignore)
- Fixed master-servers.json structure

### Changed
- Recompiled extension with updated configuration files

## [1.4.4] - Previous Release

Initial stable release with grouped MCP server management functionality.
