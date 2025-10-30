import { DynamicTool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z, ZodTypeAny } from 'zod';
import { PrismaService } from 'src/prisma/prisma.service';

// WORKAROUND: Define a local interface for DynamicField.
// This resolves TypeScript errors if the Prisma client has not been generated yet.
// The real solution is to run `npx prisma generate` in your terminal. After that,
// you can remove this interface and use: `import { DynamicField } from '@prisma/client';`
interface DynamicField {
  id: string;
  name: string;
  description: string;
  agentId: string;
  createdAt: Date;
  updatedAt: Date;
}

interface CreateDataCollectionToolParams {
  prisma: PrismaService;
  agentId: string;
  logger: Logger;
  /** The dynamic fields from the database that define the questions to ask. */
  fields: DynamicField[]; 
}

/**
 * Creates a single, truly dynamic LangChain Tool that builds a form 
 * based on a list of fields provided from the database.
 */
export function createDynamicDataCollectionTool({
  prisma,
  agentId,
  logger,
  fields,
}: CreateDataCollectionToolParams): DynamicTool {
  try {
    const toolName = 'collect_information';

    // 1. Dynamically build the Zod schema from the database fields
    const shape: { [key: string]: ZodTypeAny } = {};
    for (const field of fields) {
      // The `description` from your DB is now the prompt for the AI.
      shape[field.name] = z.string().describe(field.description);
    }
    const dynamicSchema = z.object(shape);

    // 2. Dynamically build the tool's description for the AI
    const fieldDescriptions = fields
      .map(field => `- ${field.name}: ${field.description}`)
      .join('\n');

    const toolDescription = `Use this tool to collect specific information from the user.

Your task is to have a conversation and collect answers for all of the following items:
${fieldDescriptions}

IMPORTANT:
- You must ask the user for each item listed above.
- Ask for the information step-by-step in a natural, conversational way.
- DO NOT make up any values. You must get all details directly from the user.
- DO NOT call this tool until you have gathered all the required pieces of information.`;

    const tool = new DynamicTool({
      name: toolName,
      description: toolDescription,
      func: async (input: any): Promise<string> => {
        try {
          const validationResult = dynamicSchema.safeParse(input);

          if (!validationResult.success) {
            const missingFields = validationResult.error.errors.map(e => e.path[0]).join(', ');
            logger.warn(`Validation failed for tool "${toolName}". Missing/invalid fields: ${missingFields}`);
            return `I am sorry, but I am missing some information. I still need to know the following: ${missingFields}. Could you please provide that?`;
          }

          const validatedData = validationResult.data;
          logger.log(`Input validated. Saving collected data for agent ${agentId}.`, validatedData);

          // 3. Save the dynamically collected data into the Lead model's JSON field
          const lead = await prisma.lead.create({
            data: {
              agentId,
              status: 'NEW',
              source: 'AI Dynamic Form',
              data: validatedData as Prisma.JsonObject,
            },
          });

          logger.log(`Successfully created lead ${lead.id} with dynamic data.`);

          return `✅ Success! Thank you. I have recorded the information. Is there anything else I can help you with?`;

        } catch (error) {
          logger.error(`Error executing tool "${toolName}":`, error);
          return `I apologize, but an internal error occurred. Please contact support.`;
        }
      },
    });

    // FIX: Cast the tool to 'any' to bypass the strict TypeScript type check for the schema.
    // This is a common workaround for this specific LangChain typing issue.
    (tool as any).schema = dynamicSchema;

    return tool;

  } catch (error) {
    logger.error(`Fatal error creating the dynamic data collection tool:`, error);
    throw error;
  }
}