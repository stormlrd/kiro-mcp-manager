# Design Document: Agent Hook for MCP Server Recommendations

## Overview

This design extends the Kiro MCP Manager extension to automatically install and manage an agent hook that analyzes design documents and recommends relevant MCP servers. The hook will be created during extension activation and will trigger when design.md files are created in the spec workflow, providing intelligent MCP server recommendations based on the project's technical requirements.

## Architecture

### High-Level Flow

```
Extension Activation
    ↓
Create Hook Configuration
    ↓
[User creates design.md] → Hook Triggers
    ↓
Read Design Content + Load Available Servers
    ↓
Send to Agent for Analysis
    ↓
Receive Server Recommendations
    ↓
Validate & Load Servers
    ↓
Update Workspace MCP Config
    ↓
Notify User
```

### Component Interaction

```
┌─────────────────────┐
│  Extension.ts       │
│  (activate)         │
└──────────┬──────────┘
           │
           ↓
┌─────────────────────┐
│  HookManager        │
│  - ensureHook()     │
│  - createHook()     │
└─────────────────────┘
           │
           ↓
┌─────────────────────┐
│  Hook Config JSON   │
│  (.kiro/hooks/)     │
└─────────────────────┘

[File Event: design.md created]
           ↓
┌─────────────────────┐
│  Kiro Hook System   │
│  (triggers hook)    │
└──────────┬──────────┘
           │
           ↓
┌─────────────────────┐
│  Agent Prompt       │
│  - Design content   │
│  - Available servers│
└──────────┬──────────┘
           │
           ↓
┌─────────────────────┐
│  Agent Analysis     │
│  (returns servers)  │
└──────────┬──────────┘
           │
           ↓
┌─────────────────────┐
│  ServerLoader       │
│  - validate()       │
│  - loadServers()    │
└─────────────────────┘
```

## Components and Interfaces

### 1. HookManager Module

**Purpose**: Manages the creation and configuration of the agent hook.

**Location**: `src/hookManager.ts`

**Interface**:
```typescript
interface HookConfig {
  name: string;
  description: string;
  trigger: {
    type: 'file';
    event: 'create';
    pattern: string;
  };
  prompt: string;
  autoExecute: boolean;
}

class HookManager {
  /**
   * Ensures the agent hook exists, creating it if necessary
   * @param context - Extension context for accessing extension resources
   * @returns Promise that resolves when hook is ensured
   */
  static async ensureHook(context: vscode.ExtensionContext): Promise<void>;
  
  /**
   * Creates the hook configuration file
   * @param hookPath - Full path to the hook configuration file
   * @param config - Hook configuration object
   * @returns Promise that resolves when file is written
   */
  private static async createHook(hookPath: string, config: HookConfig): Promise<void>;
  
  /**
   * Generates the agent prompt for analyzing design documents
   * @returns The formatted prompt string
   */
  private static generatePrompt(): string;
}
```

**Key Responsibilities**:
- Check if hook configuration exists
- Create `.kiro/hooks` directory if needed
- Generate hook configuration with appropriate trigger pattern
- Write hook configuration to disk
- Handle errors gracefully without blocking extension activation

### 2. Hook Configuration Structure

**File**: `.kiro/hooks/kiro-mcp-manager-design-hook.json`

**Structure**:
```json
{
  "name": "kiro-mcp-manager-design-hook",
  "description": "Analyzes design.md files and recommends relevant MCP servers",
  "trigger": {
    "type": "file",
    "event": "create",
    "pattern": "**/.kiro/specs/*/design.md"
  },
  "prompt": "[Generated prompt with instructions]",
  "autoExecute": true
}
```

**Field Descriptions**:
- `name`: Unique identifier for the hook
- `description`: Human-readable description of hook purpose
- `trigger.type`: Event type to monitor (file system events)
- `trigger.event`: Specific event to trigger on (create)
- `trigger.pattern`: Glob pattern matching target files
- `prompt`: Instructions for the agent when hook triggers
- `autoExecute`: Whether to run automatically without user confirmation

### 3. Agent Prompt Design

**Purpose**: Provide clear instructions to the agent for analyzing design documents and recommending servers.

