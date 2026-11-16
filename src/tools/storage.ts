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
      effect: "read",
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
      effect: "read",
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
      effect: "read",
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
      effect: "additive",
      description:
        "Step 1 of 3 — Register a file in Repliz storage and get a presigned URL to upload it to.\n\n" +
        "Provide the filename, the exact size in bytes, and the MIME type. The response contains:\n" +
        "- `id`     — the fileId for `repliz_complete_file`\n" +
        "- `upload` — a presigned PUT URL on Cloudflare R2 (`https://repliz.<account>.r2.cloudflarestorage.com/...`), valid for 600 seconds\n" +
        "- `key`    — the storage object key\n" +
        "- `url`    — the file's public URL once it is completed; use it in schedules\n\n" +
        "There is no file size limit other than the storage left: the bytes go straight to Cloudflare R2 and never " +
        "pass through Repliz's servers.\n\n" +
        "Step 2 sends the bytes to `upload`, one of two ways:\n" +
        "- A file at a public URL: `repliz_upload_file` copies it on the server.\n" +
        "- A file the user attached to the chat, or one you created: PUT it yourself from your code sandbox, e.g. " +
        "`curl -X PUT -H 'Content-Type: <mimetype>' --data-binary @<file> '<upload>'`. Use the URL exactly as returned " +
        "and send no other headers: it is signed for the host only, so an added x-amz-* header fails with 403 SignatureDoesNotMatch.\n\n" +
        "If that PUT fails with 403 and a message that the host is not allowed (an allowlist or proxy error from your " +
        "sandbox, not an XML error from R2), your sandbox blocks the storage host. Do not look for another way around " +
        "the block. Tell the user to allow the host once and then start a new chat:\n" +
        "1. In Claude, open Settings → Capabilities.\n" +
        "2. Under \"Create and edit files\", turn on \"Use the internet while making files\".\n" +
        "3. Choose specific domains, not full internet access, and add the host of the `upload` URL " +
        "(`repliz.2ca853e78c4cd1a89797e3d770c7ca9f.r2.cloudflarestorage.com`).\n" +
        "On Claude Team and Enterprise, an Owner manages this setting. Meanwhile the user can upload the file in the " +
        "Repliz dashboard (Content → Storage, https://repliz.com/user/storage) and share the file's URL.\n\n" +
        "Then call `repliz_complete_file`. A file not completed within 10 minutes of this call is removed " +
        "automatically; after that, start again here.\n\n" +
        "Errors: HTTP 402 \"upgrade to get more storage\" means the file doesn't fit in the storage left, or the " +
        "account has no Storage add-on.",
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
      effect: "additive",
      description:
        "Step 2 of 3 — Copy a file from a public URL to the presigned `upload` URL from `repliz_init_file`. " +
        "This server downloads the file and PUTs it, so the bytes never pass through your sandbox.\n\n" +
        "Use this only for a file already at a publicly reachable http(s) URL. This server runs remotely and " +
        "can't read the user's disk or your sandbox. For a file the user attached to the chat, PUT it to `upload` " +
        "from your sandbox instead, as `repliz_init_file` describes.\n\n" +
        "Provide:\n" +
        "- `uploadUrl`  — the `upload` field from `repliz_init_file`, passed through unchanged\n" +
        "- `sourceUrl`  — public http(s) URL of the file to copy\n" +
        "- `mimetype`   — must match exactly what was used in `repliz_init_file`\n\n" +
        `Limits: this tool copies the file through the Repliz MCP server, so it takes files up to ` +
        `${Math.round(maxUploadBytes() / 1048576)} MB. A bigger file has no size limit when it is PUT straight to ` +
        "`upload` instead. `sourceUrl` must not redirect: share links (Google Drive, Dropbox) usually do, and then " +
        "the call fails with \"fetch failed\". Pass the file's direct download URL instead.\n\n" +
        "Errors: \"Could not fetch sourceUrl\" means the source answered with an error. \"Upload failed with HTTP 403\" " +
        "means the upload URL expired (600 seconds) or was changed: call `repliz_init_file` again.\n\n" +
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

      // Send no x-amz-* headers. The presigned URL is signed for `host` only
      // (X-Amz-SignedHeaders=host); its checksum parameters already live in the
      // signed query string. An x-amz-* header the URL did not sign makes R2
      // reject the PUT with 403 SignatureDoesNotMatch. Content-Type is not
      // signed either, it only sets the stored object's type, the same headers
      // the Repliz web app sends to these URLs.
      const response = await fetch(target, {
        method: "PUT",
        headers: {
          "Content-Type": args.mimetype,
          "Content-Length": String(body.byteLength),
        },
        body,
      });

      if (!response.ok) {
        const text = await response.text();
        const hint =
          response.status === 403
            ? " The presigned URL is valid for 10 minutes and must be passed exactly as " +
              "`repliz_init_file` returned it. If it has expired or was altered, call " +
              "`repliz_init_file` again and use the new `upload` URL."
            : "";
        throw new Error(`Upload failed with HTTP ${response.status}: ${text}${hint}`);
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
      effect: "additive",
      description:
        "Step 3 of 3 — Finalize a file upload after the bytes were PUT to the `upload` URL.\n\n" +
        "Provide the `fileId` (the `id` field from `repliz_init_file`). Repliz checks the stored file, records its " +
        "real size, and changes the status from `pending` to `success`. Its `url` can then be used in schedules.\n\n" +
        "Errors:\n" +
        "- HTTP 400 \"file is invalid or has not been uploaded\": the PUT never reached storage. Check step 2; if the " +
        "PUT from your sandbox failed with 403 because the host is not allowed, `repliz_init_file` says what to tell the user.\n" +
        "- HTTP 404 \"file not found\": the record is gone, usually because more than 10 minutes passed since " +
        "`repliz_init_file`. Start again with `repliz_init_file`.\n" +
        "- HTTP 402 \"upgrade to get more storage\": the uploaded file is bigger than the storage left.",
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
      effect: "destructive",
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
      effect: "destructive",
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
