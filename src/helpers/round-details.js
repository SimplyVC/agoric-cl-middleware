export class RoundDetails {
  /**
   * Constructor for this class
   * @param {number} roundId round id
   * @param {number} startedAt timestamp when round was started
   * @param {string} startedBy address of the oracle who started the round
   * @param {boolean} submissionMade whether a submission was made to this round
   * @param {boolean} errored whether a submission was errored to this round
   */
  constructor(roundId, startedAt, startedBy, submissionMade, errored) {
    this.roundId = roundId;
    this.startedAt = startedAt;
    this.startedBy = startedBy;
    this.submissionMade = submissionMade;
    this.errored = errored;
  }

  /**
   * Function to return class as an object
   * @returns {Object} this class as an object
   * @returns {number} returns.roundId The round id
   * @returns {number} returns.startedAt The timestamp when the round
   *                   was started
   * @returns {string} returns.startedBy The address of who started the round
   * @returns {boolean} returns.submissionMade Whether a submission to this  
   *                    round was made by the oracle
   */
  toObject() {
    return {
      roundId: this.roundId,
      startedAt: this.startedAt,
      startedBy: this.startedBy,
      submissionMade: this.submissionMade,
      errored: this.errored,
    };
  }
}
