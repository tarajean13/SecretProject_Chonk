const Twitter = require('./adapters/twitter/twitter.js');
const Data = require('./model/data');
const { KoiiStorageClient } = require('@_koii/storage-task-sdk');
const dotenv = require('dotenv');
const { CID } = require('multiformats/cid');
const path = require('path');
const fs = require('fs');
const { namespaceWrapper } = require('@_koii/namespace-wrapper');
const { default: axios } = require('axios');

async function isValidCID(cid) {
  try {
    CID.parse(cid);
    return true;
  } catch (error) {
    return false;
  }
}

dotenv.config();

/**
 * TwitterTask is a class that handles the Twitter crawler and validator
 *
 * @description TwitterTask is a class that handles the Twitter crawler and validator
 *              In this task, the crawler asynchronously populates a database, which is later
 *              read by the validator. The validator then uses the database to prepare a submission CID
 *              for the current round, and submits that for rewards.
 *
 *              Four main functions control this process:
 *              @crawl crawls Twitter and populates the database
 *              @validate verifies the submissions of other nodes
 *              @getRoundCID returns the submission for a given round
 *              @stop stops the crawler
 *
 * @param {function} getRound - a function that returns the current round
 * @param {number} round - the current round
 * @param {string} searchTerm - the search term to use for the crawler
 * @param {string} adapter - the adapter to use for the crawler
 * @param {string} db - the database to use for the crawler
 *
 * @returns {TwitterTask} - a TwitterTask object
 *
 */
class TwitterTask {
  constructor(round) {
    this.round = round;
    this.lastRoundCheck = Date.now();
    this.isRunning = false;
    this.searchTerm = [];
    this.adapter = null;
    this.meme = '';
    this.comment = '';
    this.username = '';
    this.db = new Data('db', []);
    this.db.initializeData();
    this.initialize();

    this.setAdapter = async () => {
      const username = process.env.TWITTER_USERNAME;
      const password = process.env.TWITTER_PASSWORD;
      const phone = process.env.TWITTER_PHONE;

      if (!username || !password) {
        throw new Error(
          'Environment variables TWITTER_USERNAME and/or TWITTER_PASSWORD are not set',
        );
      }

      let credentials = {
        username: username,
        password: password,
        phone: phone,
      };

      this.username = username;
      this.adapter = new Twitter(credentials, this.db, 3);
      await this.adapter.negotiateSession();
    };

    this.start();
  }

  async initialize() {
    try {
      console.log('initializing twitter task');
      const { comment, search, meme } = await this.fetchSearchTerms();
      this.comment = comment;
      this.searchTerm = search;
      this.meme = meme;

      //Store this round searchTerm
      console.log(
        'creating crawler for user:',
        this.searchTerm,
        this.round,
        this.comment,
        this.meme,
      );

      this.db.createSearchTerm(this.searchTerm, this.round, this.comment);
    } catch (error) {
      throw new Error('Environment variables TWITTER_PROFILE is not set');
    }
  }

  /**
   * fetchSearchTerms
   * @description return the search terms to use for the crawler
   * @returns {array} - an array of search terms
   */
  async fetchSearchTerms() {
    let meme;
    let getComments;
    try {
      const wordsList = require('./memes.json');
      const randomIndexWordsList = Math.floor(Math.random() * wordsList.length);
      meme = wordsList[randomIndexWordsList];

      const commentList = require('./couch_comments.json');
      const randomIndexCommentList = Math.floor(
        Math.random() * commentList.length,
      );
      getComments = commentList[randomIndexCommentList];
    } catch (error) {
      console.error('Error fetching keywords:', error.message);
    }
    return {
      comment: getComments,
      search: 'PrimeHydrate',
      meme: meme,
    };
  }

