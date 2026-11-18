// Central catalogue of every email the system sends. Add a new template by
// creating one file here (using layout.ts's renderLayout/renderButton) and
// re-exporting it below - nothing else needs to know the file exists.
export { accountInvitedEmail } from "@/notifications/email/templates/account-invited";
export { passwordResetEmail } from "@/notifications/email/templates/password-reset";
export { submissionDecisionEmail } from "@/notifications/email/templates/submission-decision";
export { submissionReceivedEmail } from "@/notifications/email/templates/submission-received";
export { submissionAwaitingReviewEmail } from "@/notifications/email/templates/submission-awaiting-review";
export { reportReadyEmail } from "@/notifications/email/templates/report-ready";
export { executiveBriefEmail } from "@/notifications/email/templates/executive-brief";
export type { EmailTemplate, EmailBrand } from "@/notifications/email/templates/layout";
