/** Registers every Repliz tool group onto the MCP server. */

import type { ToolContext } from './helpers.js';
import { registerAccountTools } from './account.js';
import { registerCommentTools } from './comment.js';
import { registerScheduleTools } from './schedule.js';
import { registerChatTools } from './chat.js';
import { registerContentTools } from './content.js';
import { registerResearchTools } from './research.js';
import { registerAddonTools } from './addon.js';
import { registerStorageTools } from './storage.js';
import { registerReportTools } from './report.js';
import { registerAutomationTools } from './automation.js';
import { registerTemplateTools } from './template.js';
import { registerAccountConnectTools } from './account_connect.js';

export function registerAllTools(ctx: ToolContext): void {
  registerAccountTools(ctx);
  registerCommentTools(ctx);
  registerScheduleTools(ctx);
  registerChatTools(ctx);
  registerContentTools(ctx);
  registerResearchTools(ctx);
  registerAddonTools(ctx);
  registerStorageTools(ctx);
  registerReportTools(ctx);
  registerAutomationTools(ctx);
  registerTemplateTools(ctx);
  registerAccountConnectTools(ctx);
}
