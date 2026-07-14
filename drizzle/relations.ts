/**
 * drizzle/relations.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Drizzle Relational Query API — defines all entity relationships so that
 * db.query.investigations.findMany({ with: { alerts: true } }) works.
 */
import { relations } from "drizzle-orm";
import {
  users, tenants, investigations, alerts, kycRecords, auditLog, fieldTasks,
  reports, fieldAgents, dataSources, monitors, screeningRequests, apiKeys,
  webhooks, onboardingApplications, alertRules, ruleEvaluations, apiTokens,
  tokenUsageLog, goamlFilings, cases, caseParties, caseDocuments, caseTimeline,
  caseStakeholders, caseComments, lexAgencies, lexSubmitters, lexSubmissions,
  userSessions, userTotpSecrets, notifications, investigationCaseLinks,
  transactions, amlRules, amlAlerts, sarFilings, evidenceItems,
  kycScheduledReruns, biometricSessionLogs, kycDocuments, kycOcrHistory,
  pushSubscriptions, billingTopups, insiderEvents, uebaProfiles, accessReviews,
  candidateProfiles, screeningPackages, screeningOrders, screeningResults,
  adverseActions, adverseItems, candidateConsents, screeningAssessments,
  fieldVisitReports, criminalRecordRequests, criminalRecords,
  criminalRecordAttachments, criminalRecordAudit, temporalWorkflowState,
  daprEventLog, keycloakSyncLog,
} from "./schema";

// ─── Tenants ──────────────────────────────────────────────────────────────────
export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  investigations: many(investigations),
  cases: many(cases),
  kycRecords: many(kycRecords),
  alerts: many(alerts),
  transactions: many(transactions),
  billingTopups: many(billingTopups),
  apiKeys: many(apiKeys),
  screeningOrders: many(screeningOrders),
  sarFilings: many(sarFilings),
  amlAlerts: many(amlAlerts),
}));

// ─── Users ────────────────────────────────────────────────────────────────────
export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, { fields: [users.tenantId], references: [tenants.id] }),
  sessions: many(userSessions),
  totpSecret: one(userTotpSecrets, { fields: [users.id], references: [userTotpSecrets.userId] }),
  notifications: many(notifications),
  auditLogs: many(auditLog),
  createdInvestigations: many(investigations, { relationName: "investigationCreator" }),
  assignedInvestigations: many(investigations, { relationName: "investigationAssignee" }),
  createdCases: many(cases, { relationName: "caseCreator" }),
  assignedCases: many(cases, { relationName: "caseAssignee" }),
  pushSubscriptions: many(pushSubscriptions),
  keycloakSyncLogs: many(keycloakSyncLog),
}));

export const userSessionsRelations = relations(userSessions, ({ one }) => ({
  user: one(users, { fields: [userSessions.userId], references: [users.id] }),
}));

export const userTotpSecretsRelations = relations(userTotpSecrets, ({ one }) => ({
  user: one(users, { fields: [userTotpSecrets.userId], references: [users.id] }),
}));

// ─── Investigations ───────────────────────────────────────────────────────────
export const investigationsRelations = relations(investigations, ({ one, many }) => ({
  tenant: one(tenants, { fields: [investigations.tenantId], references: [tenants.id] }),
  creator: one(users, { fields: [investigations.createdBy], references: [users.id], relationName: "investigationCreator" }),
  assignee: one(users, { fields: [investigations.assignedTo], references: [users.id], relationName: "investigationAssignee" }),
  alerts: many(alerts),
  kycRecords: many(kycRecords),
  fieldTasks: many(fieldTasks),
  reports: many(reports),
  caseLinks: many(investigationCaseLinks),
  amlAlerts: many(amlAlerts),
  sarFilings: many(sarFilings),
  fieldVisitReports: many(fieldVisitReports),
  criminalRecordRequests: many(criminalRecordRequests),
  temporalWorkflows: many(temporalWorkflowState),
}));

// ─── Alerts ───────────────────────────────────────────────────────────────────
export const alertsRelations = relations(alerts, ({ one }) => ({
  tenant: one(tenants, { fields: [alerts.tenantId], references: [tenants.id] }),
  investigation: one(investigations, { fields: [alerts.investigationId], references: [investigations.id] }),
}));

