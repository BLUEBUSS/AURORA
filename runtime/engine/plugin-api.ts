export interface OpenClawPluginApi {
  logger: { info: (text: string) => void; warn: (text: string) => void; error: (text: string) => void };
}
export interface OpenClawPluginToolContext { agentId?: string; sessionKey?: string }
