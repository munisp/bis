/**
 * Document Vault Router
 *
 * Provides a platform-wide document management system:
 * - Upload documents to S3 with metadata
 * - Version history per document
 * - Chain-of-custody audit log
 * - Link documents to investigations, SAR filings, cases
 * - Search and filter by category, entity, date
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure, writeProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { caseDocuments, auditLog, investigations, cases } from "../drizzle/schema";
import { desc, eq, sql, and, ilike, or, gte, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { storagePut } from "./storage";

// Document categories for the vault
export const DOCUMENT_CATEGORIES = [
  "identity_document",
  "financial_statement",
  "court_order",
  "regulatory_filing",
  "sar_support",
  "investigation_evidence",
  "kyc_document",
  "aml_report",
  "correspondence",
  "contract",
  "other",
] as const;

export const documentVaultRouter = router({
  /**
   * List all documents in the vault with filtering and pagination.
   */
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      category: z.string().optional(),
      caseId: z.number().optional(),
      investigationId: z.number().optional(),
      confidential: z.boolean().optional(),
      startDate: z.string().optional(), // ISO date string
      endDate: z.string().optional(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions: ReturnType<typeof eq>[] = [];

      if (input.caseId) {
        conditions.push(eq(caseDocuments.caseId, input.caseId));
      }
      if (input.category) {
        conditions.push(eq(caseDocuments.category, input.category));
      }
      if (input.confidential !== undefined) {
        conditions.push(eq(caseDocuments.confidential, input.confidential));
      }
      if (input.search) {
        conditions.push(
          or(
            ilike(caseDocuments.filename, `%${input.search}%`),
            ilike(caseDocuments.description, `%${input.search}%`)
          )!
        );
      }
      if (input.startDate) {
        conditions.push(gte(caseDocuments.createdAt, new Date(input.startDate)));
      }
      if (input.endDate) {
        conditions.push(lt(caseDocuments.createdAt, new Date(input.endDate)));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [docs, [countRow]] = await Promise.all([
        db.select().from(caseDocuments)
          .where(where)
          .orderBy(desc(caseDocuments.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ count: sql<number>`count(*)` }).from(caseDocuments).where(where),
      ]);

      return {
        documents: docs,
        total: Number(countRow?.count ?? 0),
        limit: input.limit,
        offset: input.offset,
      };
    }),

  /**
   * Get a single document by ID with its custody chain.
   */
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [doc] = await db.select().from(caseDocuments)
        .where(eq(caseDocuments.id, input.id))
        .limit(1);

      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });

      // Get custody chain from audit log
      const custodyChain = await db.select().from(auditLog)
        .where(and(
          eq(auditLog.category, "system"),
          eq(auditLog.targetRef, `doc-${input.id}`)
        ))
        .orderBy(desc(auditLog.createdAt))
        .limit(50);

      return { document: doc, custodyChain };
    }),

  /**
   * Upload a document to the vault.
   * The client base64-encodes the file and sends it here;
   * the server stores it in S3 and records metadata.
   */
  upload: writeProcedure
    .input(z.object({
      filename: z.string().min(1).max(300),
      mimeType: z.string().max(100),
      base64Content: z.string(), // base64-encoded file content
      sizeBytes: z.number().min(0).max(50 * 1024 * 1024), // 50 MB max
      category: z.enum(DOCUMENT_CATEGORIES).default("other"),
      description: z.string().max(2000).optional(),
      confidential: z.boolean().default(false),
      caseId: z.number().optional(),
      investigationId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Decode base64 and upload to S3
      const buffer = Buffer.from(input.base64Content, "base64");

      // Magic-byte validation: verify actual file header matches declared MIME type
      const magicBytes = buffer.slice(0, 8);
      const VAULT_MAGIC: Record<string, number[][]> = {
        'application/pdf':  [[0x25, 0x50, 0x44, 0x46]],
        'image/png':        [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
        'image/jpeg':       [[0xFF, 0xD8, 0xFF]],
        'image/jpg':        [[0xFF, 0xD8, 0xFF]],
        'application/msword': [[0xD0, 0xCF, 0x11, 0xE0]],
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [[0x50, 0x4B, 0x03, 0x04]],
        'application/vnd.ms-excel': [[0xD0, 0xCF, 0x11, 0xE0]],
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [[0x50, 0x4B, 0x03, 0x04]],
        'text/plain': [],
        'application/json': [],
        'text/csv': [],
      };
      const expectedMagics = VAULT_MAGIC[input.mimeType];
      if (expectedMagics && expectedMagics.length > 0) {
        const matches = expectedMagics.some(magic =>
          magic.every((byte, i) => magicBytes[i] === byte)
        );
        if (!matches) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'File content does not match declared MIME type (magic-byte mismatch)' });
        }
      }

      const suffix = Math.random().toString(36).slice(2, 10);
      const ext = input.filename.split(".").pop() ?? "bin";
      const fileKey = `vault/${input.category}/${Date.now()}-${suffix}.${ext}`;

      const { url } = await storagePut(fileKey, buffer, input.mimeType);

      // Resolve caseId — if investigationId provided but no caseId, try to find linked case
      let resolvedCaseId = input.caseId;
      if (!resolvedCaseId && input.investigationId) {
        // cases.investigationRefs is a JSON array of investigation ID strings
        const allCasesForInv = await db.select({ id: cases.id, investigationRefs: cases.investigationRefs }).from(cases);
        const linkedCase = allCasesForInv.find(c =>
          Array.isArray(c.investigationRefs) &&
          c.investigationRefs.some((ref: string) => ref === String(input.investigationId))
        );
        resolvedCaseId = linkedCase?.id;
      }

      // If still no caseId, use a default "vault" case (id=1) or create a placeholder
      if (!resolvedCaseId) {
        // Use the first available case as a container, or throw
        const [firstCase] = await db.select({ id: cases.id }).from(cases).limit(1);
        if (!firstCase) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Please link document to a case or investigation" });
        }
        resolvedCaseId = firstCase.id;
      }

      const [doc] = await db.insert(caseDocuments).values({
        caseId: resolvedCaseId,
        filename: input.filename,
        mimeType: input.mimeType,
        fileKey,
        url,
        sizeBytes: input.sizeBytes,
        category: input.category,
        description: input.description,
        confidential: input.confidential,
        uploadedBy: ctx.user.id,
      }).returning();

      // Record custody event
      await db.insert(auditLog).values({
        userId: ctx.user.id,
        category: "system",
        action: "document_uploaded",
        targetRef: `doc-${doc.id}`,
        detail: {
          filename: input.filename,
          category: input.category,
          caseId: resolvedCaseId,
          investigationId: input.investigationId,
          sizeBytes: input.sizeBytes,
        },
      });

      return doc;
    }),

  /**
   * Update document metadata (description, category, confidential flag).
   */
  update: writeProcedure
    .input(z.object({
      id: z.number(),
      description: z.string().max(2000).optional(),
      category: z.enum(DOCUMENT_CATEGORIES).optional(),
      confidential: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [doc] = await db.select().from(caseDocuments)
        .where(eq(caseDocuments.id, input.id)).limit(1);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });

      const updates: Partial<typeof doc> = {};
      if (input.description !== undefined) updates.description = input.description;
      if (input.category !== undefined) updates.category = input.category;
      if (input.confidential !== undefined) updates.confidential = input.confidential;

      await db.update(caseDocuments).set(updates).where(eq(caseDocuments.id, input.id));

      await db.insert(auditLog).values({
        userId: ctx.user.id,
        category: "system",
        action: "document_updated",
        targetRef: `doc-${input.id}`,
        detail: updates as Record<string, unknown>,
      });

      return { success: true };
    }),

  /**
   * Delete a document (admin only — records custody event before deletion).
   */
  delete: adminProcedure
    .input(z.object({ id: z.number(), reason: z.string().min(1).max(500) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [doc] = await db.select().from(caseDocuments)
        .where(eq(caseDocuments.id, input.id)).limit(1);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });

      // Record deletion in custody chain BEFORE deleting
      await db.insert(auditLog).values({
        userId: ctx.user.id,
        category: "system",
        action: "document_deleted",
        targetRef: `doc-${input.id}`,
        detail: {
          filename: doc.filename,
          fileKey: doc.fileKey,
          reason: input.reason,
          deletedAt: new Date().toISOString(),
        },
      });

      await db.delete(caseDocuments).where(eq(caseDocuments.id, input.id));

      return { success: true };
    }),

  /**
   * Get document vault statistics.
   */
  stats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    const [totalRow] = await db.select({ count: sql<number>`count(*)` }).from(caseDocuments);
    const [sizeRow] = await db.select({ total: sql<number>`coalesce(sum("sizeBytes"), 0)` }).from(caseDocuments);
    const [confidentialRow] = await db.select({ count: sql<number>`count(*)` })
      .from(caseDocuments).where(eq(caseDocuments.confidential, true));

    // By category
    const byCat = await db.select({
      category: caseDocuments.category,
      count: sql<number>`count(*)`,
    }).from(caseDocuments).groupBy(caseDocuments.category);

    // Recent uploads (last 7 days)
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [recentRow] = await db.select({ count: sql<number>`count(*)` })
      .from(caseDocuments).where(gte(caseDocuments.createdAt, weekAgo));

    return {
      total: Number(totalRow?.count ?? 0),
      totalSizeBytes: Number(sizeRow?.total ?? 0),
      confidential: Number(confidentialRow?.count ?? 0),
      recentUploads: Number(recentRow?.count ?? 0),
      byCategory: byCat.map(r => ({ category: r.category ?? "other", count: Number(r.count) })),
    };
  }),

  /**
   * Get the full custody chain for a document.
   */
  getCustodyChain: protectedProcedure
    .input(z.object({ documentId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const chain = await db.select().from(auditLog)
        .where(and(
          eq(auditLog.category, "system"),
          eq(auditLog.targetRef, `doc-${input.documentId}`)
        ))
        .orderBy(auditLog.createdAt);

      return chain;
    }),

  /**
   * Get documents linked to a specific investigation.
   */
  listByInvestigation: protectedProcedure
    .input(z.object({ investigationId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Find cases linked to this investigation (investigationRefs is a JSON array of refs)
      const allCases = await db.select({ id: cases.id, investigationRefs: cases.investigationRefs })
        .from(cases);
      const linkedCases = allCases.filter(c =>
        Array.isArray(c.investigationRefs) &&
        c.investigationRefs.some((ref: string) => ref === String(input.investigationId))
      );

      if (linkedCases.length === 0) return [];

      const caseIds = linkedCases.map(c => c.id);
      const docs = await db.select().from(caseDocuments)
        .where(sql`${caseDocuments.caseId} = ANY(ARRAY[${sql.join(caseIds.map(id => sql`${id}`), sql`, `)}]::int[])`)
        .orderBy(desc(caseDocuments.createdAt));

      return docs;
    }),
});
