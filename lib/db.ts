import { MongoClient, type Collection } from "mongodb";
import type { Entry } from "./types";

type EntryDoc = Omit<Entry, "date"> & { _id: string };

const globalForMongo = globalThis as unknown as { _mongo?: Promise<MongoClient> };

function client(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  // Reuse one connection across hot reloads and warm serverless invocations.
  if (!globalForMongo._mongo) {
    globalForMongo._mongo = new MongoClient(uri, { maxPoolSize: 5 }).connect();
    globalForMongo._mongo.catch(() => {
      globalForMongo._mongo = undefined;
    });
  }
  return globalForMongo._mongo;
}

export async function entries(): Promise<Collection<EntryDoc>> {
  const c = await client();
  return c.db(process.env.MONGODB_DB || "trading_journal").collection<EntryDoc>("entries");
}

export function toEntry(doc: EntryDoc): Entry {
  const { _id, ...rest } = doc;
  return { date: _id, ...rest };
}

export function toDoc(entry: Entry): EntryDoc {
  const { date, ...rest } = entry;
  return { _id: date, ...rest };
}