// ─── KYC Records ─────────────────────────────────────────────────────────────
export const kycRecordsRelations = relations(kycRecords, ({ one, many }) => ({
  tenant: one(tenants, { fields: [kycRecords.tenantId], references: [tenants.id] }),
  investigation: one(investigations, { fields: [kycRecords.investigationId], references: [investigations.id] }),
  creator: one(users, { fields: [kycRecords.createdBy], references: [users.id] }),
  documents: many(kycDocuments),
  ocrHistory: many(kycOcrHistory),
  scheduledReruns: many(kycScheduledReruns),
  biometricSessions: many(biometricSessionLogs),
}));

export const kycDocumentsRelations = relations(kycDocuments, ({ one }) => ({
  kycRecord: one(kycRecords, { fields: [kycDocuments.kycRecordId], references: [kycRecords.id] }),
}));
export const kycOcrHistoryRelations = relations(kycOcrHistory, ({ one }) => ({
  kycRecord: one(kycRecords, { fields: [kycOcrHistory.kycRecordId], references: [kycRecords.id] }),
}));
export const kycScheduledRerunsRelations = relations(kycScheduledReruns, ({ one }) => ({
  kycRecord: one(kycRecords, { fields: [kycScheduledReruns.kycRecordId], references: [kycRecords.id] }),
}));

