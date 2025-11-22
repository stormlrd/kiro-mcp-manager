import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface KiroHookConfig {
  enabled: boolean;
  name: string;
  description: string;
  version: string;
  when: {
    type: string;
    patterns: string[];
  };
  then: {
    type: string;
    prompt: string;
  };
}

export interface ServerRecommendation {
  serverId: string;
  reason: string;
}

export class HookManager {
  /**
   * Ensures the agent hook exists, creating it if necessary
   * @param context - Extension context for accessing extension resources
   * @returns Promise that resolves when hook is ensured
   */
  static async ensureHook(context: vscode.ExtensionContext): Promise<void> {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        console.log('No workspace folder found, skipping hook creation');
        return;
      }

      const hookPath = path.join(
        workspaceFolder.uri.fsPath,
        '.kiro',
        'hooks',
        'mcp-server-recommendations.kiro.hook'
      );

      // Validate hook path
      if (!hookPath || hookPath.trim() === '') {
        console.error('Invalid hook path generated');
        return;
      }

      try {
        // Check if hook already exists
        await fs.promises.access(hookPath);
        console.log('Agent hook already exists, skipping creation');
        
        // Validate existing hook configuration
        try {
          const existingContent = await fs.promises.readFile(hookPath, 'utf8');
          const existingConfig = JSON.parse(existingContent);
          
          // Basic validation - check for required fields
          if (!existingConfig.name || !existingConfig.when || !existingConfig.then) {
            console.warn('Existing hook configuration is invalid or incomplete');
          }
        } catch (validationError) {
          console.error('Failed to validate existing hook configuration:', validationError);
          // Don't fail - existing hook might still work
        }
      } catch (accessError) {
        // Hook doesn't exist, create it
        try {
          console.log('Creating agent hook configuration');
          
          // Copy master-servers.json to workspace so agent can access it
          await this.copyMasterServersToWorkspace(context, workspaceFolder);
          
          const hookConfig = this.createHookConfig();
          
          // Validate hook config before writing
          if (!this.validateHookConfig(hookConfig)) {
            const errorMsg = 'Generated hook configuration is invalid';
            console.error(errorMsg);
            vscode.window.showErrorMessage(`Failed to create MCP hook: ${errorMsg}. Check the output console for details.`);
            return;
          }
          
          await this.createHook(hookPath, hookConfig);
          console.log('Agent hook created successfully at:', hookPath);
          
          // Notify user and attempt to refresh Kiro hooks
          vscode.window.showInformationMessage(
            'MCP Design Analyzer hook created! Please reload the window to activate the hook.',
            'Reload Window',
            'Open Hook UI'
          ).then(selection => {
            if (selection === 'Reload Window') {
              vscode.commands.executeCommand('workbench.action.reloadWindow');
            } else if (selection === 'Open Hook UI') {
              vscode.commands.executeCommand('workbench.view.extension.kiro');
            }
          });
        } catch (createError) {
          const errorMsg = createError instanceof Error ? createError.message : 'Unknown error';
          console.error('Failed to create agent hook:', errorMsg, createError);
          // Don't throw - allow extension to continue activating
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('Unexpected error in ensureHook:', errorMsg, error);
      // Don't throw - allow extension to continue activating
    }
  }

  /**
   * Creates the hook configuration object
   * @returns Hook configuration object
   */
  private static createHookConfig(): KiroHookConfig {
    return {
      enabled: false,
      name: 'MCP Server Recommendations for Project',
      description: 'Analyzes all design documents in the project and generates a complete MCP server configuration based on technologies, services, and requirements across all specs. This hook is disabled by default - enable it in the Agent Hooks view to run manually.',
      version: '1',
      when: {
        type: 'userTriggered',
        patterns: ['.kiro/specs/*/design.md']
      },
      then: {
        type: 'askAgent',
        prompt: this.generatePrompt()
      }
    };
  }

