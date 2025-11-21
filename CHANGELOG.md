# Changelog

All notable changes to the Kiro MCP Manager extension will be documented in this file.

## [1.5.1] - 2024-11-22

### Changed
- Updated MCP server configuration files with latest server definitions

## [1.5.0] - 2024-11-22

### Added
- Manual agent hook for MCP server recommendations based on design documents
- Hook analyzes `.kiro/specs/*/design.md` files to recommend relevant MCP servers
- AI-powered analysis of technical requirements and project needs
- Automatic hook installation at `.kiro/hooks/mcp-server-recommendations.kiro.hook`
- Command `zenMcp.loadRecommendedServers` for loading AI-recommended servers

### Changed
- Hook runs manually (not automatically) to give users control over when recommendations are generated
- Enhanced README with comprehensive hook documentation and usage examples
## [1.4.8] - 2024-11-14

Just fixed the packaging so the links in the marketplate work.

## [1.4.7] - 2024-11-13

### Added
- Security check for .gitignore file on extension activation
- Automatic detection if .kiro/settings folder is excluded from Git
- Warning prompts when sensitive configuration files are not protected
- One-click option to create .gitignore or add exclusions for sensitive files
- Protection for env-vars.json and mcp.json files containing credentials

### Changed
- Changed publisher name back to "PaulDunlop" as part of prep to publish to the extensions marketplace. Will require an uninstall and re-install if you had the one with published "Stormlrd" in it as it creates a duplicate.

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
