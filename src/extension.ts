import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { HookManager } from './hookManager';

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

interface ServerGroup {
    name: string;
    description: string;
    servers: string[];
    icon: string;
}

interface GroupedServers {
    version: string;
    templates: Record<string, ServerGroup>;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Zens MCP Manager is now active!');

    // Ensure env-vars.json exists in workspace
    ensureEnvVarsConfig(context).catch(console.error);

    // Ensure agent hook exists
    HookManager.ensureHook(context).catch(error => {
        console.error('Failed to ensure agent hook:', error);
        // Don't block activation on hook creation failure
    });
    // Check .gitignore for security
    checkGitignoreSecurity().catch(console.error);

    // Create tree data providers
    const groupedProvider = new McpGroupedProvider(context);
    const serversProvider = new McpServersProvider(context);
    const filterProvider = new McpFilterProvider(context, serversProvider);

    vscode.window.registerTreeDataProvider('zenMcpGrouped', groupedProvider);
    vscode.window.registerTreeDataProvider('zenMcpServers', serversProvider);
    vscode.window.registerWebviewViewProvider('zenMcpFilter', filterProvider);

    // Register commands
    const refreshCommand = vscode.commands.registerCommand('zenMcp.refresh', () => {
        groupedProvider.refresh();
        serversProvider.refresh();
        vscode.window.showInformationMessage('MCP Manager refreshed!');
    });

    const loadGroupCommand = vscode.commands.registerCommand('zenMcp.loadGroup', async (item: GroupItem) => {
        const result = await vscode.window.showWarningMessage(
            `Load "${item.group.name}" server group?\n\nThis will clear current MCP servers and load: ${item.group.servers.join(', ')}`,
            { modal: true },
            'Yes, Load Group',
            'Cancel'
        );

        if (result === 'Yes, Load Group') {
            await loadServerGroup(item.group, context);
            groupedProvider.refresh();
            serversProvider.refresh();
            vscode.window.showInformationMessage(`Loaded "${item.group.name}" server group successfully!`);
        }
    });

    const toggleServerCommand = vscode.commands.registerCommand('zenMcp.toggleServer', async (item: ServerItem) => {
        await toggleServer(item.serverId, item.server);
        groupedProvider.refresh();
        serversProvider.refresh();
        const action = item.isActive ? 'removed' : 'added';
        vscode.window.showInformationMessage(`Server "${item.serverId}" ${action}!`);
    });

    const loadRecommendedServersCommand = vscode.commands.registerCommand('zenMcp.loadRecommendedServers', async () => {
        const input = await vscode.window.showInputBox({
            prompt: 'Paste the JSON array of recommended servers from the agent',
            placeHolder: '[{"serverId": "server-name", "reason": "..."}]',
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return 'Please enter a JSON array';
                }
                try {
                    const parsed = JSON.parse(value);
                    if (!Array.isArray(parsed)) {
                        return 'Input must be a JSON array';
                    }
                    return null;
                } catch (error) {
                    return 'Invalid JSON format';
                }
            }
        });

        if (!input) {
            return; // User cancelled
        }

        try {
            const recommendations = JSON.parse(input);
            
            if (recommendations.length === 0) {
                vscode.window.showInformationMessage('No servers recommended');
                return;
            }

            // Show confirmation with server list
            const serverList = recommendations.map((r: any) => `• ${r.serverId}: ${r.reason}`).join('\n');
            const result = await vscode.window.showWarningMessage(
                `Load ${recommendations.length} recommended MCP server(s)?\n\n${serverList}`,
                { modal: true },
                'Yes, Load Servers',
                'Cancel'
            );

            if (result === 'Yes, Load Servers') {
                // Use ServerLoader to load the servers
                const { ServerLoader } = await import('./serverLoader');
                const count = await ServerLoader.loadRecommendedServers(recommendations, context);
                
                if (count > 0) {
                    groupedProvider.refresh();
                    serversProvider.refresh();
                    vscode.window.showInformationMessage(`Successfully loaded ${count} MCP server(s)!`);
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load servers: ${error}`);
        }
    });

    const manageEnvVarsCommand = vscode.commands.registerCommand('zenMcp.manageEnvVars', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder found');
            return;
        }

        const envPath = path.join(workspaceFolder.uri.fsPath, '.kiro', 'settings', 'env-vars.json');

        try {
            // Ensure the file exists by checking and creating if needed
            try {
                await fs.promises.access(envPath);
            } catch {
                // File doesn't exist, create it from template
                const template = await loadEnvVarsTemplate(context);
                await saveWorkspaceEnvVars(template);
            }

            // Open the file for editing
            const document = await vscode.workspace.openTextDocument(envPath);
            await vscode.window.showTextDocument(document);

            vscode.window.showInformationMessage('Edit your environment variables and save the file. Changes will be applied when servers are loaded.');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open env-vars.json: ${error}`);
        }
    });

    context.subscriptions.push(refreshCommand, loadGroupCommand, toggleServerCommand, loadRecommendedServersCommand, manageEnvVarsCommand);
}

