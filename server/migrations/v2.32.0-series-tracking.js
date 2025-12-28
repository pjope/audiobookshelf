/**
 * @typedef MigrationContext
 * @property {import('sequelize').QueryInterface} queryInterface - a sequelize QueryInterface object.
 * @property {import('../Logger')} logger - a Logger object.
 *
 * @typedef MigrationOptions
 * @property {MigrationContext} context - an object containing the migration context.
 */

const migrationVersion = '2.32.0'
const migrationName = `${migrationVersion}-series-tracking`
const loggerPrefix = `[${migrationVersion} migration]`

/**
 * This upward migration creates trackedSeries and newReleases tables for the new release detection feature.
 *
 * @param {MigrationOptions} options - an object containing the migration context.
 * @returns {Promise<void>} - A promise that resolves when the migration is complete.
 */
async function up({ context: { queryInterface, logger } }) {
  logger.info(`${loggerPrefix} UPGRADE BEGIN: ${migrationName}`)

  const DataTypes = queryInterface.sequelize.Sequelize.DataTypes

  // Create trackedSeries table
  if (await queryInterface.tableExists('trackedSeries')) {
    logger.info(`${loggerPrefix} table "trackedSeries" already exists`)
  } else {
    logger.info(`${loggerPrefix} creating table "trackedSeries"`)
    await queryInterface.createTable('trackedSeries', {
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
      lastChecked: DataTypes.DATE,
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      userId: {
        type: DataTypes.UUID,
        references: {
          model: {
            tableName: 'users'
          },
          key: 'id'
        },
        allowNull: false,
        onDelete: 'CASCADE'
      },
      seriesId: {
        type: DataTypes.UUID,
        references: {
          model: {
            tableName: 'series'
          },
          key: 'id'
        },
        allowNull: false,
        onDelete: 'CASCADE'
      }
    })
    logger.info(`${loggerPrefix} created table "trackedSeries"`)

    // Add unique constraint
    logger.info(`${loggerPrefix} adding unique constraint on trackedSeries(userId, seriesId)`)
    await queryInterface.addIndex('trackedSeries', ['userId', 'seriesId'], {
      unique: true,
      name: 'unique_tracked_series_per_user'
    })

    // Add index on userId for efficient queries
    await queryInterface.addIndex('trackedSeries', ['userId'], {
      name: 'tracked_series_user_id'
    })

    // Add index on seriesId
    await queryInterface.addIndex('trackedSeries', ['seriesId'], {
      name: 'tracked_series_series_id'
    })
  }

  // Create newReleases table
  if (await queryInterface.tableExists('newReleases')) {
    logger.info(`${loggerPrefix} table "newReleases" already exists`)
  } else {
    logger.info(`${loggerPrefix} creating table "newReleases"`)
    await queryInterface.createTable('newReleases', {
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
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      trackedSeriesId: {
        type: DataTypes.UUID,
        references: {
          model: {
            tableName: 'trackedSeries'
          },
          key: 'id'
        },
        allowNull: false,
        onDelete: 'CASCADE'
      }
    })
    logger.info(`${loggerPrefix} created table "newReleases"`)

    // Add unique constraint for asin per tracked series
    logger.info(`${loggerPrefix} adding unique constraint on newReleases(trackedSeriesId, asin)`)
    await queryInterface.addIndex('newReleases', ['trackedSeriesId', 'asin'], {
      unique: true,
      name: 'unique_release_per_tracked_series'
    })

    // Add index on trackedSeriesId
    await queryInterface.addIndex('newReleases', ['trackedSeriesId'], {
      name: 'new_releases_tracked_series_id'
    })

    // Add index on dismissed for filtering
    await queryInterface.addIndex('newReleases', ['dismissed'], {
      name: 'new_releases_dismissed'
    })
  }

  logger.info(`${loggerPrefix} UPGRADE END: ${migrationName}`)
}

/**
 * This downward migration script removes the trackedSeries and newReleases tables.
 *
 * @param {MigrationOptions} options - an object containing the migration context.
 * @returns {Promise<void>} - A promise that resolves when the migration is complete.
 */
async function down({ context: { queryInterface, logger } }) {
  logger.info(`${loggerPrefix} DOWNGRADE BEGIN: ${migrationName}`)

  // Drop newReleases first (has foreign key to trackedSeries)
  if (await queryInterface.tableExists('newReleases')) {
    logger.info(`${loggerPrefix} dropping table "newReleases"`)
    await queryInterface.dropTable('newReleases')
    logger.info(`${loggerPrefix} dropped table "newReleases"`)
  } else {
    logger.info(`${loggerPrefix} table "newReleases" does not exist`)
  }

  // Drop trackedSeries
  if (await queryInterface.tableExists('trackedSeries')) {
    logger.info(`${loggerPrefix} dropping table "trackedSeries"`)
    await queryInterface.dropTable('trackedSeries')
    logger.info(`${loggerPrefix} dropped table "trackedSeries"`)
  } else {
    logger.info(`${loggerPrefix} table "trackedSeries" does not exist`)
  }

  logger.info(`${loggerPrefix} DOWNGRADE END: ${migrationName}`)
}

module.exports = { up, down }
