import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ServerRecommendation } from './hookManager';

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

interface EnvVarsConfig {
  version: string;
  description: string;
  variables: Record<string, string>;
  notes: Record<string, string>;
}

export class ServerLoader {
  /**
   * Validates and loads recommended servers
   * @param recommendations - Array of server recommendations from agent
   * @param context - Extension context for accessing master servers
   * @returns Promise resolving to number of servers loaded
   */
  static async loadRecommendedServers(
    recommendations: ServerRecommendation[],
    context: vscode.ExtensionContext
  ): Promise<number> {
    try {
      // Validate input parameters
      if (!context) {
        console.error('Extension context is required but was not provided');
        this.showAgentAnalysisError('Internal error: missing extension context');
        return 0;
      }

      // Validate recommendations structure
      if (!recommendations) {
        console.error('Recommendations parameter is null or undefined');
        vscode.window.showInformationMessage('No MCP servers recommended for this design.');
        return 0;
      }

      if (!Array.isArray(recommendations)) {
        console.error('Recommendations is not an array:', typeof recommendations);
        this.showAgentAnalysisError('Invalid recommendations format received from agent');
        return 0;
      }

      if (recommendations.length === 0) {
        console.log('Empty recommendations array received');
        vscode.window.showInformationMessage('No MCP servers recommended for this design.');
        return 0;
      }

      // Validate each recommendation structure
      const validRecommendations = recommendations.filter(rec => {
        if (!rec || typeof rec !== 'object') {
          console.warn('Invalid recommendation object:', rec);
          return false;
        }
        if (!rec.serverId || typeof rec.serverId !== 'string' || rec.serverId.trim() === '') {
          console.warn('Recommendation missing valid serverId:', rec);
          return false;
        }
        if (!rec.reason || typeof rec.reason !== 'string') {
          console.warn('Recommendation missing valid reason:', rec);
          return false;
        }
        return true;
      });

      if (validRecommendations.length === 0) {
        console.error('No valid recommendations after validation');
        this.showAgentAnalysisError('All recommendations were invalid or malformed');
        return 0;
      }

      if (validRecommendations.length < recommendations.length) {
        console.warn(`Filtered out ${recommendations.length - validRecommendations.length} invalid recommendations`);
      }

      // Load master servers configuration
      let masterServers: Record<string, McpServer>;
      try {
        masterServers = await this.loadMasterServers(context);
        
        if (!masterServers || typeof masterServers !== 'object') {
          throw new Error('Master servers configuration is invalid');
        }

        if (Object.keys(masterServers).length === 0) {
          throw new Error('Master servers configuration is empty');
        }
      } catch (error) {
        // Error notification already shown in loadMasterServers
        return 0;
      }
      
      // Extract server IDs and validate them
      const serverIds = validRecommendations.map(rec => rec.serverId);
      const validServerIds = this.validateServerIds(serverIds, masterServers);

      if (validServerIds.length === 0) {
        console.warn('No valid server IDs found after validation');
        vscode.window.showWarningMessage(
          'No valid MCP servers found in recommendations. The recommended servers may not exist in the master configuration.'
        );
        return 0;
      }

      // Filter recommendations to only include valid servers
      const finalRecommendations = validRecommendations.filter(rec => 
        validServerIds.includes(rec.serverId)
      );

      // Load workspace environment variables
      let envVars: EnvVarsConfig;
      try {
        envVars = await this.loadWorkspaceEnvVars();
        
        if (!envVars || typeof envVars !== 'object') {
          console.warn('Invalid environment variables config, using empty config');
          envVars = {
            version: '1.0.0',
            description: 'Centralized environment variables for MCP servers',
            variables: {},
            notes: {}
          };
        }
      } catch (error) {
        console.error('Failed to load environment variables:', error);
        // Continue with empty env vars
        envVars = {
          version: '1.0.0',
          description: 'Centralized environment variables for MCP servers',
          variables: {},
          notes: {}
        };
      }

      // Build new MCP configuration with recommended servers
      const newConfig: McpConfig = { mcpServers: {} };

      for (const serverId of validServerIds) {
        try {
          const server = masterServers[serverId];
          
          if (!server || typeof server !== 'object') {
            console.error(`Server configuration for ${serverId} is invalid`);
            continue;
          }

          const serverWithEnv = this.mergeEnvironmentVariables(server, envVars.variables || {});
          
          if (!serverWithEnv) {
            console.error(`Failed to merge environment variables for ${serverId}`);
            continue;
          }

          newConfig.mcpServers[serverId] = serverWithEnv;
        } catch (serverError) {
          console.error(`Error processing server ${serverId}:`, serverError);
          // Continue with other servers
        }
      }

      // Validate we have at least one server to save
      if (Object.keys(newConfig.mcpServers).length === 0) {
        console.error('No servers successfully configured');
        this.showAgentAnalysisError('Failed to configure any recommended servers');
        return 0;
      }

      // Save the configuration with rollback capability
      const originalConfig = await this.loadWorkspaceMcpConfig();
      try {
        await this.saveWorkspaceMcpConfig(newConfig);
      } catch (error) {
        // Attempt to restore original configuration
        try {
          await this.saveWorkspaceMcpConfig(originalConfig);
          console.log('Restored original configuration after save failure');
        } catch (rollbackError) {
          console.error('Failed to rollback configuration:', rollbackError);
        }
        // Error notification already shown in saveWorkspaceMcpConfig
        return 0;
      }

      // Display success notification with recommendations
      try {
        this.showSuccessNotification(validServerIds, finalRecommendations);
      } catch (notificationError) {
        console.error('Failed to show success notification:', notificationError);
        // Don't fail the operation just because notification failed
      }

      return validServerIds.length;
    } catch (error) {
      console.error('Unexpected error in loadRecommendedServers:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.showAgentAnalysisError(errorMsg);
      return 0;
    }
  }

  /**
   * Validates that server IDs exist in master configuration
   * @param serverIds - Array of server IDs to validate
   * @param masterServers - Master server configuration
   * @returns Array of valid server IDs
   */
  private static validateServerIds(
    serverIds: string[],
    masterServers: Record<string, McpServer>
  ): string[] {
    try {
      if (!Array.isArray(serverIds)) {
        console.error('serverIds is not an array');
        return [];
      }

      if (!masterServers || typeof masterServers !== 'object') {
        console.error('masterServers is not a valid object');
        return [];
      }

      const validIds: string[] = [];
      const invalidIds: string[] = [];

      for (const serverId of serverIds) {
        try {
          if (!serverId || typeof serverId !== 'string' || serverId.trim() === '') {
            console.warn('Invalid server ID (empty or non-string):', serverId);
            invalidIds.push(String(serverId));
            continue;
          }

          if (masterServers[serverId]) {
            validIds.push(serverId);
          } else {
            invalidIds.push(serverId);
          }
        } catch (error) {
          console.error(`Error validating server ID ${serverId}:`, error);
          invalidIds.push(String(serverId));
        }
      }

      // Log warnings for invalid server IDs
      if (invalidIds.length > 0) {
        console.warn(`Invalid server IDs recommended (${invalidIds.length}): ${invalidIds.join(', ')}`);
      }

      return validIds;
    } catch (error) {
      console.error('Unexpected error in validateServerIds:', error);
      return [];
    }
  }

  /**
   * Formats recommendations for user notification
   * @param recommendations - Array of server recommendations
   * @returns Formatted string for display
   */
  private static formatRecommendations(
    recommendations: ServerRecommendation[]
  ): string {
    try {
      if (!Array.isArray(recommendations)) {
        console.error('Recommendations is not an array in formatRecommendations');
        return 'No recommendations available';
      }

      if (recommendations.length === 0) {
        return 'No recommendations provided';
      }

      return recommendations
        .filter(rec => rec && typeof rec === 'object' && rec.serverId && rec.reason)
        .map(rec => {
          try {
            const serverId = String(rec.serverId).trim();
            const reason = String(rec.reason).trim();
            return `• ${serverId}: ${reason}`;
          } catch (error) {
            console.error('Error formatting recommendation:', error);
            return '• [Invalid recommendation]';
          }
        })
        .join('\n');
    } catch (error) {
      console.error('Error in formatRecommendations:', error);
      return 'Error formatting recommendations';
    }
  }

  /**
   * Displays success notification with server details
   * @param serverIds - Array of loaded server IDs
   * @param recommendations - Array of server recommendations
   */
  private static showSuccessNotification(
    serverIds: string[],
    recommendations: ServerRecommendation[]
  ): void {
    try {
      if (!Array.isArray(serverIds) || serverIds.length === 0) {
        console.error('Invalid serverIds provided to showSuccessNotification');
        return;
      }

      if (!Array.isArray(recommendations)) {
        console.error('Invalid recommendations provided to showSuccessNotification');
        recommendations = [];
      }

      const serverCount = serverIds.length;
      const serverList = serverIds.join(', ');
      const formattedRecs = this.formatRecommendations(recommendations);
      
      const message = `Successfully loaded ${serverCount} MCP server${serverCount !== 1 ? 's' : ''}: ${serverList}`;
      const detailedMessage = `${message}\n\nRecommendations:\n${formattedRecs}`;
      
      vscode.window.showInformationMessage(message, 'View Details').then(
        selection => {
          if (selection === 'View Details') {
            vscode.window.showInformationMessage(detailedMessage, { modal: true });
          }
        },
        (error: any) => {
          console.error('Error showing detailed notification:', error);
        }
      );
    } catch (error) {
      console.error('Error in showSuccessNotification:', error);
      // Fallback to simple notification
      try {
        vscode.window.showInformationMessage('MCP servers loaded successfully');
      } catch (fallbackError) {
        console.error('Failed to show fallback notification:', fallbackError);
      }
    }
  }

  /**
   * Displays error notification for file read failures
   * @param fileName - Name of the file that failed to read
   * @param errorDetails - Detailed error message
   */
  private static showFileReadError(fileName: string, errorDetails: string): void {
    try {
      const safeFileName = fileName || 'unknown file';
      const safeErrorDetails = errorDetails || 'unknown error';
      
      vscode.window.showErrorMessage(
        `Failed to read ${safeFileName}: ${safeErrorDetails}. Please ensure the file exists and is readable.`,
        'View Logs'
      ).then(
        selection => {
          if (selection === 'View Logs') {
            vscode.commands.executeCommand('workbench.action.output.toggleOutput').then(
              undefined,
              (error: any) => {
                console.error('Failed to open output logs:', error);
              }
            );
          }
        },
        (error: any) => {
          console.error('Error showing file read error notification:', error);
        }
      );
    } catch (error) {
      console.error('Critical error in showFileReadError:', error);
    }
  }

  /**
   * Displays error notification for agent analysis failures
   * @param errorDetails - Detailed error message
   */
  private static showAgentAnalysisError(errorDetails: string): void {
    try {
      const safeErrorDetails = errorDetails || 'unknown error';
      
      vscode.window.showErrorMessage(
        `Agent analysis failed: ${safeErrorDetails}. The design document may be invalid or the agent service may be unavailable.`,
        'Retry', 'View Logs'
      ).then(
        selection => {
          if (selection === 'View Logs') {
            vscode.commands.executeCommand('workbench.action.output.toggleOutput').then(
              undefined,
              (error: any) => {
                console.error('Failed to open output logs:', error);
              }
            );
          }
        },
        (error: any) => {
          console.error('Error showing agent analysis error notification:', error);
        }
      );
    } catch (error) {
      console.error('Critical error in showAgentAnalysisError:', error);
    }
  }

  /**
   * Displays error notification for configuration write failures
   * @param errorDetails - Detailed error message
   */
  private static showConfigWriteError(errorDetails: string): void {
    try {
      const safeErrorDetails = errorDetails || 'unknown error';
      
      vscode.window.showErrorMessage(
        `Configuration write failed: ${safeErrorDetails}`,
        'Open Settings Folder'
      ).then(
        selection => {
          if (selection === 'Open Settings Folder') {
            try {
              const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
              if (workspaceFolder) {
                const settingsPath = path.join(workspaceFolder.uri.fsPath, '.kiro', 'settings');
                vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(settingsPath)).then(
                  undefined,
                  (error: any) => {
                    console.error('Failed to reveal settings folder:', error);
                    vscode.window.showErrorMessage('Failed to open settings folder');
                  }
                );
              } else {
                vscode.window.showErrorMessage('No workspace folder found');
              }
            } catch (error) {
              console.error('Error opening settings folder:', error);
            }
          }
        },
        (error: any) => {
          console.error('Error showing config write error notification:', error);
        }
      );
    } catch (error) {
      console.error('Critical error in showConfigWriteError:', error);
    }
  }

