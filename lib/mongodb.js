const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI || 'mongodb+srv://admin-user:Admin%40123@collage-project.pmptf1b.mongodb.net/?retryWrites=true&w=majority&appName=Collage-Project';
const dbName = 'intellitolls'; // Replace with your database name
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
    if (cachedClient && cachedDb) {
        return { client: cachedClient, db: cachedDb };
    }

    const client = new MongoClient(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });

    await client.connect();
    const db = client.db(dbName);

    cachedClient = client;
    cachedDb = db;

    return { client, db };
}

module.exports = { connectToDatabase };