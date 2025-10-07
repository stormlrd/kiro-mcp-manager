# KIRO MCP Manager by Silent Imperium

A Kiro extension for managing Model Context Protocol (MCP) servers with grouped templates and individual server control.

## Features

### Two Management Sections:

**MCP Server Groups** - Pre-configured server collections:
- AWS Core Services (API, docs, IAM, CloudFormation, pricing)
- AWS Databases (DynamoDB, Aurora, Redshift, Neptune, etc.)
- AWS Compute & Containers (Lambda, ECS, EKS, Step Functions)
- AWS Monitoring & Observability (CloudWatch, CloudTrail, Prometheus)
- AWS AI/ML Services (Bedrock, Rekognition, Nova Canvas)
- And many more specialized groups...

**All MCP Servers** - Individual server management:
- Toggle individual servers on/off
- Visual indicators for active servers
- Complete server catalog from master-servers.json

### Smart Configuration Management:
- Manages workspace `.kiro/settings/mcp.json` automatically
- Centralized environment variable management via `.kiro/settings/env-vars.json`
- Group loading clears existing servers and loads the entire group
- Individual server toggling adds/removes single servers
- Confirmation prompts for destructive operations
- Environment variables are automatically merged when servers are loaded

## Installation

1. Install the VSIX file: `zen-mcp-manager-0.0.1.vsix`
2. In Kiro, go to Extensions → Install from VSIX
3. Look for "MCP Server Groups" and "All MCP Servers" in Kiro's panel

## Usage

### Loading Server Groups:
1. Right-click on any group in "MCP Server Groups"
2. Select "Load Server Group"
3. Confirm the operation (this will replace your current MCP config)

### Managing Individual Servers:
1. Click on any server in "All MCP Servers" 
2. Server will be added/removed from your workspace MCP config
3. Active servers show a checkmark and "✓ Active" description

### Managing Environment Variables:
1. Click the gear icon (⚙️) in either panel header
2. Edit the `.kiro/settings/env-vars.json` file that opens
3. Set your AWS credentials and other environment variables
4. Save the file - changes apply when servers are loaded/toggled

**Key Environment Variables:**
- `AWS_SECRET_ACCESS_KEY` - Your AWS secret access key
- `AWS_SESSION_TOKEN` - Your AWS session token (for temporary credentials)
- `AUTH_API_KEY` - API keys for various services
- `AUTH_TOKEN` - Bearer tokens for authentication
- And many more service-specific variables...

## Files Structure

**Extension Files (bundled with VSIX):**
- `config/master-servers.json` - Complete catalog of available MCP servers
- `config/grouped-servers.json` - Pre-defined server group templates
- `config/env-vars.json` - Template for environment variables

**Workspace Files (persist across extension updates):**
- `.kiro/settings/mcp.json` - Your workspace MCP configuration (managed automatically)
- `.kiro/settings/env-vars.json` - Your environment variables (edit via gear icon)

## Requirements

- Kiro IDE with MCP support
- Workspace with the config files present