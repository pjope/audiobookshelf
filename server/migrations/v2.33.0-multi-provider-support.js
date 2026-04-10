/**
 * @typedef MigrationContext
 * @property {import('sequelize').QueryInterface} queryInterface - a sequelize QueryInterface object.
 * @property {import('../Logger')} logger - a Logger object.
 *
 * @typedef MigrationOptions
 * @property {MigrationContext} context - an object containing the migration context.
 */

const migrationVersion = '2.33.0'
const migrationName = `${migrationVersion}-multi-provider-support`
const loggerPrefix = `[${migrationVersion} migration]`

/**
 * This upward migration creates the newReleaseProviders table for multi-provider support.
 * It also migrates existing provider/asin data from newReleases to the new table.
 *
 * @param {MigrationOptions} options - an object containing the migration context.
 * @returns {Promise<void>} - A promise that resolves when the migration is complete.
 */
async function up({ context: { queryInterface, logger } }) {
  logger.info(`${loggerPrefix} UPGRADE BEGIN: ${migrationName}`)

  const DataTypes = queryInterface.sequelize.Sequelize.DataTypes

  // Create newReleaseProviders table
  if (await queryInterface.tableExists('newReleaseProviders')) {
    logger.info(`${loggerPrefix} table "newReleaseProviders" already exists`)
  } else {
    logger.info(`${loggerPrefix} creating table "newReleaseProviders"`)
    await queryInterface.createTable('newReleaseProviders', {
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
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      newReleaseId: {
        type: DataTypes.UUID,
        references: {
          model: {
            tableName: 'newReleases'
          },
          key: 'id'
        },
        allowNull: false,
        onDelete: 'CASCADE'
      }
    })
    logger.info(`${loggerPrefix} created table "newReleaseProviders"`)

    // Add unique constraint for provider per release
    logger.info(`${loggerPrefix} adding unique constraint on newReleaseProviders(newReleaseId, provider)`)
    await queryInterface.addIndex('newReleaseProviders', ['newReleaseId', 'provider'], {
      unique: true,
      name: 'unique_provider_per_release'
    })

    // Add index on newReleaseId for efficient queries
    await queryInterface.addIndex('newReleaseProviders', ['newReleaseId'], {
      name: 'new_release_providers_release_id'
    })
  }

  // Migrate existing data from newReleases.provider/asin to newReleaseProviders
  logger.info(`${loggerPrefix} migrating existing provider data to newReleaseProviders`)

  const existingReleases = await queryInterface.sequelize.query('SELECT id, provider, asin FROM newReleases WHERE asin IS NOT NULL', {
    type: queryInterface.sequelize.QueryTypes.SELECT
  })

  if (existingReleases.length > 0) {
    logger.info(`${loggerPrefix} found ${existingReleases.length} releases to migrate`)

    for (const release of existingReleases) {
      // Check if already migrated
      const existing = await queryInterface.sequelize.query(
        'SELECT id FROM newReleaseProviders WHERE newReleaseId = :releaseId AND provider = :provider',
        {
          replacements: { releaseId: release.id, provider: release.provider || 'audible' },
          type: queryInterface.sequelize.QueryTypes.SELECT
        }
      )

      if (existing.length === 0) {
        const uuid = queryInterface.sequelize.Sequelize.literal("(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))")

        await queryInterface.sequelize.query(
          `INSERT INTO newReleaseProviders (id, newReleaseId, provider, externalId, createdAt)
           VALUES (${uuid.val}, :releaseId, :provider, :externalId, datetime('now'))`,
          {
            replacements: {
              releaseId: release.id,
              provider: release.provider || 'audible',
              externalId: release.asin
            }
          }
        )
      }
    }
    logger.info(`${loggerPrefix} migrated provider data for ${existingReleases.length} releases`)
  } else {
    logger.info(`${loggerPrefix} no existing releases to migrate`)
  }

  logger.info(`${loggerPrefix} UPGRADE END: ${migrationName}`)
}

/**
 * This downward migration script removes the newReleaseProviders table.
 *
 * @param {MigrationOptions} options - an object containing the migration context.
 * @returns {Promise<void>} - A promise that resolves when the migration is complete.
 */
async function down({ context: { queryInterface, logger } }) {
  logger.info(`${loggerPrefix} DOWNGRADE BEGIN: ${migrationName}`)

  if (await queryInterface.tableExists('newReleaseProviders')) {
    logger.info(`${loggerPrefix} dropping table "newReleaseProviders"`)
    await queryInterface.dropTable('newReleaseProviders')
    logger.info(`${loggerPrefix} dropped table "newReleaseProviders"`)
  } else {
    logger.info(`${loggerPrefix} table "newReleaseProviders" does not exist`)
  }

  logger.info(`${loggerPrefix} DOWNGRADE END: ${migrationName}`)
}

module.exports = { up, down }
