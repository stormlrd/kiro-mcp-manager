# KIRO MCP Manager by Stormlrd

A Kiro extension for managing Model Context Protocol (MCP) servers with grouped templates and individual server control.

For any bugs, feature requests please ensure you go to the github repo (click link on the right hand side) and lodge them through there.

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

## Agent Hook: MCP Server Recommendations

The extension installs an **agent hook** that analyzes your design documents and recommends relevant MCP servers for your project. This is a powerful way to have AI learn, review, and recommend what MCP servers your project needs based on the designs you've generated.

### How It Works

The hook is **disabled by default** for manual triggering. When activated, it:
1. Reads your design document content from `.kiro/specs/*/design.md`
2. Analyzes the technical requirements and technologies mentioned
3. Recommends relevant MCP servers from the available catalog
4. Provides recommendations for you to review and load

**Why Disabled by Default?** This gives you control over when recommendations are generated and lets you review them before loading servers into your workspace.

### Running the Hook

**To trigger the hook manually:**
1. Open the Kiro sidebar and navigate to the "Agent Hooks" section
2. Find "MCP Server Recommendations for Project" in the hooks list
3. Click the hook to trigger it manually
4. Review the AI's recommendations
5. Copy the JSON array and run "MCP Manager: Load Recommended Servers" from the command palette

**To enable automatic triggering:**
1. Open the Agent Hooks UI in Kiro
2. Find "MCP Server Recommendations for Project"
3. Enable the hook - it will now run automatically when you save design.md files

### Hook Configuration

The hook is automatically created at `.kiro/hooks/mcp-server-recommendations.kiro.hook` when the extension activates.

**Example Hook Structure:**
```json
{
  "enabled": false,
  "name": "MCP Server Recommendations for Project",
  "description": "Analyzes all design documents in the project and generates a complete MCP server configuration. This hook is disabled by default - enable it in the Agent Hooks view to run manually.",
  "version": "1",
  "when": {
    "type": "fileSaved",
    "patterns": [".kiro/specs/*/design.md"]
  },
  "then": {
    "type": "askAgent",
    "prompt": "You are analyzing ALL design documents to generate a COMPLETE MCP server configuration..."
  }
}
```

**Configuration Fields:**
- `enabled` - Whether the hook is active (false by default for manual triggering)
- `name` - Human-readable name for the hook
- `description` - Description of what the hook does
- `version` - Hook configuration version
- `when.type` - Event type to monitor (`fileCreated`, `fileEdited`, `fileSaved`, `fileDeleted`)
- `when.patterns` - Array of glob patterns matching target files
- `then.type` - Action type (`askAgent` to invoke AI agent)
- `then.prompt` - Instructions sent to the agent when the hook triggers

### Trigger Pattern Explained

The pattern `.kiro/specs/*/design.md` matches:
- `.kiro/specs/` - The specs directory in your workspace
- `*` - Any feature name directory
- `/design.md` - The design document file

**Examples of matching paths:**
- `.kiro/specs/user-authentication/design.md`
- `.kiro/specs/payment-processing/design.md`
- `.kiro/specs/api-integration/design.md`

### Agent Response Format

When the hook triggers, the agent analyzes your design and returns recommendations in JSON format:

```json
[
  {
    "serverId": "aws-kb-retrieval",
    "reason": "Design mentions RAG implementation with vector search, which requires AWS Knowledge Base integration"
  },
  {
    "serverId": "postgres",
    "reason": "PostgreSQL database is specified for storing user data and relationships"
  },
  {
    "serverId": "github",
    "reason": "Design includes CI/CD pipeline integration with GitHub Actions"
  }
]
```

**Response Structure:**
- `serverId` - Must match a server ID from `master-servers.json`
- `reason` - Brief explanation of why this server is relevant to the design

**Empty Response (no relevant servers):**
```json
[]
```

### What Gets Analyzed

The agent looks for:
- **Technologies and frameworks** - React, Node.js, Python, etc.
- **External services and APIs** - AWS services, GitHub, databases
- **Data storage requirements** - PostgreSQL, DynamoDB, Redis
- **Cloud platforms** - AWS, Azure, GCP
- **Development tools** - Git, Docker, testing frameworks

### Customization

You can modify the hook behavior by editing `.kiro/hooks/mcp-server-recommendations.kiro.hook`:

**Enable automatic triggering on file saves:**
```json
"enabled": true
```

**Run on file creation instead of saves:**
```json
"when": {
  "type": "fileCreated",
  "patterns": [".kiro/specs/*/design.md"]
}
```

**Run on file edits:**
```json
"when": {
  "type": "fileEdited",
  "patterns": [".kiro/specs/*/design.md"]
}
```

**Monitor different files** (e.g., requirements.md):
```json
"when": {
  "type": "fileSaved",
  "patterns": [".kiro/specs/*/requirements.md"]
}
```

**Modify the prompt** to change analysis behavior (edit the `then.prompt` field with custom instructions)

### Troubleshooting

**Hook not triggering:**
- Verify the hook file exists at `.kiro/hooks/mcp-server-recommendations.kiro.hook`
- Check that the hook is enabled in the Agent Hooks UI (disabled by default)
- Ensure your design.md file matches the pattern `.kiro/specs/*/design.md`
- For automatic triggering, verify the file event matches (fileSaved by default)
- For manual triggering, click the hook in the Agent Hooks view

**No servers loaded:**
- Check the agent response format matches the expected JSON structure
- Verify server IDs exist in `master-servers.json`
- Review error notifications for specific failure reasons

**Unwanted servers loaded:**
- Edit the hook prompt to provide more specific guidance
- Set `autoExecute: false` to review recommendations before loading
- Manually remove servers from `.kiro/settings/mcp.json`

## Requirements

- Kiro IDE with MCP support
- Workspace with the config files present