// ─── Audit Log ────────────────────────────────────────────────────────────────
export const auditLogRelations = relations(auditLog, ({ one }) => ({
  user: one(users, { fields: [auditLog.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [auditLog.tenantId], references: [tenants.id] }),
}));

// ─── Field Tasks ──────────────────────────────────────────────────────────────
export const fieldTasksRelations = relations(fieldTasks, ({ one }) => ({
  investigation: one(investigations, { fields: [fieldTasks.investigationId], references: [investigations.id] }),
  creator: one(users, { fields: [fieldTasks.createdBy], references: [users.id] }),
}));

// ─── Reports ─────────────────────────────────────────────────────────────────
export const reportsRelations = relations(reports, ({ one }) => ({
  investigation: one(investigations, { fields: [reports.investigationId], references: [investigations.id] }),
  generatedByUser: one(users, { fields: [reports.generatedBy], references: [users.id] }),
}));

// ─── Field Agents ─────────────────────────────────────────────────────────────
export const fieldAgentsRelations = relations(fieldAgents, ({ many }) => ({
  fieldTasks: many(fieldTasks),
  fieldVisitReports: many(fieldVisitReports),
}));

// ─── Cases ────────────────────────────────────────────────────────────────────
export const casesRelations = relations(cases, ({ one, many }) => ({
  tenant: one(tenants, { fields: [cases.tenantId], references: [tenants.id] }),
  creator: one(users, { fields: [cases.createdBy], references: [users.id], relationName: "caseCreator" }),
  assignee: one(users, { fields: [cases.assignedTo], references: [users.id], relationName: "caseAssignee" }),
  parties: many(caseParties),
  documents: many(caseDocuments),
  timeline: many(caseTimeline),
  stakeholders: many(caseStakeholders),
  comments: many(caseComments),
  investigationLinks: many(investigationCaseLinks),
  evidenceItems: many(evidenceItems),
}));

export const casePartiesRelations = relations(caseParties, ({ one }) => ({
  case: one(cases, { fields: [caseParties.caseId], references: [cases.id] }),
}));
export const caseDocumentsRelations = relations(caseDocuments, ({ one }) => ({
  case: one(cases, { fields: [caseDocuments.caseId], references: [cases.id] }),
}));
export const caseTimelineRelations = relations(caseTimeline, ({ one }) => ({
  case: one(cases, { fields: [caseTimeline.caseId], references: [cases.id] }),
}));
export const caseStakeholdersRelations = relations(caseStakeholders, ({ one }) => ({
  case: one(cases, { fields: [caseStakeholders.caseId], references: [cases.id] }),
}));
export const caseCommentsRelations = relations(caseComments, ({ one }) => ({
  case: one(cases, { fields: [caseComments.caseId], references: [cases.id] }),
}));
export const investigationCaseLinksRelations = relations(investigationCaseLinks, ({ one }) => ({
  investigation: one(investigations, { fields: [investigationCaseLinks.investigationId], references: [investigations.id] }),
  case: one(cases, { fields: [investigationCaseLinks.caseId], references: [cases.id] }),
  linkedByUser: one(users, { fields: [investigationCaseLinks.linkedBy], references: [users.id] }),
}));

// ─── LEX ─────────────────────────────────────────────────────────────────────
export const lexAgenciesRelations = relations(lexAgencies, ({ many }) => ({
  submitters: many(lexSubmitters),
  submissions: many(lexSubmissions),
}));
export const lexSubmittersRelations = relations(lexSubmitters, ({ one, many }) => ({
  agency: one(lexAgencies, { fields: [lexSubmitters.agencyId], references: [lexAgencies.id] }),
  submissions: many(lexSubmissions),
}));
export const lexSubmissionsRelations = relations(lexSubmissions, ({ one }) => ({
  agency: one(lexAgencies, { fields: [lexSubmissions.agencyId], references: [lexAgencies.id] }),
  submitter: one(lexSubmitters, { fields: [lexSubmissions.submitterId], references: [lexSubmitters.id] }),
  linkedCase: one(cases, { fields: [lexSubmissions.linkedCaseId], references: [cases.id] }),
}));

// ─── Transactions ─────────────────────────────────────────────────────────────
export const transactionsRelations = relations(transactions, ({ one }) => ({
  tenant: one(tenants, { fields: [transactions.tenantId], references: [tenants.id] }),
}));

// ─── AML ─────────────────────────────────────────────────────────────────────
export const amlRulesRelations = relations(amlRules, ({ many }) => ({
  alerts: many(amlAlerts),
}));
export const amlAlertsRelations = relations(amlAlerts, ({ one }) => ({
  investigation: one(investigations, { fields: [amlAlerts.investigationId], references: [investigations.id] }),
  tenant: one(tenants, { fields: [amlAlerts.tenantId], references: [tenants.id] }),
}));

// ─── Screening ────────────────────────────────────────────────────────────────
export const candidateProfilesRelations = relations(candidateProfiles, ({ one, many }) => ({
  tenant: one(tenants, { fields: [candidateProfiles.tenantId], references: [tenants.id] }),
  screeningOrders: many(screeningOrders),
  consents: many(candidateConsents),
  adverseActions: many(adverseActions),
}));
export const screeningOrdersRelations = relations(screeningOrders, ({ one, many }) => ({
  tenant: one(tenants, { fields: [screeningOrders.tenantId], references: [tenants.id] }),
  candidate: one(candidateProfiles, { fields: [screeningOrders.candidateProfileId], references: [candidateProfiles.id] }),
  package: one(screeningPackages, { fields: [screeningOrders.packageId], references: [screeningPackages.id] }),
  results: many(screeningResults),
  adverseActions: many(adverseActions),
  assessments: many(screeningAssessments),
}));
export const screeningResultsRelations = relations(screeningResults, ({ one }) => ({
  order: one(screeningOrders, { fields: [screeningResults.orderId], references: [screeningOrders.id] }),
}));
export const adverseActionsRelations = relations(adverseActions, ({ one, many }) => ({
  order: one(screeningOrders, { fields: [adverseActions.orderId], references: [screeningOrders.id] }),
  candidate: one(candidateProfiles, { fields: [adverseActions.candidateProfileId], references: [candidateProfiles.id] }),
  items: many(adverseItems),
}));
export const adverseItemsRelations = relations(adverseItems, ({ one }) => ({
  adverseAction: one(adverseActions, { fields: [adverseItems.adverseActionId], references: [adverseActions.id] }),
}));
export const candidateConsentsRelations = relations(candidateConsents, ({ one }) => ({
  candidate: one(candidateProfiles, { fields: [candidateConsents.candidateProfileId], references: [candidateProfiles.id] }),
}));

// ─── Criminal Records ─────────────────────────────────────────────────────────
export const criminalRecordRequestsRelations = relations(criminalRecordRequests, ({ one, many }) => ({
  investigation: one(investigations, { fields: [criminalRecordRequests.investigationId], references: [investigations.id] }),
  records: many(criminalRecords),
}));
export const criminalRecordsRelations = relations(criminalRecords, ({ one, many }) => ({
  request: one(criminalRecordRequests, { fields: [criminalRecords.requestId], references: [criminalRecordRequests.id] }),
  attachments: many(criminalRecordAttachments),
  auditTrail: many(criminalRecordAudit),
}));
export const criminalRecordAttachmentsRelations = relations(criminalRecordAttachments, ({ one }) => ({
  record: one(criminalRecords, { fields: [criminalRecordAttachments.criminalRecordId], references: [criminalRecords.id] }),
}));
export const criminalRecordAuditRelations = relations(criminalRecordAudit, ({ one }) => ({
  record: one(criminalRecords, { fields: [criminalRecordAudit.criminalRecordId], references: [criminalRecords.id] }),
}));

// ─── Field Visit Reports ──────────────────────────────────────────────────────
export const fieldVisitReportsRelations = relations(fieldVisitReports, ({ one }) => ({
  investigation: one(investigations, { fields: [fieldVisitReports.investigationId], references: [investigations.id] }),
  creator: one(users, { fields: [fieldVisitReports.createdBy], references: [users.id] }),
}));

// ─── Notifications ────────────────────────────────────────────────────────────
export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

// ─── API Tokens ───────────────────────────────────────────────────────────────
export const apiTokensRelations = relations(apiTokens, ({ one, many }) => ({
  user: one(users, { fields: [apiTokens.userId], references: [users.id] }),
  usageLogs: many(tokenUsageLog),
}));
export const tokenUsageLogRelations = relations(tokenUsageLog, ({ one }) => ({
  token: one(apiTokens, { fields: [tokenUsageLog.tokenId], references: [apiTokens.id] }),
}));

// ─── Alert Rules ──────────────────────────────────────────────────────────────
export const alertRulesRelations = relations(alertRules, ({ many }) => ({
  evaluations: many(ruleEvaluations),
}));
export const ruleEvaluationsRelations = relations(ruleEvaluations, ({ one }) => ({
  rule: one(alertRules, { fields: [ruleEvaluations.ruleId], references: [alertRules.id] }),
}));

// ─── Biometric ────────────────────────────────────────────────────────────────
export const biometricSessionLogsRelations = relations(biometricSessionLogs, ({ one }) => ({
  kycRecord: one(kycRecords, { fields: [biometricSessionLogs.kycRecordId], references: [kycRecords.id] }),
}));

// ─── Billing ─────────────────────────────────────────────────────────────────
export const billingTopupsRelations = relations(billingTopups, ({ one }) => ({
  tenant: one(tenants, { fields: [billingTopups.tenantId], references: [tenants.id] }),
}));

// ─── Insider Threat / UEBA ────────────────────────────────────────────────────
export const insiderEventsRelations = relations(insiderEvents, ({ one }) => ({
  user: one(users, { fields: [insiderEvents.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [insiderEvents.tenantId], references: [tenants.id] }),
}));
export const uebaProfilesRelations = relations(uebaProfiles, ({ one }) => ({
  user: one(users, { fields: [uebaProfiles.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [uebaProfiles.tenantId], references: [tenants.id] }),
}));

// ─── Infrastructure ───────────────────────────────────────────────────────────
export const temporalWorkflowStateRelations = relations(temporalWorkflowState, ({ one }) => ({
  tenant: one(tenants, { fields: [temporalWorkflowState.tenantId], references: [tenants.id] }),
}));
export const daprEventLogRelations = relations(daprEventLog, ({ one }) => ({
  tenant: one(tenants, { fields: [daprEventLog.tenantId], references: [tenants.id] }),
}));
export const keycloakSyncLogRelations = relations(keycloakSyncLog, ({ one }) => ({
  user: one(users, { fields: [keycloakSyncLog.bisUserId], references: [users.id] }),
}));

// ─── Push Subscriptions ───────────────────────────────────────────────────────
export const pushSubscriptionsRelations = relations(pushSubscriptions, ({ one }) => ({
  user: one(users, { fields: [pushSubscriptions.userId], references: [users.id] }),
}));
