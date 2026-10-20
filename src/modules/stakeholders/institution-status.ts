export type InstitutionStatus = "active" | "onboarding-in-progress" | "pending-onboarding";

export interface InstitutionActivity {
  userStatuses: string[];
  hasApprovedData: boolean;
  datasetOrObligationCount: number;
}

export function institutionStatus(activity: InstitutionActivity): InstitutionStatus {
  if (activity.userStatuses.includes("ACTIVE") || activity.hasApprovedData) return "active";
  if (activity.userStatuses.includes("PENDING") || activity.datasetOrObligationCount > 0) {
    return "onboarding-in-progress";
  }
  return "pending-onboarding";
}
