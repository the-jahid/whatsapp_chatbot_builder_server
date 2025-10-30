import type {
  Template as PrismaTemplate,
  TemplateMediaType,
} from '@prisma/client';

export type TemplateEntity = PrismaTemplate;

export type TemplatePublic = Omit<PrismaTemplate, 'mediaData' | 'mediaChecksum'> & {
  hasMedia: boolean;
};

export interface TemplateMediaPayload {
  buffer: Buffer;
  mimetype: string;       // image/*, video/*, or application/* (e.g., application/pdf)
  originalname: string;
  size: number;
  width?: number | null;  // for images if available
  height?: number | null; // for images if available
  mediaType?: TemplateMediaType; // optional explicit override
  checksum?: string;      // optional precomputed checksum
}

export interface ListTemplatesFilter {
  agentId: string;
  q?: string;            // search in name/body
  skip?: number;
  take?: number;
  orderBy?: 'createdAt' | 'updatedAt' | 'name';
  orderDir?: 'asc' | 'desc';
}
