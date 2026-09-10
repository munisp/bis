import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getPgPool } from "./db";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc";
import { assertActiveConsumerConsent } from "./consumerGovernance";

const SYNTHETIC_NOTICE = "SYNTHETIC DEMONSTRATION DATA — NOT A REAL PERSON";
const NIGERIA = "NG";

const purposeSchema = z.enum([
  "self",
  "personal_safety",
  "fraud_prevention",
  "account_security",
  "compliance_investigation",
  "legal_authority",
]);

const searchSchema = z.object({
  mode: z.enum(["consumer", "institutional"]),
  purpose: purposeSchema,
  consentConfirmed: z.literal(true),
  countryCode: z.literal(NIGERIA).default(NIGERIA),
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().min(5).max(32).optional(),
  email: z.string().trim().email().max(254).optional(),
  address: z.string().trim().min(3).max(240).optional(),
  limit: z.number().int().min(1).max(20).default(10),
}).superRefine((value, ctx) => {
  if (!value.name && !value.phone && !value.email && !value.address) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide a name, phone, email, or address search term" });
  }
});

type SearchInput = z.infer<typeof searchSchema>;

type ProfileRow = {
  id: string;
  profile_ref: string;
  dataset_origin: string;
  synthetic_notice: string;
  country_code: string;
  jurisdiction_code: string;
  state_or_region: string | null;
  city_or_locality: string | null;
  given_name: string;
  middle_name: string | null;
  family_name: string;
  aliases: unknown;
  date_of_birth: string | null;
  normalized_phone: string | null;
  normalized_email: string | null;
  address_line: string | null;
  postal_code: string | null;
  occupation: string | null;
  education_history: unknown;
  public_profile_urls: unknown;
  source_observed_at: string;
  expires_at: string | null;
};

function normalizePhone(value: string): string {
  return value.replace(/[^0-9+]/g, "");
}

function requireDeclaredPurpose(input: SearchInput, role: string | null | undefined): void {
  const consumerPurposes = new Set(["self", "personal_safety", "fraud_prevention"]);
  if (input.mode === "consumer" && !consumerPurposes.has(input.purpose)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Consumer discovery is limited to self, personal-safety, and fraud-prevention purposes.",
    });
  }
  if (input.mode === "institutional" && !["admin", "analyst", "investigator", "compliance_officer"].includes(role ?? "")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "The selected institutional purpose requires an authorized investigation or compliance role.",
    });
  }
}

async function poolOrThrow() {
  const pool = await getPgPool();
  if (!pool) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "PostgreSQL is unavailable" });
  return pool;
}

function publicProfile(row: ProfileRow) {
  return {
    profileRef: row.profile_ref,
    countryCode: row.country_code,
    jurisdictionCode: row.jurisdiction_code,
    name: [row.given_name, row.middle_name, row.family_name].filter(Boolean).join(" "),
    aliases: row.aliases,
    location: {
      stateOrRegion: row.state_or_region,
      cityOrLocality: row.city_or_locality,
      addressLine: row.address_line,
      postalCode: row.postal_code,
    },
    contact: { phone: row.normalized_phone, email: row.normalized_email },
    dateOfBirth: row.date_of_birth,
    occupation: row.occupation,
    educationHistory: row.education_history,
    publicProfileUrls: row.public_profile_urls,
    provenance: {
      datasetOrigin: row.dataset_origin,
      isSynthetic: true,
      notice: row.synthetic_notice,
      observedAt: row.source_observed_at,
      expiresAt: row.expires_at,
    },
  };
}

async function recordLookup(pool: Awaited<ReturnType<typeof poolOrThrow>>, values: {
  actorUserId: number;
  tenantId: number | null;
  mode: SearchInput["mode"];
  purpose: SearchInput["purpose"];
  queryFingerprint: string;
  resultCount: number;
}) {
  await pool.query(
    `INSERT INTO consumer_lookup_access
       (actor_user_id, tenant_id, lookup_mode, purpose, query_fingerprint, result_count, dataset_origin)
     VALUES ($1, $2, $3, $4, $5, $6, 'synthetic_demo')`,
    [values.actorUserId, values.tenantId, values.mode, values.purpose, values.queryFingerprint, values.resultCount],
  );
}

