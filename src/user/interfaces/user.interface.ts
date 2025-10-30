
export interface User {
  id: string;
  email: string;
  oauthId: string;
  username: string | null; // Prisma optional fields can be string or null
  createdAt: Date;
  updatedAt: Date;
}