**Prompt Structure**:
```
You are analyzing a design document to recommend relevant MCP servers.

DESIGN DOCUMENT CONTENT:
{design_content}

AVAILABLE MCP SERVERS:
{server_list_with_descriptions}

TASK:
1. Analyze the design document to identify:
   - Technologies and frameworks mentioned
   - External services and APIs referenced
   - Data storage requirements
   - Cloud platforms mentioned
   - Development tools needed

2. Match these requirements against the available MCP servers

3. Return ONLY a JSON array of recommended server IDs with explanations:
[
  {
    "serverId": "server-name",
    "reason": "Brief explanation of why this server is relevant"
  }
]

RULES:
- Only recommend servers that are clearly relevant to the design
- Provide specific reasons based on design content
- If no servers are relevant, return an empty array: []
- Do not recommend more than 10 servers
- Prioritize servers that provide the most value
```

**Dynamic Content**:
- `{design_content}`: Full text of the design.md file
- `{server_list_with_descriptions}`: Formatted list from master-servers.json including server IDs, descriptions, and tags

### 4. ServerLoader Module

**Purpose**: Validates and loads recommended MCP servers into workspace configuration.

**Location**: `src/serverLoader.ts`

**Interface**:
```typescript
interface ServerRecommendation {
  serverId: string;
  reason: string;
}

class ServerLoader {
  /**
   * Validates and loads recommended servers
   * @param recommendations - Array of server recommendations from agent
   * @param context - Extension context for accessing master servers
   * @returns Promise resolving to number of servers loaded
   */
  static async loadRecommendedServers(
    recommendations: ServerRecommendation[],
    context: vscode.ExtensionContext
  ): Promise<number>;
  
  /**
   * Validates that server IDs exist in master configuration
   * @param serverIds - Array of server IDs to validate
   * @param masterServers - Master server configuration
   * @returns Array of valid server IDs
   */
  private static validateServerIds(
    serverIds: string[],
    masterServers: Record<string, McpServer>
  ): string[];
  
  /**
   * Formats recommendations for user notification
   * @param recommendations - Array of server recommendations
   * @returns Formatted string for display
   */
  private static formatRecommendations(
    recommendations: ServerRecommendation[]
  ): string;
}
```

**Key Responsibilities**:
- Parse agent response (JSON array of recommendations)
- Validate server IDs against master-servers.json
- Load environment variables from workspace
- Merge environment variables with server configurations
- Update workspace mcp.json
- Display success/error notifications

### 5. Extension Integration

**Modification**: `src/extension.ts`

**Changes**:
```typescript
import { HookManager } from './hookManager';

export function activate(context: vscode.ExtensionContext) {
    console.log('Zens MCP Manager is now active!');

    // Ensure env-vars.json exists in workspace
    ensureEnvVarsConfig(context).catch(console.error);
    
    // NEW: Ensure agent hook exists
    HookManager.ensureHook(context).catch(error => {
        console.error('Failed to ensure agent hook:', error);
        // Don't block activation on hook creation failure
    });

    // ... rest of existing activation code
}
```

## Data Models

### Hook Configuration Model

```typescript
interface HookTrigger {
  type: 'file' | 'command' | 'manual';
  event?: 'create' | 'modify' | 'delete';
  pattern?: string;
}

interface HookConfig {
  name: string;
  description: string;
  trigger: HookTrigger;
  prompt: string;
  autoExecute: boolean;
}
```

### Server Recommendation Model

```typescript
interface ServerRecommendation {
  serverId: string;
  reason: string;
}

interface AgentResponse {
  recommendations: ServerRecommendation[];
}
```

### Existing Models (Reused)

```typescript
interface McpServer {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  description?: string;
  tags?: string[];
  httpUrl?: string;
  headers?: Record<string, string>;
}

interface McpConfig {
  mcpServers: Record<string, McpServer>;
}
```

## Error Handling

### Error Categories and Responses

1. **Hook Creation Errors**
   - **Scenario**: Directory creation fails, file write fails
   - **Response**: Log error, continue extension activation
   - **User Impact**: Hook won't be available, but extension functions normally

2. **File Read Errors**
   - **Scenario**: Cannot read design.md or master-servers.json
   - **Response**: Log error, show notification, terminate hook execution
   - **User Impact**: No servers loaded, user informed of failure