  /**
   * Creates the hook configuration file
   * @param hookPath - Full path to the hook configuration file
   * @param config - Hook configuration object
   * @returns Promise that resolves when file is written
   */
  private static async createHook(hookPath: string, config: KiroHookConfig): Promise<void> {
    // Validate inputs
    if (!hookPath || hookPath.trim() === '') {
      throw new Error('Hook path is required and cannot be empty');
    }
    
    if (!config) {
      throw new Error('Hook configuration is required');
    }

    try {
      // Ensure directory exists
      const dir = path.dirname(hookPath);
      
      if (!dir || dir.trim() === '') {
        throw new Error('Invalid directory path derived from hook path');
      }

      try {
        await fs.promises.mkdir(dir, { recursive: true });
      } catch (mkdirError) {
        const errorMsg = mkdirError instanceof Error ? mkdirError.message : 'Unknown error';
        throw new Error(`Failed to create hooks directory: ${errorMsg}`);
      }

      // Serialize configuration to JSON format
      let configJson: string;
      try {
        configJson = JSON.stringify(config, null, 2);
      } catch (jsonError) {
        const errorMsg = jsonError instanceof Error ? jsonError.message : 'Unknown error';
        throw new Error(`Failed to serialize hook configuration: ${errorMsg}`);
      }

      // Write hook configuration with atomic operation
      try {
        await fs.promises.writeFile(hookPath, configJson, { encoding: 'utf8', flag: 'w' });
      } catch (writeError) {
        const errorMsg = writeError instanceof Error ? writeError.message : 'Unknown error';
        throw new Error(`Failed to write hook configuration file: ${errorMsg}`);
      }

      // Verify the file was written correctly
      try {
        const writtenContent = await fs.promises.readFile(hookPath, 'utf8');
        const parsedConfig = JSON.parse(writtenContent);
        
        if (!parsedConfig.name || parsedConfig.name !== config.name) {
          throw new Error('Hook configuration verification failed: content mismatch');
        }
      } catch (verifyError) {
        // Log warning but don't fail - file might still be usable
        console.warn('Failed to verify written hook configuration:', verifyError);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to create hook configuration:', errorMsg, error);
      throw new Error(`Failed to create hook configuration: ${errorMsg}`);
    }
  }

  /**
   * Copies master-servers.json to workspace for agent access
   * @param context - Extension context
   * @param workspaceFolder - Workspace folder
   */
  private static async copyMasterServersToWorkspace(
    context: vscode.ExtensionContext,
    workspaceFolder: vscode.WorkspaceFolder
  ): Promise<void> {
    try {
      const sourcePath = path.join(context.extensionPath, 'config', 'master-servers.json');
      const destPath = path.join(workspaceFolder.uri.fsPath, '.kiro', 'mcp-servers-reference.json');
      
      // Ensure directory exists
      const dir = path.dirname(destPath);
      await fs.promises.mkdir(dir, { recursive: true });
      
      // Copy the file
      const content = await fs.promises.readFile(sourcePath, 'utf8');
      await fs.promises.writeFile(destPath, content, 'utf8');
      
      console.log('Copied master-servers.json to workspace at:', destPath);
    } catch (error) {
      console.error('Failed to copy master-servers.json to workspace:', error);
      // Don't throw - this is not critical for hook creation
    }
  }

  /**
   * Generates the agent prompt for analyzing design documents
   * @returns The formatted prompt string with escaped newlines
   */
  private static generatePrompt(): string {
    try {
      // Build prompt as single line with \n for newlines (required by Kiro hook format)
      // Using template literal to avoid apostrophe escaping issues
      const prompt = `You are analyzing ALL design documents in this project to generate a COMPLETE MCP server configuration.

CURRENT DESIGN FILE:
{FILE_CONTENT}

IMPORTANT INSTRUCTIONS:
1. Search the workspace for ALL design.md files in .kiro/specs/*/design.md patterns
2. Read EVERY design.md file you find to understand the complete project scope
3. Read #[file:.kiro/settings/mcp.json] to see currently loaded MCP servers (if file exists)
4. Read #[file:.kiro/mcp-servers-reference.json] to see all available MCP servers

TASK:
1. Analyze ALL design documents to identify:
   - Technologies and frameworks mentioned (React, Vue, Python, Node.js, etc.)
   - External services and APIs referenced (AWS, GitHub, Slack, etc.)
   - Data storage requirements (PostgreSQL, MongoDB, Redis, etc.)
   - Cloud platforms mentioned (AWS, Azure, GCP)
   - Development tools needed (Git, Docker, testing frameworks)

2. Review currently loaded servers from mcp.json (if it exists)

3. Generate a COMPLETE configuration that includes:
   - All currently loaded servers that are still relevant
   - Any NEW servers needed based on all design documents
   - Remove servers that are no longer needed for any design
   - Include context7 mcp server if this projects design is using a programming langauge in it such as needing node or python etc   

4. Return your recommendations in this format:

Here is your COMPLETE MCP server configuration for this project (analyzed X design files, kept Y existing servers, added Z new servers):

\`\`\`json
[
  {
    "serverId": "server-name",
    "reason": "Brief explanation of why this server is relevant"
  }
]
\`\`\`

To load this configuration, copy the JSON array and run the command: "MCP Manager: Load Recommended Servers" from the command palette (CTRL+SHIFT+P).

RULES:
- Return a COMPLETE list including both existing and new servers
- Only recommend servers that exist in mcp-servers-reference.json
- Only recommend servers that are clearly relevant to at least one design
- Provide specific reasons based on actual design content
- If no servers are relevant, return an empty array: []
- Prioritize servers that provide the most value across all designs
- Base recommendations on actual content across ALL design documents
- If mcp.json does not exist, generate a fresh configuration from scratch

EXAMPLE OUTPUT:
Here is your COMPLETE MCP server configuration for this project (analyzed 3 design files, kept 2 existing servers, added 1 new server):

\`\`\`json
[
  {"serverId": "github", "reason": "Existing - Project uses GitHub for version control across all features"},
  {"serverId": "postgres", "reason": "Existing - Database used in user-auth and data-sync designs"},
  {"serverId": "aws-kb-retrieval", "reason": "NEW - Added for AWS Lambda and DynamoDB mentioned in new serverless-api design"}
]
\`\`\``;

      return prompt;
    } catch (error) {
      console.error('Error generating prompt:', error);
      // Return a minimal valid prompt as fallback
      return 'Analyze the design document and recommend relevant MCP servers. Return a JSON array of recommendations.';
    }
  }

  /**
   * Validates hook configuration structure
   * @param config - Hook configuration to validate
   * @returns True if configuration is valid, false otherwise
   */
  private static validateHookConfig(config: KiroHookConfig): boolean {
    try {
      if (!config) {
        console.error('Hook configuration is null or undefined');
        return false;
      }

      if (typeof config.enabled !== 'boolean') {
        console.error('Hook configuration missing valid enabled field');
        return false;
      }

      if (!config.name || typeof config.name !== 'string' || config.name.trim() === '') {
        console.error('Hook configuration missing valid name');
        return false;
      }

      if (!config.description || typeof config.description !== 'string') {
        console.error('Hook configuration missing valid description');
        return false;
      }

      if (!config.version || typeof config.version !== 'string') {
        console.error('Hook configuration missing valid version');
        return false;
      }

      if (!config.when || typeof config.when !== 'object') {
        console.error('Hook configuration missing valid when clause');
        return false;
      }

      if (!config.when.type || typeof config.when.type !== 'string') {
        console.error('Hook configuration missing valid when.type');
        return false;
      }

      const validWhenTypes = ['fileCreated', 'fileEdited', 'fileSaved', 'fileDeleted', 'userTriggered'];
      if (!validWhenTypes.includes(config.when.type)) {
        console.error('Hook configuration has invalid when.type:', config.when.type);
        return false;
      }

      if (!Array.isArray(config.when.patterns) || config.when.patterns.length === 0) {
        console.error('Hook configuration missing valid when.patterns array');
        return false;
      }

      if (!config.then || typeof config.then !== 'object') {
        console.error('Hook configuration missing valid then clause');
        return false;
      }

      if (!config.then.type || typeof config.then.type !== 'string') {
        console.error('Hook configuration missing valid then.type');
        return false;
      }

      if (config.then.type !== 'askAgent') {
        console.error('Hook configuration has invalid then.type (only askAgent is supported)');
        return false;
      }

      if (!config.then.prompt || typeof config.then.prompt !== 'string' || config.then.prompt.trim() === '') {
        console.error('Hook configuration missing valid then.prompt');
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error validating hook configuration:', error);
      return false;
    }
  }
}
