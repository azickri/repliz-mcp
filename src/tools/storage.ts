/**
 * Storage tools: list, get, init upload, upload to presigned URL, complete, and delete files.
 *
 * Upload flow:
 *   1. repliz_init_file       — registers the file and gets a presigned PUT URL + fileId
 *   2. repliz_upload_file     — PUTs the file bytes to the presigned URL (external, no auth)
 *   3. repliz_complete_file   — tells Repliz the upload is done and finalizes the record
 */

import { z } from "zod";
import { registerTool, type ToolContext } from "./helpers.js";
import { maxUploadBytes, requestTimeoutMs } from "../config.js";
import { assertAllowedUploadUrl, assertPublicUrl } from "../net.js";

const FILE_STATUS = ["pending", "success"] as const;

export function registerStorageTools(ctx: ToolContext): void {
  // ─── Statistics ──────────────────────────────────────────────────────────

  registerTool(
    ctx,
    "repliz_get_storage_statistic",
    {
      title: "Get Storage Statistics",
      description:
        "Retrieve storage usage statistics: total files, used bytes, free bytes, and storage limit.",
      inputSchema: {},
    },
    async () => ctx.client.get("/public/storage/statistic")
  );

  // ─── List files ──────────────────────────────────────────────────────────

  registerTool(
    ctx,
    "repliz_list_files",
    {
      title: "List Storage Files",
      description:
        "List uploaded files with pagination and optional filename search. Each file includes id, filename, size, mimetype, url, and status.",
      inputSchema: {
        page: z.number().int().min(1).default(1).describe("Page number (1-based)."),
        limit: z.number().int().min(1).max(100).default(20).describe("Items per page."),
        search: z.string().optional().describe("Filter files by filename (partial match)."),
      },
    },
    async (args) =>
      ctx.client.get("/public/storage/file", {
        page: args.page,
        limit: args.limit,
        search: args.search,
      })
  );

  // ─── Get one file ────────────────────────────────────────────────────────

  registerTool(
    ctx,
    "repliz_get_file",
    {
      title: "Get Storage File",
      description: "Get the full details of a single stored file by its id.",
      inputSchema: {
        fileId: z.string().describe("The file id."),
      },
    },
    async (args) =>
      ctx.client.get(`/public/storage/file/${encodeURIComponent(args.fileId)}`)
  );

  // ─── Step 1: Init upload ─────────────────────────────────────────────────

  registerTool(
    ctx,
    "repliz_init_file",
    {
      title: "Init File Upload",
      description:
        "Step 1 of 3 — Initialize a file upload session.\n\n" +
        "Provide the filename, file size in bytes, and MIME type. " +
        "The response contains:\n" +
        "- `id`     — the fileId used in subsequent steps\n" +
        "- `upload` — the presigned PUT URL to upload the file binary to\n" +
        "- `key`    — the storage object key\n" +
        "- `url`    — the final public URL of the file after upload is complete\n\n" +
        "After this call, use `repliz_upload_file` to push the file, then `repliz_complete_file` to finalize.",
      inputSchema: {
        filename: z.string().describe("Original filename including extension, e.g. 'video.mp4'."),
        size: z
          .number()
          .int()
          .positive()
          .describe("File size in bytes. Must match the actual file you will upload."),
        mimetype: z
          .string()
          .describe(
            "MIME type of the file, e.g. 'video/mp4', 'image/jpeg', 'image/png'."
          ),
      },
    },
    async (args) =>
      ctx.client.post("/public/storage/file/init", {
        filename: args.filename,
        size: args.size,
        mimetype: args.mimetype,
      })
  );

  // ─── Step 2: Upload to presigned URL ────────────────────────────────────

  // Step 2 never touches the local filesystem. This server is shared, so its
  // disk belongs to the operator, not the caller: a path parameter here would
  // let any user read the server's own files and ship them to a URL of their
  // choosing. The file therefore comes from a public URL, the PUT target is
  // pinned to Repliz storage, and the source must resolve to a public address.
  registerTool(
    ctx,
    "repliz_upload_file",
    {
      title: "Upload File to Presigned URL",
      description:
        "Step 2 of 3 — Copy a file from a public URL to the presigned URL returned by `repliz_init_file`.\n\n" +
        "This server runs remotely and has no access to your local disk. Host the file at a publicly " +
        "reachable https URL first, or upload it to the presigned URL yourself with a direct PUT from " +
        "your own machine and skip straight to `repliz_complete_file`.\n\n" +
        "Provide:\n" +
        "- `uploadUrl`  — the `upload` field from `repliz_init_file`, passed through unchanged\n" +
        "- `sourceUrl`  — public http(s) URL of the file to copy\n" +
        "- `mimetype`   — must match exactly what was used in `repliz_init_file`\n\n" +
        "After this succeeds, call `repliz_complete_file` with the fileId to finalize.",
      inputSchema: {
        uploadUrl: z
          .string()
          .url()
          .describe(
            "The presigned PUT URL from the `upload` field of `repliz_init_file`, passed through unchanged."
          ),
        sourceUrl: z
          .string()
          .url()
          .describe("Public http(s) URL of the file to copy, e.g. 'https://example.com/video.mp4'."),
        mimetype: z
          .string()
          .describe("MIME type, must match what was declared in `repliz_init_file`."),
      },
    },
    async (args) => {
      // Validate the destination before fetching anything, so a bad request
      // costs no bandwidth.
      const target = assertAllowedUploadUrl(args.uploadUrl);
      const source = await assertPublicUrl(args.sourceUrl, "sourceUrl");

      const limit = maxUploadBytes();
      const sourceResponse = await fetch(source, {
        redirect: "error", // a redirect could land on a private address
        signal: AbortSignal.timeout(requestTimeoutMs()),
      });
      if (!sourceResponse.ok) {
        throw new Error(
          `Could not fetch sourceUrl: HTTP ${sourceResponse.status} ${sourceResponse.statusText}.`
        );
      }

      const declared = Number(sourceResponse.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > limit) {
        throw new Error(`sourceUrl is ${declared} bytes, over the ${limit}-byte upload limit.`);
      }

      const body = new Uint8Array(await sourceResponse.arrayBuffer());
      if (body.byteLength > limit) {
        throw new Error(
          `sourceUrl returned ${body.byteLength} bytes, over the ${limit}-byte upload limit.`
        );
      }

      const response = await fetch(target, {
        method: "PUT",
        headers: {
          "Content-Type": args.mimetype,
          "Content-Length": String(body.byteLength),
          // Required by the Cloudflare R2 presigned URL (matches x-amz-checksum-crc32 in it).
          "x-amz-checksum-crc32": "AAAAAA==",
          "x-amz-sdk-checksum-algorithm": "CRC32",
        },
        body,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Upload failed with HTTP ${response.status}: ${text}`);
      }

      return {
        success: true,
        status: response.status,
        bytesUploaded: body.byteLength,
        source: args.sourceUrl,
        message:
          "File uploaded successfully to presigned URL. Call `repliz_complete_file` to finalize.",
      };
    }
  );

  // ─── Step 3: Complete upload ─────────────────────────────────────────────

  registerTool(
    ctx,
    "repliz_complete_file",
    {
      title: "Complete File Upload",
      description:
        "Step 3 of 3 — Finalize a file upload after the binary has been PUT to the presigned URL.\n\n" +
        "Provide the `fileId` (the `id` field from `repliz_init_file`). " +
        "On success, the file status changes from `pending` to `success` and is available for use in schedules.",
      inputSchema: {
        fileId: z
          .string()
          .describe("The file id from the `id` field returned by `repliz_init_file`."),
      },
    },
    async (args) =>
      ctx.client.post(
        `/public/storage/file/${encodeURIComponent(args.fileId)}/complete`
      )
  );

  // ─── Delete one file ─────────────────────────────────────────────────────

  registerTool(
    ctx,
    "repliz_delete_file",
    {
      title: "Delete Storage File",
      description:
        "Permanently delete a single file from storage by its id. Irreversible — confirm before calling.",
      inputSchema: {
        fileId: z.string().describe("The file id to delete."),
      },
    },
    async (args) =>
      ctx.client.delete(
        `/public/storage/file/${encodeURIComponent(args.fileId)}`
      )
  );

  // ─── Delete multiple files ────────────────────────────────────────────────

  registerTool(
    ctx,
    "repliz_delete_files",
    {
      title: "Delete Multiple Storage Files",
      description:
        "Permanently delete several files at once by their ids. Irreversible — confirm before calling.",
      inputSchema: {
        fileIds: z
          .array(z.string())
          .min(1)
          .describe("Array of file ids to delete."),
      },
    },
    // fileIds is a query parameter per the API spec (same pattern as repliz_delete_schedules)
    async (args) =>
      ctx.client.delete("/public/storage/file/mass", { fileIds: args.fileIds })
  );
}
