const { DataTypes, Model, Op, literal } = require('sequelize')
const Audible = require('../providers/Audible')

const PROVIDERS = {
  audible: Audible
}

class NewRelease extends Model {
  constructor(values, options) {
    super(values, options)

    /** @type {UUIDV4} */
    this.id
    /** @type {UUIDV4} */
    this.trackedSeriesId
    /** @type {string} */
    this.asin
    /** @type {string} */
    this.title
    /** @type {string} */
    this.author
    /** @type {string} */
    this.narrator
    /** @type {string} */
    this.coverUrl
    /** @type {Date} */
    this.releaseDate
    /** @type {string} */
    this.sequence
    /** @type {string} */
    this.provider
    /** @type {boolean} */
    this.dismissed
    /** @type {Date} */
    this.discoveredAt
    /** @type {Date} */
    this.createdAt

    /** @type {import('./TrackedSeries')} - set when expanded */
    this.trackedSeries
  }

  /**
   * Get pending (not dismissed) releases for a user
   * @param {string} userId
   * @param {number} limit
   * @returns {Promise<NewRelease[]>}
   */
  static async getPendingForUser(userId, limit = 50) {
    return this.findAll({
      where: { dismissed: false },
      include: [
        {
          model: this.sequelize.models.trackedSeries,
          as: 'trackedSeries',
          where: { userId },
          required: true,
          include: [
            {
              model: this.sequelize.models.series,
              required: true
            }
          ]
        }
      ],
      order: [['discoveredAt', 'DESC']],
      limit
    })
  }

  /**
   * Get all releases for a tracked series
   * @param {string} trackedSeriesId
   * @param {Object} options
   * @param {boolean} [options.includeDismissed=false]
   * @returns {Promise<NewRelease[]>}
   */
  static async getForTrackedSeries(trackedSeriesId, options = {}) {
    const where = { trackedSeriesId }
    if (!options.includeDismissed) {
      where.dismissed = false
    }

    return this.findAll({
      where,
      order: [[literal('CAST(sequence AS FLOAT)'), 'ASC NULLS LAST']]
    })
  }

  /**
   * Dismiss a release
   * @param {string} releaseId
   * @returns {Promise<boolean>}
   */
  static async dismissRelease(releaseId) {
    const [updated] = await this.update(
      { dismissed: true },
      { where: { id: releaseId } }
    )
    return updated > 0
  }

  /**
   * Dismiss all releases for a user
   * @param {string} userId
   * @returns {Promise<number>} Number of dismissed releases
   */
  static async dismissAllForUser(userId) {
    const trackedSeriesIds = await this.sequelize.models.trackedSeries.findAll({
      where: { userId },
      attributes: ['id']
    })

    if (!trackedSeriesIds.length) return 0

    const [updated] = await this.update(
      { dismissed: true },
      {
        where: {
          trackedSeriesId: trackedSeriesIds.map((ts) => ts.id),
          dismissed: false
        }
      }
    )
    return updated
  }

  /**
   * Create a new release record
   * @param {Object} data
   * @param {string} data.trackedSeriesId
   * @param {string} data.asin
   * @param {string} data.title
   * @param {string} [data.author]
   * @param {string} [data.narrator]
   * @param {string} [data.coverUrl]
   * @param {Date} [data.releaseDate]
   * @param {string} [data.sequence]
   * @param {string} [data.provider='audible']
   * @returns {Promise<NewRelease>}
   */
  static async createNewRelease(data) {
    return this.create({
      trackedSeriesId: data.trackedSeriesId,
      asin: data.asin,
      title: data.title,
      author: data.author || null,
      narrator: data.narrator || null,
      coverUrl: data.coverUrl || null,
      releaseDate: data.releaseDate || null,
      sequence: data.sequence || null,
      provider: data.provider || 'audible',
      dismissed: false,
      discoveredAt: new Date()
    })
  }

  /**
   * Check if a release with this ASIN already exists for the tracked series
   * @param {string} trackedSeriesId
   * @param {string} asin
   * @returns {Promise<boolean>}
   */
  static async existsByAsin(trackedSeriesId, asin) {
    return (await this.count({ where: { trackedSeriesId, asin } })) > 0
  }

  /**
   * Get count of pending releases for a user
   * @param {string} userId
   * @returns {Promise<number>}
   */
  static async getPendingCountForUser(userId) {
    return this.count({
      where: { dismissed: false },
      include: [
        {
          model: this.sequelize.models.trackedSeries,
          as: 'trackedSeries',
          where: { userId },
          required: true
        }
      ]
    })
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
        asin: {
          type: DataTypes.STRING,
          allowNull: false
        },
        title: {
          type: DataTypes.STRING,
          allowNull: false
        },
        author: DataTypes.STRING,
        narrator: DataTypes.STRING,
        coverUrl: DataTypes.TEXT,
        releaseDate: DataTypes.DATEONLY,
        sequence: DataTypes.STRING,
        provider: {
          type: DataTypes.STRING,
          defaultValue: 'audible'
        },
        dismissed: {
          type: DataTypes.BOOLEAN,
          defaultValue: false,
          allowNull: false
        },
        discoveredAt: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW
        }
      },
      {
        sequelize,
        modelName: 'newRelease',
        updatedAt: false,
        indexes: [
          {
            fields: ['dismissed']
          }
        ]
      }
    )

    const { trackedSeries } = sequelize.models

    trackedSeries.hasMany(NewRelease, {
      foreignKey: 'trackedSeriesId',
      onDelete: 'CASCADE'
    })
    NewRelease.belongsTo(trackedSeries, {
      foreignKey: 'trackedSeriesId',
      as: 'trackedSeries'
    })
  }

  getProviderInfo() {
    const ProviderClass = PROVIDERS[this.provider]
    if (ProviderClass?.getProviderInfo) {
      const region = this.trackedSeries?.region || 'us'
      return ProviderClass.getProviderInfo(this.asin, region)
    }

    return {
      id: this.provider,
      label: this.provider,
      color: '#666666',
      url: null
    }
  }

  toJSON() {
    const seriesData = this.trackedSeries?.series?.toOldJSON?.() || null

    return {
      id: this.id,
      trackedSeriesId: this.trackedSeriesId,
      asin: this.asin,
      title: this.title,
      author: this.author,
      narrator: this.narrator,
      coverUrl: this.coverUrl,
      releaseDate: this.releaseDate,
      sequence: this.sequence,
      provider: this.getProviderInfo(),
      dismissed: this.dismissed,
      discoveredAt: this.discoveredAt?.valueOf() || null,
      createdAt: this.createdAt.valueOf(),
      series: seriesData
    }
  }
}

module.exports = NewRelease