  /**
   * Loads master servers configuration
   * @param context - Extension context
   * @returns Master servers configuration
   */
  private static async loadMasterServers(
    context: vscode.ExtensionContext
  ): Promise<Record<string, McpServer>> {
    try {
      if (!context || !context.extensionPath) {
        throw new Error('Invalid extension context provided');
      }

      const masterPath = path.join(context.extensionPath, 'config', 'master-servers.json');
      
      if (!masterPath || masterPath.trim() === '') {
        throw new Error('Invalid master servers path');
      }

      // Check if file exists
      try {
        await fs.promises.access(masterPath, fs.constants.R_OK);
      } catch (accessError) {
        throw new Error(`Master servers file not found or not readable: ${masterPath}`);
      }

      // Read file content
      let content: string;
      try {
        content = await fs.promises.readFile(masterPath, 'utf8');
      } catch (readError) {
        const errorMsg = readError instanceof Error ? readError.message : 'Unknown error';
        throw new Error(`Failed to read master servers file: ${errorMsg}`);
      }

      // Validate content is not empty
      if (!content || content.trim() === '') {
        throw new Error('Master servers file is empty');
      }

      // Parse JSON
      let parsed: any;
      try {
        parsed = JSON.parse(content);
      } catch (parseError) {
        const errorMsg = parseError instanceof Error ? parseError.message : 'Unknown error';
        throw new Error(`Failed to parse master servers JSON: ${errorMsg}`);
      }

      // Validate structure
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Master servers file has invalid structure');
      }

      if (!parsed.servers || typeof parsed.servers !== 'object') {
        throw new Error('Master servers file missing "servers" object');
      }

      const servers = parsed.servers;

      // Validate at least one server exists
      if (Object.keys(servers).length === 0) {
        console.warn('Master servers configuration is empty');
      }

      return servers;
    } catch (error) {
      console.error('Failed to load master-servers.json:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.showFileReadError('master-servers.json', errorMsg);
      throw new Error(`Failed to load master servers configuration: ${errorMsg}`);
    }
  }

