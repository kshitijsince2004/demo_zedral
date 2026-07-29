import pg from 'pg';
import supertokens from 'supertokens-node';
import EmailPassword from 'supertokens-node/recipe/emailpassword/index.js';
import { resolveDatabaseUrl } from './lib/database-url.mjs';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

const DATABASE_URL = resolveDatabaseUrl();
const DEFAULT_PASSWORD = 'Password123!'; // Dummy password for migration

supertokens.init({
  framework: 'express',
  supertokens: {
    connectionURI: process.env.SUPERTOKENS_CORE_URI || 'http://localhost:3567',
    apiKey: process.env.SUPERTOKENS_API_KEY || 'local-development-key',
  },
  appInfo: {
    appName: 'Zedral M1',
    apiDomain: process.env.API_DOMAIN || 'http://localhost:3005',
    websiteDomain: process.env.WEBSITE_DOMAIN || 'http://localhost:5173',
  },
  recipeList: [EmailPassword.init()],
});

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    const res = await client.query(`
      SELECT u.user_id, u.username, u.emp_code
      FROM security.app_user u
      JOIN security.user_role ur ON u.user_id = ur.user_id
      JOIN security.role r ON ur.role_id = r.role_id
      WHERE r.role_name IN ('ADMIN', 'PLANT_HEAD', 'MACHINE_HEAD')
        AND u.supertokens_user_id IS NULL
    `);

    for (const row of res.rows) {
      const email = `${row.username}@zedral.local`;
      try {
        const response = await EmailPassword.signUp('', email, DEFAULT_PASSWORD);
        if (response.status === 'OK') {
          const stUserId = response.user.id;
          await client.query(
            `UPDATE security.app_user SET supertokens_user_id = $1 WHERE user_id = $2`,
            [stUserId, row.user_id]
          );
          console.log(`Migrated user ${row.username} to SuperTokens. ID: ${stUserId}`);
        } else if (response.status === 'EMAIL_ALREADY_EXISTS_ERROR') {
          console.log(`User ${row.username} already exists in SuperTokens.`);
        }
      } catch (err) {
        console.error(`Failed to migrate user ${row.username}:`, err);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch(console.error);