export function deactivate() { }

class McpFilterProvider implements vscode.WebviewViewProvider {
    constructor(
        private context: vscode.ExtensionContext,
        private serversProvider: McpServersProvider
    ) { }

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        webviewView.webview.options = {
            enableScripts: true
        };

        webviewView.webview.html = this.getWebviewContent();

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(message => {
            if (message.type === 'filter') {
                this.serversProvider.setFilter(message.text);
            } else if (message.type === 'activeOnly') {
                this.serversProvider.setActiveOnlyFilter(message.active);
            }
        });
    }

    private getWebviewContent(): string {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body {
                        padding: 4px 8px;
                        margin: 0;
                        font-family: var(--vscode-font-family);
                        font-size: var(--vscode-font-size);
                    }
                    .filter-container {
                        display: flex;
                        align-items: center;
                        gap: 6px;
                        margin-bottom: 2px;
                    }
                    .filter-input {
                        flex: 1;
                        padding: 4px 8px;
                        border: 1px solid var(--vscode-input-border);
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border-radius: 2px;
                        font-size: var(--vscode-font-size);
                    }
                    .filter-input:focus {
                        outline: 1px solid var(--vscode-focusBorder);
                        border-color: var(--vscode-focusBorder);
                    }
                    .button {
                        padding: 4px 8px;
                        border: 1px solid var(--vscode-button-border);
                        background: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                        border-radius: 2px;
                        cursor: pointer;
                        font-size: 12px;
                        white-space: nowrap;
                    }
                    .button:hover {
                        background: var(--vscode-button-secondaryHoverBackground);
                    }
                    .button.active {
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                    }
                    .button.active:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                    .button-row {
                        display: flex;
                        gap: 4px;
                        margin-top: 4px;
                    }
                </style>
            </head>
            <body>
                <div class="filter-container">
                    <input 
                        type="text" 
                        class="filter-input" 
                        placeholder="Filter MCP servers..." 
                        id="filterInput"
                    />
                    <button class="button" id="clearButton">Clear</button>
                </div>
                <div class="button-row">
                    <button class="button" id="activeOnlyButton">Active Only</button>
                    <button class="button" id="showAllButton">Show All</button>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    const filterInput = document.getElementById('filterInput');
                    const clearButton = document.getElementById('clearButton');
                    const activeOnlyButton = document.getElementById('activeOnlyButton');
                    const showAllButton = document.getElementById('showAllButton');

                    let debounceTimer;
                    let isActiveOnly = false;
                    
                    function updateButtonStates() {
                        if (isActiveOnly) {
                            activeOnlyButton.classList.add('active');
                            showAllButton.classList.remove('active');
                        } else {
                            activeOnlyButton.classList.remove('active');
                            showAllButton.classList.add('active');
                        }
                    }

                    filterInput.addEventListener('input', (e) => {
                        clearTimeout(debounceTimer);
                        debounceTimer = setTimeout(() => {
                            vscode.postMessage({
                                type: 'filter',
                                text: e.target.value
                            });
                        }, 300);
                    });

                    clearButton.addEventListener('click', () => {
                        filterInput.value = '';
                        vscode.postMessage({
                            type: 'filter',
                            text: ''
                        });
                    });

                    activeOnlyButton.addEventListener('click', () => {
                        isActiveOnly = true;
                        updateButtonStates();
                        vscode.postMessage({
                            type: 'activeOnly',
                            active: true
                        });
                    });

                    showAllButton.addEventListener('click', () => {
                        isActiveOnly = false;
                        updateButtonStates();
                        vscode.postMessage({
                            type: 'activeOnly',
                            active: false
                        });
                    });

                    // Initialize button states
                    updateButtonStates();

                    // Focus the input when the view is shown
                    filterInput.focus();
                </script>
            </body>
            </html>
        `;
    }
}

class McpGroupedProvider implements vscode.TreeDataProvider<GroupItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<GroupItem | undefined | null | void> = new vscode.EventEmitter<GroupItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<GroupItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private context: vscode.ExtensionContext) { }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: GroupItem): vscode.TreeItem {
        return element;
    }

    async getChildren(): Promise<GroupItem[]> {
        try {
            const groupedServers = await loadGroupedServers(this.context);
            return Object.entries(groupedServers.templates).map(([key, group]) =>
                new GroupItem(key, group)
            );
        } catch (error) {
            console.error('Error loading grouped servers:', error);
            return [];
        }
    }
}

class McpServersProvider implements vscode.TreeDataProvider<ServerItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ServerItem | undefined | null | void> = new vscode.EventEmitter<ServerItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ServerItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private filterText: string = '';
    private showActiveOnly: boolean = false;

    constructor(private context: vscode.ExtensionContext) { }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    setFilter(filterText: string): void {
        this.filterText = filterText.toLowerCase();
        this.refresh();
    }

    setActiveOnlyFilter(activeOnly: boolean): void {
        this.showActiveOnly = activeOnly;
        this.refresh();
    }

    getTreeItem(element: ServerItem): vscode.TreeItem {
        return element;
    }

    async getChildren(): Promise<ServerItem[]> {
        try {
            const masterServers = await loadMasterServers(this.context);
            const currentConfig = await loadWorkspaceMcpConfig();

            let servers = Object.entries(masterServers.servers).map(([serverId, server]) =>
                new ServerItem(serverId, server, serverId in currentConfig.mcpServers)
            );

            // Apply active-only filter first
            if (this.showActiveOnly) {
                servers = servers.filter(server => server.isActive);
            }

            // Apply text filter if set
            if (this.filterText) {
                servers = servers.filter(server =>
                    server.serverId.toLowerCase().includes(this.filterText) ||
                    (server.server.description && server.server.description.toLowerCase().includes(this.filterText)) ||
                    (server.server.tags && server.server.tags.some(tag => tag.toLowerCase().includes(this.filterText)))
                );
            }

            return servers;
        } catch (error) {
            console.error('Error loading servers:', error);
            return [];
        }
    }
}

class GroupItem extends vscode.TreeItem {
    constructor(
        public readonly groupId: string,
        public readonly group: ServerGroup
    ) {
        super(group.name, vscode.TreeItemCollapsibleState.None);
        this.tooltip = `${group.description}\nServers: ${group.servers.join(', ')}`;
        this.description = `${group.servers.length} servers`;
        this.iconPath = new vscode.ThemeIcon('symbol-package');
        this.contextValue = 'mcpGroup';
    }
}

class ServerItem extends vscode.TreeItem {
    constructor(
        public readonly serverId: string,
        public readonly server: McpServer,
        public readonly isActive: boolean
    ) {
        super(serverId, vscode.TreeItemCollapsibleState.None);
        this.tooltip = server.description || serverId;
        this.description = isActive ? '✓ Active' : '';
        this.iconPath = new vscode.ThemeIcon(isActive ? 'check' : 'circle-outline');
        this.contextValue = 'mcpServer';
    }
}

async function loadMasterServers(context: vscode.ExtensionContext): Promise<{ servers: Record<string, McpServer> }> {
    const masterPath = path.join(context.extensionPath, 'config', 'master-servers.json');
    const content = await fs.promises.readFile(masterPath, 'utf8');
    return JSON.parse(content);
}

async function loadGroupedServers(context: vscode.ExtensionContext): Promise<GroupedServers> {
    const groupedPath = path.join(context.extensionPath, 'config', 'grouped-servers.json');
    const content = await fs.promises.readFile(groupedPath, 'utf8');
    return JSON.parse(content);
}

async function loadEnvVarsTemplate(context: vscode.ExtensionContext): Promise<EnvVarsConfig> {
    const envPath = path.join(context.extensionPath, 'config', 'env-vars.json');
    const content = await fs.promises.readFile(envPath, 'utf8');
    return JSON.parse(content);
}

async function loadWorkspaceEnvVars(): Promise<EnvVarsConfig> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        // No workspace folder, return empty config
        return {
            version: "1.0.0",
            description: "Centralized environment variables for MCP servers",
            variables: {},
            notes: {}
        };
    }

    const envPath = path.join(workspaceFolder.uri.fsPath, '.kiro', 'settings', 'env-vars.json');

    try {
        const content = await fs.promises.readFile(envPath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        // Return empty config if file doesn't exist or can't be read
        return {
            version: "1.0.0",
            description: "Centralized environment variables for MCP servers",
            variables: {},
            notes: {}
        };
    }
}

async function saveWorkspaceEnvVars(config: EnvVarsConfig): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error('No workspace folder found');
    }

    const envPath = path.join(workspaceFolder.uri.fsPath, '.kiro', 'settings', 'env-vars.json');

    // Ensure directory exists
    const dir = path.dirname(envPath);
    try {
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(envPath, JSON.stringify(config, null, 2));
    } catch (error) {
        console.error('Failed to save env vars config:', error);
        throw error;
    }
}

async function ensureEnvVarsConfig(context: vscode.ExtensionContext): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        return; // No workspace, can't create config
    }

    const envPath = path.join(workspaceFolder.uri.fsPath, '.kiro', 'settings', 'env-vars.json');

    try {
        await fs.promises.access(envPath);
        // File exists, we're good
    } catch (error) {
        // File doesn't exist, create it from template
        try {
            const template = await loadEnvVarsTemplate(context);
            await saveWorkspaceEnvVars(template);
            console.log('Created env-vars.json from template');
        } catch (createError) {
            console.error('Failed to create env-vars.json:', createError);
        }
    }
}

function mergeEnvironmentVariables(server: McpServer, envVars: Record<string, string>): McpServer {
    if (!server.env || Object.keys(server.env).length === 0) {
        return server;
    }

    const mergedServer = { ...server };
    mergedServer.env = { ...server.env };

    // Replace environment variables with values from env-vars.json
    for (const [key, defaultValue] of Object.entries(server.env)) {
        if (envVars[key] && envVars[key].trim() !== '') {
            mergedServer.env[key] = envVars[key];
        } else {
            // Keep the default value but clean it up
            mergedServer.env[key] = defaultValue.replace(/^Default:\s*/, '').replace(/\r$/, '');
        }
    }

    return mergedServer;
}

async function loadWorkspaceMcpConfig(): Promise<McpConfig> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        // No workspace folder, return empty config
        return { mcpServers: {} };
    }

    const mcpPath = path.join(workspaceFolder.uri.fsPath, '.kiro', 'settings', 'mcp.json');

    try {
        const content = await fs.promises.readFile(mcpPath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        // Return default config if file doesn't exist or can't be read
        return { mcpServers: {} };
    }
}

async function saveWorkspaceMcpConfig(config: McpConfig): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error('No workspace folder found');
    }

    const mcpPath = path.join(workspaceFolder.uri.fsPath, '.kiro', 'settings', 'mcp.json');

    // Ensure directory exists
    const dir = path.dirname(mcpPath);
    try {
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(mcpPath, JSON.stringify(config, null, 2));
    } catch (error) {
        console.error('Failed to save MCP config:', error);
        throw error;
    }
}

async function loadServerGroup(group: ServerGroup, context: vscode.ExtensionContext): Promise<void> {
    const masterServers = await loadMasterServers(context);
    const envVars = await loadWorkspaceEnvVars();
    const newConfig: McpConfig = { mcpServers: {} };

    for (const serverId of group.servers) {
        if (masterServers.servers[serverId]) {
            const serverWithEnv = mergeEnvironmentVariables(masterServers.servers[serverId], envVars.variables);
            newConfig.mcpServers[serverId] = serverWithEnv;
        }
    }

    await saveWorkspaceMcpConfig(newConfig);
}

async function toggleServer(serverId: string, server: McpServer): Promise<void> {
    const currentConfig = await loadWorkspaceMcpConfig();

    if (serverId in currentConfig.mcpServers) {
        // Remove server
        delete currentConfig.mcpServers[serverId];
    } else {
        // Add server with environment variables
        const envVars = await loadWorkspaceEnvVars();
        const serverWithEnv = mergeEnvironmentVariables(server, envVars.variables);
        currentConfig.mcpServers[serverId] = serverWithEnv;
    }

    await saveWorkspaceMcpConfig(currentConfig);
}

async function checkGitignoreSecurity(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        return; // No workspace, nothing to check
    }

    const gitignorePath = path.join(workspaceFolder.uri.fsPath, '.gitignore');
    const envVarsPath = '.kiro/settings/env-vars.json';
    const mcpPath = '.kiro/settings/mcp.json';
    const settingsFolder = '.kiro/settings';

    try {
        // Check if .gitignore exists
        await fs.promises.access(gitignorePath);
        
        // Read .gitignore content
        const gitignoreContent = await fs.promises.readFile(gitignorePath, 'utf8');
        const lines = gitignoreContent.split('\n').map(line => line.trim());

        // Check if sensitive files are ignored
        const hasEnvVarsIgnore = lines.some(line => 
            line === envVarsPath || 
            line === settingsFolder || 
            line === '.kiro/settings/' ||
            line === '.kiro/settings/*' ||
            line.includes('env-vars.json')
        );

        const hasMcpIgnore = lines.some(line => 
            line === mcpPath || 
            line === settingsFolder || 
            line === '.kiro/settings/' ||
            line === '.kiro/settings/*' ||
            line.includes('mcp.json')
        );

        if (!hasEnvVarsIgnore || !hasMcpIgnore) {
            const result = await vscode.window.showWarningMessage(
                '⚠️ Security Warning: Your .kiro/settings folder contains sensitive configuration files (env-vars.json, mcp.json) that should not be committed to Git.',
                'Add to .gitignore',
                'Ignore Warning'
            );

            if (result === 'Add to .gitignore') {
                await addToGitignore(gitignorePath, settingsFolder);
                vscode.window.showInformationMessage('✓ Added .kiro/settings to .gitignore');
            }
        }
    } catch (error) {
        // .gitignore doesn't exist
        const result = await vscode.window.showWarningMessage(
            '⚠️ Security Warning: No .gitignore file found in your workspace. Your .kiro/settings folder contains sensitive configuration files that should not be committed to Git.',
            'Create .gitignore',
            'Ignore Warning'
        );

        if (result === 'Create .gitignore') {
            await createGitignore(workspaceFolder.uri.fsPath);
            vscode.window.showInformationMessage('✓ Created .gitignore with .kiro/settings excluded');
        }
    }
}

async function createGitignore(workspacePath: string): Promise<void> {
    const gitignorePath = path.join(workspacePath, '.gitignore');
    const content = `# Kiro MCP Manager - Sensitive configuration files
.kiro/settings/
`;
    await fs.promises.writeFile(gitignorePath, content, 'utf8');
}

async function addToGitignore(gitignorePath: string, entry: string): Promise<void> {
    let content = await fs.promises.readFile(gitignorePath, 'utf8');
    
    // Add a newline if the file doesn't end with one
    if (!content.endsWith('\n')) {
        content += '\n';
    }
    
    // Add comment and entry
    content += `\n# Kiro MCP Manager - Sensitive configuration files\n${entry}/\n`;
    
    await fs.promises.writeFile(gitignorePath, content, 'utf8');
}