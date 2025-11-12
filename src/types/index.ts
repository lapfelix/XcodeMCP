// Type definitions for XcodeMCP
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface McpContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
}

export type McpResult = CallToolResult;

export interface BuildLogInfo {
  path: string;
  mtime: Date;
}

export interface ParsedBuildResults {
  errors: string[];
  warnings: string[];
  buildStatus?: string;
  errorCount?: number;
  warningCount?: number;
}

export interface EnvironmentValidationResult {
  valid: boolean;
  message?: string;
  recoveryInstructions?: string[];
  degradedMode?: {
    available: boolean;
    limitations?: string[];
  };
  metadata?: Record<string, any>;
}

export interface OverallValidationResult {
  valid: boolean;
  canOperateInDegradedMode: boolean;
  criticalFailures: string[];
  nonCriticalFailures: string[];
}

export interface EnvironmentValidation {
  overall: OverallValidationResult;
  xcode?: EnvironmentValidationResult;
  osascript?: EnvironmentValidationResult;
  xclogparser?: EnvironmentValidationResult;
  permissions?: EnvironmentValidationResult;
  [key: string]: EnvironmentValidationResult | OverallValidationResult | undefined;
}

export interface ToolLimitations {
  blocked: boolean;
  degraded: boolean;
  reason?: string;
  instructions?: string[];
}

export interface JXAScheme {
  name(): string;
}

export interface JXADestination {
  name(): string;
}

export interface JXAWorkspace {
  schemes(): JXAScheme[];
  runDestinations(): JXADestination[];
  activeScheme: JXAScheme;
  activeRunDestination: JXADestination;
  build(): void;
  clean(): JXAActionResult;
  test(options?: { withCommandLineArguments?: string[] }): JXAActionResult;
  run(options?: { withCommandLineArguments?: string[] }): JXAActionResult;
  debug(options?: { scheme?: string; skipBuilding?: boolean }): JXAActionResult;
  stop(): void;
  path(): string;
  name(): string;
  loaded(): boolean;
  close(): void;
}

export interface JXAActionResult {
  id(): string;
  completed(): boolean;
}

export interface JXAApplication {
  activeWorkspaceDocument(): JXAWorkspace | null;
  workspaceDocuments(): JXAWorkspace[];
}

export interface OpenProjectCallback {
  (projectPath: string): Promise<McpResult>;
}

export interface CommonErrorPattern {
  pattern: RegExp;
  message: string;
  guidance?: string;
}

export interface NormalizedName {
  original: string;
  normalized: string;
}

// Child process types for JXA execution
export interface SpawnOptions {
  stdio?: string | string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  uid?: number;
  gid?: number;
  shell?: boolean | string;
}

export interface ChildProcessResult {
  stdout: string;
  stderr: string;
  code: number;
}

// XCResult attachment interface - flexible to handle variations in xcresulttool output
export interface TestAttachment {
  payloadId?: string;
  payload_uuid?: string;
  payloadUUID?: string;
  uniform_type_identifier?: string;
  uniformTypeIdentifier?: string;
  filename?: string;
  name?: string;
  payloadSize?: number;
  payload_size?: number;
  timestamp?: number;
}