  /**
   * Loads workspace environment variables
   * @returns Environment variables configuration
   */
  private static async loadWorkspaceEnvVars(): Promise<EnvVarsConfig> {
    const defaultConfig: EnvVarsConfig = {
      version: '1.0.0',
      description: 'Centralized environment variables for MCP servers',
      variables: {},
      notes: {}
    };

    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        console.log('No workspace folder found, using default environment variables');
        return defaultConfig;
      }

      const envPath = path.join(workspaceFolder.uri.fsPath, '.kiro', 'settings', 'env-vars.json');

      if (!envPath || envPath.trim() === '') {
        console.error('Invalid environment variables path');
        return defaultConfig;
      }

      // Check if file exists
      try {
        await fs.promises.access(envPath, fs.constants.R_OK);
      } catch (accessError) {
        console.log('Environment variables file not found, using defaults');
        return defaultConfig;
      }

      // Read file content
      let content: string;
      try {
        content = await fs.promises.readFile(envPath, 'utf8');
      } catch (readError) {
        console.warn('Failed to read environment variables file:', readError);
        return defaultConfig;
      }

      // Validate content
      if (!content || content.trim() === '') {
        console.warn('Environment variables file is empty, using defaults');
        return defaultConfig;
      }

      // Parse JSON
      let parsed: any;
      try {
        parsed = JSON.parse(content);
      } catch (parseError) {
        console.error('Failed to parse environment variables JSON:', parseError);
        return defaultConfig;
      }

