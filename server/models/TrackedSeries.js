const { DataTypes, Model, Op } = require('sequelize')

class TrackedSeries extends Model {
  constructor(values, options) {
    super(values, options)

    /** @type {UUIDV4} */
    this.id
    /** @type {UUIDV4} */
    this.userId
    /** @type {UUIDV4} */
    this.seriesId
    /** @type {string} */
    this.seriesAsin
    /** @type {boolean} */
    this.autoTracked
    /** @type {string} */
    this.region
    /** @type {Date} */
    this.lastChecked
    /** @type {Date} */
    this.createdAt
    /** @type {Date} */
    this.updatedAt

    /** @type {import('./Series')} - set when expanded */
    this.series
    /** @type {import('./User')} - set when expanded */
    this.user
    /** @type {import('./NewRelease')[]} - set when expanded */
    this.newReleases
  }

  /**
   * Get tracked series by user and series ID
   * @param {string} userId
   * @param {string} seriesId
   * @returns {Promise<TrackedSeries>}
   */
  static async getByUserAndSeries(userId, seriesId) {
    return this.findOne({
      where: { userId, seriesId }
    })
  }

  /**
   * Check if user is tracking a series
   * @param {string} userId
   * @param {string} seriesId
   * @returns {Promise<boolean>}
   */
  static async isTracking(userId, seriesId) {
    return (await this.count({ where: { userId, seriesId } })) > 0
  }

  /**
   * Get all tracked series for a user
   * @param {string} userId
   * @param {Object} options
   * @param {boolean} [options.includeNewReleases=false]
   * @returns {Promise<TrackedSeries[]>}
   */
  static async getTrackedSeriesForUser(userId, options = {}) {
    const include = [
      {
        model: this.sequelize.models.series,
        required: true
      }
    ]

    if (options.includeNewReleases) {
      include.push({
        model: this.sequelize.models.newRelease,
        where: { dismissed: false },
        required: false
      })
    }

    return this.findAll({
      where: { userId },
      include,
      order: [['createdAt', 'DESC']]
    })
  }

  /**
   * Get tracked series that are due for checking
   * @param {Date} thresholdDate - Series with lastChecked before this date need checking
   * @param {number} limit
   * @returns {Promise<TrackedSeries[]>}
   */
  static async getDueForCheck(thresholdDate, limit = 100) {
    return this.findAll({
      where: {
        [Op.or]: [
          { lastChecked: null },
          { lastChecked: { [Op.lt]: thresholdDate } }
        ]
      },
      include: [
        {
          model: this.sequelize.models.series,
          required: true
        }
      ],
      limit,
      order: [['lastChecked', 'ASC NULLS FIRST']]
    })
  }

  /**
   * Create a new tracked series
   * @param {Object} data
   * @param {string} data.userId
   * @param {string} data.seriesId
   * @param {string} [data.seriesAsin]
   * @param {boolean} [data.autoTracked=false]
   * @param {string} [data.region='us']
   * @returns {Promise<TrackedSeries>}
   */
  static async createTrackedSeries(data) {
    const existing = await this.getByUserAndSeries(data.userId, data.seriesId)
    if (existing) return existing

    return this.create({
      userId: data.userId,
      seriesId: data.seriesId,
      seriesAsin: data.seriesAsin || null,
      autoTracked: data.autoTracked || false,
      region: data.region || 'us'
    })
  }

  /**
   * Remove tracking for a user and series
   * @param {string} userId
   * @param {string} seriesId
   * @returns {Promise<boolean>}
   */
  static async removeTracking(userId, seriesId) {
    const deleted = await this.destroy({
      where: { userId, seriesId }
    })
    return deleted > 0
  }

  /**
   * Update last checked timestamp
   * @returns {Promise<TrackedSeries>}
   */
  async updateLastChecked() {
    this.lastChecked = new Date()
    return this.save()
  }

  /**
   * Update series ASIN
   * @param {string} asin
   * @returns {Promise<TrackedSeries>}
   */
  async updateSeriesAsin(asin) {
    this.seriesAsin = asin
    return this.save()
  }

  /**
   * Initialize model
   * @param {import('../Database').sequelize} sequelize
   */
  static init(sequelize) {
    super.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true
        },
        seriesAsin: DataTypes.STRING,
        autoTracked: {
          type: DataTypes.BOOLEAN,
          defaultValue: false,
          allowNull: false
        },
        region: {
          type: DataTypes.STRING,
          defaultValue: 'us'
        },
        lastChecked: DataTypes.DATE
      },
      {
        sequelize,
        modelName: 'trackedSeries',
        indexes: [
          {
            fields: ['userId', 'seriesId'],
            unique: true,
            name: 'unique_tracked_series_per_user'
          },
          {
            fields: ['userId']
          },
          {
            fields: ['seriesId']
          }
        ]
      }
    )

    const { user, series } = sequelize.models

    user.hasMany(TrackedSeries, {
      onDelete: 'CASCADE'
    })
    TrackedSeries.belongsTo(user)

    series.hasMany(TrackedSeries, {
      onDelete: 'CASCADE'
    })
    TrackedSeries.belongsTo(series)
  }

  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      seriesId: this.seriesId,
      seriesAsin: this.seriesAsin,
      autoTracked: this.autoTracked,
      region: this.region,
      lastChecked: this.lastChecked?.valueOf() || null,
      createdAt: this.createdAt.valueOf(),
      updatedAt: this.updatedAt.valueOf(),
      series: this.series?.toOldJSON?.() || null,
      newReleases: this.newReleases?.map((r) => r.toJSON()) || []
    }
  }
}

module.exports = TrackedSeries