export const consumerIntelligenceRouter = router({
  search: protectedProcedure.input(searchSchema).query(async ({ ctx, input }) => {
    requireDeclaredPurpose(input, ctx.user.role);
    await assertActiveConsumerConsent({ userId: ctx.user.id, purpose: input.purpose, mode: input.mode });
    const pool = await poolOrThrow();
    const queryTerms: string[] = [];
    const params: unknown[] = [input.countryCode];
    const filters: string[] = ["country_code = $1", "record_status = 'active'", "dataset_origin = 'synthetic_demo'"];

    if (input.name) {
      params.push(`%${input.name.replace(/[%_\\]/g, "\\$&")}%`);
      filters.push(`concat_ws(' ', given_name, middle_name, family_name) ILIKE $${params.length} ESCAPE '\\'`);
      queryTerms.push(`name:${input.name.toLowerCase()}`);
    }
    if (input.phone) {
      const phone = normalizePhone(input.phone);
      params.push(phone);
      filters.push(`normalized_phone = $${params.length}`);
      queryTerms.push(`phone:${phone}`);
    }
    if (input.email) {
      const email = input.email.toLowerCase();
      params.push(email);
      filters.push(`normalized_email = $${params.length}`);
      queryTerms.push(`email:${email}`);
    }
    if (input.address) {
      params.push(`%${input.address.replace(/[%_\\]/g, "\\$&")}%`);
      filters.push(`address_line ILIKE $${params.length} ESCAPE '\\'`);
      queryTerms.push(`address:${input.address.toLowerCase()}`);
    }
    params.push(input.limit);

    const result = await pool.query<ProfileRow>(
      `SELECT id, profile_ref, dataset_origin, synthetic_notice, country_code, jurisdiction_code,
              state_or_region, city_or_locality, given_name, middle_name, family_name, aliases,
              date_of_birth, normalized_phone, normalized_email, address_line, postal_code,
              occupation, education_history, public_profile_urls, source_observed_at, expires_at
       FROM consumer_discovery_profiles
       WHERE ${filters.join(" AND ")}
       ORDER BY family_name ASC, given_name ASC, profile_ref ASC
       LIMIT $${params.length}`,
      params,
    );

    const fingerprint = createHash("sha256")
      .update(`${input.mode}|${input.purpose}|${queryTerms.sort().join("|")}`)
      .digest("hex");
    await recordLookup(pool, {
      actorUserId: ctx.user.id,
      tenantId: ctx.tenantId,
      mode: input.mode,
      purpose: input.purpose,
      queryFingerprint: fingerprint,
      resultCount: result.rows.length,
    });

    return {
      countryCode: NIGERIA,
      datasetOrigin: "synthetic_demo" as const,
      isSynthetic: true,
      notice: SYNTHETIC_NOTICE,
      declaredPurpose: input.purpose,
      results: result.rows.map(publicProfile),
    };
  }),

  getProfile: protectedProcedure.input(z.object({
    profileRef: z.string().regex(/^BIS-NG-DEMO-[0-9]{4}$/),
    purpose: purposeSchema,
    mode: z.enum(["consumer", "institutional"]),
    consentConfirmed: z.literal(true),
  })).query(async ({ ctx, input }) => {
    requireDeclaredPurpose({ ...input, countryCode: NIGERIA, limit: 1 }, ctx.user.role);
    await assertActiveConsumerConsent({ userId: ctx.user.id, purpose: input.purpose, mode: input.mode });
    const pool = await poolOrThrow();
    const profileResult = await pool.query<ProfileRow>(
      `SELECT id, profile_ref, dataset_origin, synthetic_notice, country_code, jurisdiction_code,
              state_or_region, city_or_locality, given_name, middle_name, family_name, aliases,
              date_of_birth, normalized_phone, normalized_email, address_line, postal_code,
              occupation, education_history, public_profile_urls, source_observed_at, expires_at
       FROM consumer_discovery_profiles
       WHERE profile_ref = $1 AND country_code = 'NG' AND record_status = 'active' AND dataset_origin = 'synthetic_demo'`,
      [input.profileRef],
    );
    const profile = profileResult.rows[0];
    if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "No active synthetic Nigeria profile was found" });

    const [provenance, links] = await Promise.all([
      pool.query<{
        field_name: string; source_name: string; source_record_ref: string; source_kind: string;
        collected_at: string; valid_until: string | null; confidence_score: string; evidence_summary: string;
      }>(
        `SELECT field_name, source_name, source_record_ref, source_kind, collected_at, valid_until, confidence_score, evidence_summary
         FROM consumer_record_provenance WHERE profile_id = $1 AND is_synthetic = TRUE ORDER BY field_name, collected_at DESC`,
        [profile.id],
      ),
      pool.query<{
        relationship_type: string; linkage_method: string; confidence_score: string; evidence: unknown; profile_ref: string;
        given_name: string; middle_name: string | null; family_name: string;
      }>(
        `SELECT l.relationship_type, l.linkage_method, l.confidence_score, l.evidence,
                p.profile_ref, p.given_name, p.middle_name, p.family_name
         FROM consumer_record_links l
         JOIN consumer_discovery_profiles p ON p.id = l.related_profile_id
         WHERE l.profile_id = $1 AND l.review_status = 'confirmed' AND p.record_status = 'active'
         ORDER BY l.confidence_score DESC, p.profile_ref ASC`,
        [profile.id],
      ),
    ]);

    await recordLookup(pool, {
      actorUserId: ctx.user.id,
      tenantId: ctx.tenantId,
      mode: input.mode,
      purpose: input.purpose,
      queryFingerprint: createHash("sha256").update(`profile:${input.profileRef}|${input.purpose}|${input.mode}`).digest("hex"),
      resultCount: 1,
    });

    return {
      ...publicProfile(profile),
      fieldProvenance: provenance.rows.map(row => ({
        fieldName: row.field_name,
        sourceName: row.source_name,
        sourceRecordRef: row.source_record_ref,
        sourceKind: row.source_kind,
        collectedAt: row.collected_at,
        validUntil: row.valid_until,
        confidenceScore: Number(row.confidence_score),
        evidenceSummary: row.evidence_summary,
        isSynthetic: true,
      })),
      relatedProfiles: links.rows.map(row => ({
        profileRef: row.profile_ref,
        name: [row.given_name, row.middle_name, row.family_name].filter(Boolean).join(" "),
        relationshipType: row.relationship_type,
        linkageMethod: row.linkage_method,
        confidenceScore: Number(row.confidence_score),
        evidence: row.evidence,
      })),
    };
  }),

  seedSyntheticNigeriaFixtures: adminProcedure.input(z.object({
    confirmation: z.literal("SEED_SYNTHETIC_NIGERIA_FIXTURES"),
  })).mutation(async ({ input }) => {
    if (process.env.BIS_ALLOW_SYNTHETIC_FIXTURES !== "true") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Synthetic fixtures require BIS_ALLOW_SYNTHETIC_FIXTURES=true and are never a provider-data substitute.",
      });
    }
    if (process.env.NODE_ENV === "production") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Synthetic fixture seeding is disabled in production" });
    }
    const pool = await poolOrThrow();
    const fixtures = [
      {
        profileRef: "BIS-NG-DEMO-0001", givenName: "Amara", middleName: "Chinwe", familyName: "Demo-Okafor",
        aliases: ["Amara Okafor"], state: "Lagos", city: "Ikeja", dob: "1992-04-18", phone: "+2340000000001",
        email: "amara.demo-okafor@example.test", address: "12 Demonstration Crescent, Ikeja", postalCode: "100271",
        occupation: "Synthetic records analyst", education: ["Demonstration Polytechnic"], profiles: ["https://example.test/profiles/amara-demo-okafor"],
      },
      {
        profileRef: "BIS-NG-DEMO-0002", givenName: "Chinedu", middleName: null, familyName: "Sample-Adeyemi",
        aliases: ["Chinedu Adeyemi"], state: "Lagos", city: "Ikeja", dob: "1988-11-02", phone: "+2340000000002",
        email: "chinedu.sample-adeyemi@example.test", address: "12 Demonstration Crescent, Ikeja", postalCode: "100271",
        occupation: "Synthetic logistics coordinator", education: ["Demonstration Technical College"], profiles: ["https://example.test/profiles/chinedu-sample-adeyemi"],
      },
      {
        profileRef: "BIS-NG-DEMO-0003", givenName: "Zainab", middleName: "Amina", familyName: "Fixture-Bello",
        aliases: ["Zainab Bello"], state: "Kano", city: "Nassarawa", dob: "1995-07-26", phone: "+2340000000003",
        email: "zainab.fixture-bello@example.test", address: "8 Example Road, Nassarawa", postalCode: "700221",
        occupation: "Synthetic public records researcher", education: ["Demonstration University"], profiles: ["https://example.test/profiles/zainab-fixture-bello"],
      },
    ] as const;
    const fixtureChecksum = createHash("sha256").update(JSON.stringify(fixtures)).digest("hex");

    await pool.query("BEGIN");
    try {
      for (const fixture of fixtures) {
        await pool.query(
          `INSERT INTO consumer_discovery_profiles
           (profile_ref, country_code, jurisdiction_code, state_or_region, city_or_locality,
            given_name, middle_name, family_name, aliases, date_of_birth, normalized_phone,
            normalized_email, address_line, postal_code, occupation, education_history, public_profile_urls)
           VALUES ($1, 'NG', 'NG', $2, $3, $4, $5, $6, $7::jsonb, $8::date, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb)
           ON CONFLICT (profile_ref) DO UPDATE SET
             state_or_region = EXCLUDED.state_or_region, city_or_locality = EXCLUDED.city_or_locality,
             aliases = EXCLUDED.aliases, date_of_birth = EXCLUDED.date_of_birth,
             normalized_phone = EXCLUDED.normalized_phone, normalized_email = EXCLUDED.normalized_email,
             address_line = EXCLUDED.address_line, postal_code = EXCLUDED.postal_code,
             occupation = EXCLUDED.occupation, education_history = EXCLUDED.education_history,
             public_profile_urls = EXCLUDED.public_profile_urls, updated_at = NOW()`,
          [fixture.profileRef, fixture.state, fixture.city, fixture.givenName, fixture.middleName, fixture.familyName,
            JSON.stringify(fixture.aliases), fixture.dob, fixture.phone, fixture.email, fixture.address,
            fixture.postalCode, fixture.occupation, JSON.stringify(fixture.education), JSON.stringify(fixture.profiles)],
        );
      }
      for (const fixture of fixtures) {
        const profile = await pool.query<{ id: string }>("SELECT id FROM consumer_discovery_profiles WHERE profile_ref = $1", [fixture.profileRef]);
        const profileId = profile.rows[0]?.id;
        if (!profileId) throw new Error(`Synthetic fixture ${fixture.profileRef} was not persisted`);
        for (const field of ["name", "phone", "email", "address", "occupation", "education_history"] as const) {
          await pool.query(
            `INSERT INTO consumer_record_provenance
             (profile_id, field_name, source_record_ref, confidence_score, evidence_summary)
             VALUES ($1, $2, $3, 1.0000, 'Deterministic local fixture; not provider-derived data')
             ON CONFLICT DO NOTHING`,
            [profileId, field, `${fixture.profileRef}:${field}`],
          );
        }
      }
      const [amara, chinedu] = await Promise.all([
        pool.query<{ id: string }>("SELECT id FROM consumer_discovery_profiles WHERE profile_ref = 'BIS-NG-DEMO-0001'"),
        pool.query<{ id: string }>("SELECT id FROM consumer_discovery_profiles WHERE profile_ref = 'BIS-NG-DEMO-0002'"),
      ]);
      if (!amara.rows[0] || !chinedu.rows[0]) throw new Error("Synthetic linkage fixture profiles are missing");
      await pool.query(
        `INSERT INTO consumer_record_links
         (profile_id, related_profile_id, relationship_type, linkage_method, confidence_score, evidence, review_status)
         VALUES ($1, $2, 'household', 'shared_address', 1.0000, $3::jsonb, 'confirmed')
         ON CONFLICT (profile_id, related_profile_id, relationship_type, linkage_method)
         DO UPDATE SET confidence_score = EXCLUDED.confidence_score, evidence = EXCLUDED.evidence,
                       review_status = EXCLUDED.review_status, updated_at = NOW()`,
        [amara.rows[0].id, chinedu.rows[0].id, JSON.stringify({ sharedAddress: "12 Demonstration Crescent, Ikeja", synthetic: true })],
      );
      await pool.query(
        `INSERT INTO consumer_synthetic_fixture_runs (fixture_version, fixture_checksum_sha256, profile_count)
         VALUES ('ng-consumer-fixtures-v1', $1, $2)
         ON CONFLICT (fixture_version) DO UPDATE SET fixture_checksum_sha256 = EXCLUDED.fixture_checksum_sha256,
                                                   profile_count = EXCLUDED.profile_count`,
        [fixtureChecksum, fixtures.length],
      );
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
    return { seeded: fixtures.length, countryCode: NIGERIA, synthetic: true, notice: SYNTHETIC_NOTICE };
  }),
});