3. **Agent Analysis Errors**
   - **Scenario**: Agent timeout, invalid JSON response, agent error
   - **Response**: Log error, show notification with error details
   - **User Impact**: No servers loaded, user can retry manually

4. **Configuration Write Errors**
   - **Scenario**: Cannot write to mcp.json
   - **Response**: Show error notification with specific reason
   - **User Impact**: Servers not loaded, workspace config unchanged

5. **Validation Errors**
   - **Scenario**: Recommended server IDs don't exist in master config
   - **Response**: Filter out invalid IDs, proceed with valid ones
   - **User Impact**: Only valid servers loaded, notification shows count

### Error Handling Pattern

```typescript
try {
  // Operation
} catch (error) {
  console.error('Context-specific error message:', error);
  vscode.window.showErrorMessage(
    `User-friendly error message: ${error.message}`
  );
  // Graceful degradation or termination
}
```

## Testing Strategy

### Unit Tests

1. **HookManager Tests**
   - Test hook configuration generation
   - Test prompt generation with various server lists
   - Test directory creation logic
   - Test error handling for file operations

2. **ServerLoader Tests**
   - Test server ID validation
   - Test environment variable merging
   - Test JSON parsing of agent responses
   - Test handling of invalid recommendations

### Integration Tests

1. **Hook Creation Flow**
   - Test extension activation creates hook
   - Test hook file structure and content
   - Test idempotency (multiple activations)

2. **End-to-End Flow**
   - Mock file creation event
   - Mock agent response
   - Verify mcp.json updated correctly
   - Verify notifications displayed

### Manual Testing Scenarios

1. **First-Time Installation**
   - Install extension in clean workspace
   - Verify hook created
   - Create design.md file
   - Verify hook triggers and servers load

2. **Existing Hook**
   - Install extension with existing hook
   - Verify hook not overwritten
   - Verify extension functions normally

3. **Error Scenarios**
   - Test with read-only file system
   - Test with invalid master-servers.json
   - Test with malformed agent response
   - Verify graceful error handling

4. **Various Design Documents**
   - Test with AWS-focused design
   - Test with database-focused design
   - Test with generic design (no clear MCP needs)
   - Verify appropriate recommendations

## Implementation Notes

### File System Operations

- Use `fs.promises` for async file operations
- Use `path.join()` for cross-platform path handling
- Create directories with `{ recursive: true }` option
- Check file existence before reading

### Agent Interaction

- The hook system handles agent invocation automatically
- Agent receives the prompt with interpolated content
- Response parsing should be defensive (handle malformed JSON)
- Consider timeout handling (agent may take time to analyze)

### Configuration Management

- Reuse existing `loadMasterServers()` function
- Reuse existing `loadWorkspaceEnvVars()` function
- Reuse existing `mergeEnvironmentVariables()` function
- Reuse existing `saveWorkspaceMcpConfig()` function

### User Experience

- Show progress notification when hook triggers
- Show success notification with server count
- Show detailed error messages on failure
- Consider adding "View Loaded Servers" action in notification

## Future Enhancements

1. **Hook Configuration UI**
   - Allow users to enable/disable the hook
   - Allow users to customize the trigger pattern
   - Allow users to edit the agent prompt

2. **Recommendation Refinement**
   - Allow users to review recommendations before loading
   - Add option to load subset of recommendations
   - Remember user preferences for future recommendations

3. **Multiple Trigger Points**
   - Trigger on design.md modification (not just creation)
   - Trigger on requirements.md creation
   - Trigger on manual command

4. **Analytics and Learning**
   - Track which recommendations users accept/reject
   - Improve prompt based on user feedback
   - Suggest removing unused servers

## Security Considerations

1. **File System Access**
   - Only read/write within workspace directory
   - Validate file paths before operations
   - Handle permission errors gracefully

2. **Configuration Validation**
   - Validate hook configuration structure
   - Validate server IDs before loading
   - Sanitize user input in prompts

3. **Agent Interaction**
   - Don't expose sensitive environment variables in prompts
   - Validate agent response structure
   - Handle malicious or malformed responses safely
