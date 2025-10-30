export interface ILeadItem {
  id: string;
  name: string;
  description?: string | null;
  agentId: string;
  createdAt: Date;
  updatedAt: Date;
}
