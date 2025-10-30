import { PrismaClient, Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function exportDatabaseToJson() {
  // This object will hold all the data from all tables.
  const allDatabaseData = {};
  const outputFile = path.join(process.cwd(), 'full_database_backup.json');

  // Get all model names from the Prisma DMMF.
  const modelNames = Prisma.dmmf.datamodel.models.map((model) => model.name);

  console.log(`Found ${modelNames.length} models. Starting export...`);

  for (const modelName of modelNames) {
    try {
      // Convert PascalCase model name to camelCase for client access.
      const modelKey = modelName.charAt(0).toLowerCase() + modelName.slice(1);

      console.log(`Fetching data from ${modelName}...`);

      // Fetch all records for the current model.
      const data = await (prisma[modelKey] as any).findMany();

      // Add the data to our main object, using the model name as the key.
      allDatabaseData[modelName] = data;

      console.log(`  -> Collected ${data.length} records from ${modelName}.`);

    } catch (error) {
      console.error(`  ❌ Failed to fetch data for ${modelName}:`, error.message);
    }
  }

  try {
    // Write the entire collection of data to a single JSON file.
    fs.writeFileSync(outputFile, JSON.stringify(allDatabaseData, null, 2));
    console.log(`\n✅ Success! All data exported to: ${outputFile}`);
  } catch (error) {
    console.error('\n❌ Failed to write the final JSON file:', error);
  }
}

exportDatabaseToJson()
  .catch((e) => {
    console.error('\nAn overall error occurred:', e);
  })
  .finally(async () => {
    // Ensure the database connection is closed.
    await prisma.$disconnect();
  });