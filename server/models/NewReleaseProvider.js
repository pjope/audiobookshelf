const { DataTypes, Model } = require('sequelize')
const { PROVIDER_CLASSES } = require('../providers/registry')

class NewReleaseProvider extends Model {
  constructor(values, options) {
    super(values, options)

    /** @type {UUIDV4} */
    this.id
    /** @type {UUIDV4} */
    this.newReleaseId
    /** @type {string} */
    this.provider
    /** @type {string} */
    this.externalId
    /** @type {Date} */
    this.createdAt

    /** @type {import('./NewRelease')} - set when expanded */
    this.newRelease
  }

  /**
   * Add a provider link to a new release
   * @param {string} newReleaseId
   * @param {string} provider
   * @param {string} externalId
   * @returns {Promise<NewReleaseProvider>}
   */
  static async addProviderLink(newReleaseId, provider, externalId) {
    const existing = await this.findOne({
      where: { newReleaseId, provider }
    })
    if (existing) {
      if (existing.externalId !== externalId) {
        existing.externalId = externalId
        return existing.save()
      }
      return existing
    }

    return this.create({
      newReleaseId,
      provider,
      externalId
    })
  }

  /**
   * Get all provider links for a release
   * @param {string} newReleaseId
   * @returns {Promise<NewReleaseProvider[]>}
   */
  static async getProvidersForRelease(newReleaseId) {
    return this.findAll({
      where: { newReleaseId }
    })
  }

  /**
   * Check if a provider link exists
   * @param {string} newReleaseId
   * @param {string} provider
   * @returns {Promise<boolean>}
   */
  static async hasProviderLink(newReleaseId, provider) {
    return (await this.count({ where: { newReleaseId, provider } })) > 0
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
        provider: {
          type: DataTypes.STRING,
          allowNull: false
        },
        externalId: {
          type: DataTypes.STRING,
          allowNull: false
        }
      },
      {
        sequelize,
        modelName: 'newReleaseProvider',
        updatedAt: false,
        indexes: [
          {
            fields: ['newReleaseId', 'provider'],
            unique: true,
            name: 'unique_provider_per_release'
          },
          {
            fields: ['newReleaseId']
          }
        ]
      }
    )

    const { newRelease } = sequelize.models

    newRelease.hasMany(NewReleaseProvider, {
      foreignKey: 'newReleaseId',
      as: 'providers',
      onDelete: 'CASCADE'
    })
    NewReleaseProvider.belongsTo(newRelease, {
      foreignKey: 'newReleaseId',
      as: 'newRelease'
    })
  }

  /**
   * Get provider info with URL
   * @param {string} [region] - Region for Audible URLs
   * @returns {Object}
   */
  getProviderInfo(region) {
    const ProviderClass = PROVIDER_CLASSES[this.provider]
    if (ProviderClass?.getProviderInfo) {
      return ProviderClass.getProviderInfo(this.externalId, region)
    }

    return {
      id: this.provider,
      label: this.provider,
      color: '#666666',
      url: null
    }
  }

  toJSON() {
    return {
      id: this.id,
      newReleaseId: this.newReleaseId,
      provider: this.provider,
      externalId: this.externalId,
      createdAt: this.createdAt?.valueOf() || null
    }
  }
}

module.exports = NewReleaseProvider