      // Validate structure
      if (!parsed || typeof parsed !== 'object') {
        console.error('Environment variables file has invalid structure');
        return defaultConfig;
      }

      // Ensure required fields exist
      const config: EnvVarsConfig = {
        version: parsed.version || defaultConfig.version,
        description: parsed.description || defaultConfig.description,
        variables: parsed.variables && typeof parsed.variables === 'object' ? parsed.variables : {},
        notes: parsed.notes && typeof parsed.notes === 'object' ? parsed.notes : {}
      };

      return config;
    } catch (error) {
      console.error('Unexpected error loading environment variables:', error);
      return defaultConfig;
    }
  }

  /**
   * Merges environment variables into server configuration
   * @param server - Server configuration
   * @param envVars - Environment variables
   * @returns Server configuration with merged environment variables
   */
  private static mergeEnvironmentVariables(
    server: McpServer,
    envVars: Record<string, string>
  ): McpServer {
    try {
      if (!server || typeof server !== 'object') {
        console.error('Invalid server configuration provided to mergeEnvironmentVariables');
        return server;
      }

      if (!envVars || typeof envVars !== 'object') {
        console.warn('Invalid environment variables provided, using server defaults');
        envVars = {};
      }

      // If server has no environment variables, return as-is
      if (!server.env || typeof server.env !== 'object' || Object.keys(server.env).length === 0) {
        return server;
      }

      // Create deep copy to avoid mutations
      const mergedServer = { ...server };
      mergedServer.env = { ...server.env };

      for (const [key, defaultValue] of Object.entries(server.env)) {
        try {
          if (!key || typeof key !== 'string') {
            console.warn('Invalid environment variable key:', key);
            continue;
          }

          if (typeof defaultValue !== 'string') {
            console.warn(`Environment variable ${key} has non-string default value`);
            mergedServer.env[key] = String(defaultValue);
            continue;
          }

          // Check if environment variable is provided and not empty
          if (envVars[key] && typeof envVars[key] === 'string' && envVars[key].trim() !== '') {
            mergedServer.env[key] = envVars[key];
          } else {
            // Clean up default value
            const cleanedValue = defaultValue.replace(/^Default:\s*/, '').replace(/\r$/, '');
            mergedServer.env[key] = cleanedValue;
          }
        } catch (error) {
          console.error(`Error processing environment variable ${key}:`, error);
          // Keep the original default value
          mergedServer.env[key] = defaultValue;
        }
      }

      return mergedServer;
    } catch (error) {
      console.error('Unexpected error in mergeEnvironmentVariables:', error);
      return server;
    }
  }

  /**
   * Loads workspace MCP configuration
   * @returns Current workspace MCP configuration
   */
  private static async loadWorkspaceMcpConfig(): Promise<McpConfig> {
    const defaultConfig: McpConfig = { mcpServers: {} };

    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        return defaultConfig;
      }

      const mcpPath = path.join(workspaceFolder.uri.fsPath, '.kiro', 'settings', 'mcp.json');

      // Check if file exists
      try {
        await fs.promises.access(mcpPath, fs.constants.R_OK);
      } catch (accessError) {
        return defaultConfig;
      }

      // Read and parse file
      const content = await fs.promises.readFile(mcpPath, 'utf8');
      const parsed = JSON.parse(content);

      if (!parsed || typeof parsed !== 'object') {
        return defaultConfig;
      }

      return {
        mcpServers: parsed.mcpServers && typeof parsed.mcpServers === 'object' ? parsed.mcpServers : {}
      };
    } catch (error) {
      console.error('Error loading workspace MCP config:', error);
      return defaultConfig;
    }
  }

  /**
   * Saves workspace MCP configuration
   * @param config - MCP configuration to save
   */
  private static async saveWorkspaceMcpConfig(config: McpConfig): Promise<void> {
    try {
      // Validate input
      if (!config || typeof config !== 'object') {
        throw new Error('Invalid MCP configuration provided');
      }

      if (!config.mcpServers || typeof config.mcpServers !== 'object') {
        throw new Error('MCP configuration missing mcpServers object');
      }

      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        this.showConfigWriteError('No workspace folder found. Please open a workspace to save MCP configuration.');
        throw new Error('No workspace folder found');
      }

      const mcpPath = path.join(workspaceFolder.uri.fsPath, '.kiro', 'settings', 'mcp.json');

      if (!mcpPath || mcpPath.trim() === '') {
        throw new Error('Invalid MCP configuration path');
      }

      // Ensure directory exists
      const dir = path.dirname(mcpPath);
      if (!dir || dir.trim() === '') {
        throw new Error('Invalid directory path for MCP configuration');
      }

      try {
        await fs.promises.mkdir(dir, { recursive: true });
      } catch (mkdirError) {
        const errorMsg = mkdirError instanceof Error ? mkdirError.message : 'Unknown error';
        throw new Error(`Failed to create settings directory: ${errorMsg}`);
      }

      // Serialize configuration
      let configJson: string;
      try {
        configJson = JSON.stringify(config, null, 2);
      } catch (jsonError) {
        const errorMsg = jsonError instanceof Error ? jsonError.message : 'Unknown error';
        throw new Error(`Failed to serialize MCP configuration: ${errorMsg}`);
      }

      // Validate serialized content
      if (!configJson || configJson.trim() === '') {
        throw new Error('Serialized MCP configuration is empty');
      }

      // Write configuration file atomically
      try {
        await fs.promises.writeFile(mcpPath, configJson, { encoding: 'utf8', flag: 'w' });
      } catch (writeError) {
        const errorMsg = writeError instanceof Error ? writeError.message : 'Unknown error';
        throw new Error(`Failed to write MCP configuration file: ${errorMsg}`);
      }

      // Verify the file was written correctly
      try {
        const writtenContent = await fs.promises.readFile(mcpPath, 'utf8');
        const parsedConfig = JSON.parse(writtenContent);
        
        if (!parsedConfig.mcpServers || typeof parsedConfig.mcpServers !== 'object') {
          throw new Error('MCP configuration verification failed: invalid structure');
        }

        const writtenServerCount = Object.keys(parsedConfig.mcpServers).length;
        const expectedServerCount = Object.keys(config.mcpServers).length;
        
        if (writtenServerCount !== expectedServerCount) {
          throw new Error(`MCP configuration verification failed: expected ${expectedServerCount} servers, found ${writtenServerCount}`);
        }
      } catch (verifyError) {
        console.error('Failed to verify written MCP configuration:', verifyError);
        // Don't fail the operation - file might still be usable
      }
    } catch (error) {
      console.error('Failed to save MCP config:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.showConfigWriteError(`Failed to write mcp.json: ${errorMsg}. Check file permissions and disk space.`);
      throw new Error(`Failed to write mcp.json: ${errorMsg}`);
    }
  }
}
