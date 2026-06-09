require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function seed() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgres://m1_user:m1_password@localhost:5432/m1_db'
  });
  
  try {
    console.log('Connecting to database...');
    await client.connect();
    
    console.log('Reading seed.sql...');
    const sql = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');
    
    console.log('Executing seed.sql...');
    await client.query(sql);
    
    console.log('Seed data inserted successfully!');
  } catch (err) {
    console.error('Failed to seed database:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

seed();