  /**
   * strat
   * @description starts the crawler
   *
   * @returns {void}
   *
   */
  async start() {
    await this.setAdapter();

    this.isRunning = true;

    // random selected emojis
    const emojis = ['🦠', '🦾', '💚', '✨', '🧪'];
    for (let i = emojis.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [emojis[i], emojis[j]] = [emojis[j], emojis[i]];
    }
    const numEmojis = Math.floor(Math.random() * 3) + 1;
    const getRandomEmojis = emojis.slice(0, numEmojis).join('');

    // random selected hashtags
    const hashtags = ['#AlgaeBiotech', '#Chonkus', '#DeSci', '#CryptoCommunity', '#Memecoin', '#AI', '#Blockchain'];
    for (let i = hashtags.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [hashtags[i], hashtags[j]] = [hashtags[j], hashtags[i]];
    }
    const numHashtags = Math.floor(Math.random() * hashtags.length) + 1;
    const selectedHashtags = hashtags.slice(0, numHashtags).join(' ');

    let query = {
      limit: 100,
      searchTerm: this.searchTerm,
      query: `https://x.com/${this.searchTerm}`,
      comment: `${this.comment} ${getRandomEmojis} ${selectedHashtags}`,
      meme: this.meme,
      depth: 3,
      round: this.round,
      recursive: true,
      username: this.username,
    };

    this.adapter.search(query); // let it ride
  }

  /**
   * stop
   * @description stops the crawler
   *
   * @returns {void}
   */
  async stop() {
    this.isRunning = false;
    this.adapter.stop();
  }

  /**
   * getRoundCID
   * @param {*} roundID
   * @returns
   */
  async getRoundCID(roundID) {
    console.log('starting submission prep for ');
    let result = await this.adapter.getSubmissionCID(roundID);
    console.log('returning round CID', result, 'for round', roundID);
    return result;
  }

  /**
   * getJSONofCID
   * @description gets the JSON of a CID
   * @param {*} cid
   * @returns
   */
  async getJSONofCID(cid) {
    return await getJSONFromCID(cid, 'prime_dataList.json');
  }

  /**
   * validate
   * @description validates a round of results from another node against the Twitter API
   * @param {*} proofCid
   * @returns
   */
  async validate(proofCid, round) {
    // in order to validate, we need to take the proofCid
    // and go get the results from IPFS
    try {
      let data = await getJSONFromCID(proofCid, 'prime_dataList.json');
      let idSet = new Set();
      let duplicatedIDNumber = 0;
      for (let item of data) {
        if (idSet.has(item.id)) {
          console.log('Duplicate Item ID found: ', item.id);
          duplicatedIDNumber += 1;
        }
        idSet.add(item.id);
      }
      if (duplicatedIDNumber > 10) {
        console.log(
          `Detected Potential Risk ; Duplicated ID is ${duplicatedIDNumber}`,
        );
      } else {
        console.log(
          `Duplicated ID Check Passed ; Duplicated ID numebr is ${duplicatedIDNumber}`,
        );
      }

      let proofThreshold = 8;
      let passedNumber = 0;
      if (data && data !== null && data.length > 0) {
        for (let i = 0; i < proofThreshold; i++) {
          console.log(`Checking the ${i} th tweet.`);
          let randomIndex = Math.floor(Math.random() * data.length);
          let item = data[randomIndex];

          if (item.id) {
            await new Promise(resolve => setTimeout(resolve, 30000));
            const result = await this.adapter.verify(item.data, round);
            console.log('Result from verify', result);
            if (result) {
              passedNumber += 1;
            }
          } else {
            console.log('Invalid Item ID: ', item.id);
            continue;
          }
        }
        if (passedNumber >= 1) {
          console.log(passedNumber, 'is passedNumber');
          return true;
        } else {
          console.log(passedNumber, 'is passedNumber');
          return false;
        }
      } else {
        console.log('no data from proof CID');
      }
      // if none of the random checks fail, return true
      return true;
    } catch (e) {
      console.log('error in validate', e);
      return true;
    }
  }
}

module.exports = TwitterTask;

/**
 * getJSONFromCID
 * @description gets the JSON from a CID
 * @param {*} cid
 * @returns promise<JSON>
 */
const getJSONFromCID = async (cid, fileName, retries = 3) => {
  const validateCID = await isValidCID(cid);
  if (!validateCID) {
    console.log(`Invalid CID: ${cid}`);
    return null;
  }

  const client = new KoiiStorageClient(undefined, undefined, false);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const blob = await client.getFile(cid, fileName);
      const text = await blob.text(); // Convert Blob to text
      const data = JSON.parse(text); // Parse text to JSON
      return data;
    } catch (error) {
      console.log(
        `Attempt ${attempt}: Error fetching file from Koii IPFS: ${error.message}`,
      );
      if (attempt === retries) {
        throw new Error(`Failed to fetch file after ${retries} attempts`);
      }
      // Optionally, you can add a delay between retries
      await new Promise(resolve => setTimeout(resolve, 3000)); // 3-second delay
    }
  }

  return null;
};
