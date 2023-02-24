import sqlite3 from "sqlite3";
import { MiddlewareENV } from './middlewareEnv.js';
import { logger } from "./logger.js";

// Load environment variables
let envvars = {};
try{
  envvars = new MiddlewareENV();
} catch (err) {
  if (process.env.NODE_ENV !== "test") {
    logger.error("ERROR LOADING ENV VARS", err)
    process.exit(1);
  }
}

// Open db
let db = new sqlite3.Database(envvars.DB_FILE);

/**
 * Function to create required DBs if they do not exist
 */
export const createDBs = async () => {
  await db.exec("PRAGMA foreign_keys=ON");
  await db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT,
      name TEXT PRIMARY KEY,
      request_id INTEGER DEFAULT 0,
      last_reported_round INTEGER DEFAULT 0,
      last_request_sent REAL DEFAULT 0,
      last_submission_time REAL DEFAULT 0,
      last_result REAL DEFAULT -1,
      last_received_request_id INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS rounds (
      feed TEXT,
      round_id INTEGER DEFAULT 0,
      started_at REAL DEFAULT 0,
      started_by TEXT,
      submission_made INTEGER DEFAULT 0,
      FOREIGN KEY (feed) REFERENCES jobs(name) ON DELETE CASCADE
    );
  `);
};

/**
 * Function to get all jobs from the DB
 * @returns {Object[]} array of jobs in DB
 * @returns {string} returns[].id The CL job ID
 * @returns {string} returns[].name The name of the feed
 * @returns {number} returns[].request_id The ID of the last request made to  
 *                   the CL node
 * @returns {number} returns[].last_reported_round The latest submitted round
 * @returns {number} returns[].last_request_sent The timestamp when the last CL 
 *                   job request was sent
 * @returns {number} returns[].last_submission_time The timestamp when the last 
 *                   on-chain price submission was made
 * @returns {number} returns[].last_result The last on-chain price
 * @returns {number} returns[].last_received_request_id The ID of the last 
 *                   request whose response was received from the CL node
 */
export const getAllJobs = async () => {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM jobs", (err, rows) => {
      if (err) {
        logger.error("DB ERROR:", err);
        reject([]);
      } else {
        resolve(rows);
      }
    });
  });
};

/**
 * Function to add a job to the DB
 * @param {string} id id of the job
 * @param {string} name name of the feed
 */
export const createJob = async (id, name) => {
  try {
    await db.run("INSERT INTO jobs (id, name) VALUES (?, ?)", [id, name]);
    await db.run("INSERT INTO rounds (feed) VALUES (?)", [name]);
  } catch (err) {
    logger.error("DB ERROR:", err);
  }
};

/**
 * Function to delete a job from the DB
 * @param {string} id id of the job to delete
 */
export const deleteJob = async (id) => {
  try {
    await db.run("DELETE from jobs where id = '" + id + "';");
  } catch (err) {
    logger.error("DB ERROR:", err);
  }
};

/**
 * Function to make a query to a table
 * @param {string} table table name
 * @param {string[]} fields fields to obtain
 * @param {string} name feed name to query
 * @returns {Object} an object containing the state of the job for the given 
 *                   feed and fields
 */
export const queryTable = async (table, fields, name) => {
  let keyName = table === "jobs" ? "name" : "feed";
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT " + fields.join(", ") + " from " + table + " where " +
      keyName + " = '" + name + "';",
      (err, rows) => {
        if (err) {
          logger.error("DB ERROR:", err);
          reject({});
        } else {
          resolve(rows);
        }
      }
    );
  });
};

/**
 * Function to make an update to a table
 * @param {string} table table name
 * @param {Object} values values to update in a JSON object. The properties 
 *                        would be the column names and the values would be the 
 *                        values to set
 * @param {string} name feed name of the record to update
 */
export const updateTable = async (table, values, name) => {
  let actualFields = Object.keys(values);
  let actualValues = Object.values(values);

  // Create string
  let update = "";
  for (let i = 0; i < actualFields.length; i++) {
    update += actualFields[i] + " = ?";

    // If not last element
    if (i !== actualFields.length - 1) {
      update += ", ";
    }
  }

  let keyName = table === "jobs" ? "name" : "feed";

  try {
    await db.run(
      "UPDATE " + table + " SET " + update + " WHERE " + keyName + " = '" +
      name + "';", actualValues
    );
  } catch (err) {
    logger.error("DB ERROR:", err);
  }
};
