export interface ILeadCustomFieldIntake {
  id: string;
  name: string;

  // ownership
  outboundCampaignId: string;

  createdAt: Date;
  updatedAt: Date;
}
