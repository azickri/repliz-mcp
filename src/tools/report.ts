/** Report tools: list, get, and retry reports. */

import { z } from "zod";
import { registerTool, type ToolContext } from "./helpers.js";

export function registerReportTools(ctx: ToolContext): void {
  registerTool(
    ctx,
    "repliz_list_reports",
    {
      title: "List Reports",
      effect: "read",
      description:
        "List system and analytics reports. Supports pagination and filtering by type, status, account id(s), and search term.",
      inputSchema: {
        page: z.number().int().min(1).default(1).describe("Page number (1-based)."),
        limit: z.number().int().min(1).max(100).default(20).describe("Items per page."),
        type: z.string().optional().describe("Report type filter."),
        status: z.string().optional().describe("Report status filter."),
        accountIds: z
          .array(z.string())
          .optional()
          .describe("Filter reports to specific connected account id(s)."),
        search: z.string().optional().describe("Search query string."),
      },
    },
    async (args) =>
      ctx.client.get("/public/report", {
        page: args.page,
        limit: args.limit,
        type: args.type,
        status: args.status,
        accountIds: args.accountIds,
        search: args.search,
      })
  );

  registerTool(
    ctx,
    "repliz_get_report",
    {
      title: "Get Report",
      effect: "read",
      description: "Get full details of a single report by its report id.",
      inputSchema: {
        reportId: z.string().describe("The report id."),
      },
    },
    async (args) => ctx.client.get(`/public/report/${encodeURIComponent(args.reportId)}`)
  );

  registerTool(
    ctx,
    "repliz_retry_report",
    {
      title: "Retry Report",
      effect: "additive",
      description: "Retry generating or processing a report that failed or encountered errors.",
      inputSchema: {
        reportId: z.string().describe("The report id to retry."),
      },
    },
    async (args) => ctx.client.put(`/public/report/${encodeURIComponent(args.reportId)}/retry`)
  );
}
