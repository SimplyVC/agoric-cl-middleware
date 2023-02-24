import { open } from "sqlite";
import sqlite3 from 'sqlite3'
import { MiddlewareENV } from "./MiddlewareEnv.js";
import { logger } from "./logger.js";

// Load environment variables
let envvars = {};
try {
  envvars = new MiddlewareENV();
} catch (err) {
  if (process.env.NODE_ENV !== "test" && process.env.SERVICE !== "monitor") {
    logger.error("ERROR LOADING ENV VARS: " + err);
    process.exit(1);
  }
}

// Open db
let db;

/**
 * Function to load DB
 */
const loadDB = async () => {
  if(!db){
    db = await open({
      filename: envvars.DB_FILE,
      driver: sqlite3.Database
    })
  }
}

/**
 * Function to create required DBs if they do not exist
 */
export const createDBs = async () => {
  try {

    await loadDB();

    await db.migrate({    
      migrationsPath: "../migrations",
      table: "migrations"
    }) 

    await db.exec("PRAGMA foreign_keys=ON");

  } catch (err) {
    throw new Error("DB ERROR when creating DBs: " + err);
  }
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
  await loadDB();

  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM jobs", (err, rows) => {
      if (err) {
        logger.error("DB ERROR when getting all jobs: " + err);
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
    await loadDB();

    await db.run("INSERT INTO jobs (id, name) VALUES (?, ?)", [id, name]);
    await db.run("INSERT INTO rounds (feed) VALUES (?)", [name]);
  } catch (err) {
    throw new Error("DB ERROR when creating job: " + err);
  }
};

/**
 * Function to delete a job from the DB
 * @param {string} id id of the job to delete
 */
export const deleteJob = async (id) => {
  try {
    await loadDB();

    await db.run("DELETE from jobs where id = '" + id + "';");
  } catch (err) {
    throw new Error("DB ERROR when deleting job: " + err);
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
  await loadDB();

  let keyName = table === "jobs" ? "name" : "feed";
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT " +
        fields.join(", ") +
        " from " +
        table +
        " where " +
        keyName +
        " = '" +
        name +
        "';",
      (err, rows) => {
        if (err) {
          logger.error("DB ERROR when querying table: " + err);
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
  await loadDB();
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
      "UPDATE " +
        table +
        " SET " +
        update +
        " WHERE " +
        keyName +
        " = '" +
        name +
        "';",
      actualValues
    );
  } catch (err) {
    throw new Error("DB ERROR when updating table: " + err);
  }
};