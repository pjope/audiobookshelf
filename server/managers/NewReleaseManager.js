const cron = require('../libs/nodeCron')
const Logger = require('../Logger')
const Database = require('../Database')
const SeriesFinder = require('../finders/SeriesFinder')
const SocketAuthority = require('../SocketAuthority')
const NotificationManager = require('./NotificationManager')

class NewReleaseManager {
  constructor() {
    this.seriesFinder = new SeriesFinder()
    this.cronTask = null
    this.isRunning = false
    this.checkQueue = []
  }

  /**
   * Initialize the new release check cron job
   * Runs daily at 4:00 AM
   */
  init() {
    Logger.info('[NewReleaseManager] Initializing new release detection cron')
    this.cronTask = cron.schedule('0 4 * * *', () => {
      this.runScheduledCheck()
    })
  }

  /**
   * Stop the cron job
   */
  stop() {
    if (this.cronTask) {
      this.cronTask.stop()
      this.cronTask = null
    }
  }

  /**
   * Run the scheduled check for all tracked series
   */
  async runScheduledCheck() {
    if (this.isRunning) {
      Logger.warn('[NewReleaseManager] Check already running, skipping')
      return
    }

    this.isRunning = true
    Logger.info('[NewReleaseManager] Starting scheduled new release check')

    try {
      const checkThreshold = new Date()
      checkThreshold.setHours(checkThreshold.getHours() - 24)

      const seriesToCheck = await Database.trackedSeriesModel.getDueForCheck(checkThreshold, 100)
      Logger.info(`[NewReleaseManager] Found ${seriesToCheck.length} series due for check`)

      for (const trackedSeries of seriesToCheck) {
        await this.checkSeriesForNewReleases(trackedSeries)
        await this.delay(2000)
      }

      Logger.info('[NewReleaseManager] Scheduled check completed')
    } catch (error) {
      Logger.error('[NewReleaseManager] Error during scheduled check:', error)
    } finally {
      this.isRunning = false
    }
  }

  /**
   * Check a single tracked series for new releases
   *
   * @param {import('../models/TrackedSeries')} trackedSeries
   * @returns {Promise<import('../models/NewRelease')[]>} Created new releases
   */
  async checkSeriesForNewReleases(trackedSeries) {
    const seriesName = trackedSeries.series?.name || 'Unknown Series'
    Logger.debug(`[NewReleaseManager] Checking series "${seriesName}" for new releases`)

    try {
      if (!trackedSeries.seriesAsin) {
        const seriesAsin = await this.seriesFinder.findSeriesAsinFromLibrary(
          trackedSeries.seriesId,
          trackedSeries.region
        )
        if (seriesAsin) {
          await trackedSeries.updateSeriesAsin(seriesAsin)
        } else {
          Logger.debug(`[NewReleaseManager] Could not find series ASIN for "${seriesName}"`)
          await trackedSeries.updateLastChecked()
          return []
        }
      }

      const newBooks = await this.seriesFinder.getNewReleasesForSeries(trackedSeries)
      const createdReleases = []

      for (const book of newBooks) {
        try {
          const release = await Database.newReleaseModel.createNewRelease({
            trackedSeriesId: trackedSeries.id,
            asin: book.asin,
            title: book.title,
            author: book.author,
            narrator: book.narrator,
            coverUrl: book.coverUrl,
            releaseDate: book.releaseDate,
            sequence: book.sequence,
            provider: book.provider
          })
          createdReleases.push(release)
          Logger.info(`[NewReleaseManager] New release found: "${book.title}" in series "${seriesName}"`)
        } catch (error) {
          if (error.name === 'SequelizeUniqueConstraintError') {
            Logger.debug(`[NewReleaseManager] Release already exists: ${book.asin}`)
          } else {
            Logger.error(`[NewReleaseManager] Error creating release record:`, error)
          }
        }
      }

      await trackedSeries.updateLastChecked()

      if (createdReleases.length > 0) {
        await this.notifyNewReleases(trackedSeries, createdReleases)
        this.emitNewReleasesUpdate(trackedSeries.userId)
      }

      return createdReleases
    } catch (error) {
      Logger.error(`[NewReleaseManager] Error checking series "${seriesName}":`, error)
      await trackedSeries.updateLastChecked()
      return []
    }
  }

  /**
   * Trigger notifications for new releases
   *
   * @param {import('../models/TrackedSeries')} trackedSeries
   * @param {import('../models/NewRelease')[]} releases
   */
  async notifyNewReleases(trackedSeries, releases) {
    if (!releases.length) return

    const seriesName = trackedSeries.series?.name || 'Unknown Series'

    for (const release of releases) {
      const eventData = {
        seriesName,
        seriesId: trackedSeries.seriesId,
        bookTitle: release.title,
        bookAuthor: release.author || '',
        bookNarrator: release.narrator || '',
        sequence: release.sequence || '',
        releaseDate: release.releaseDate || '',
        coverUrl: release.coverUrl || '',
        asin: release.asin
      }

      NotificationManager.onNewSeriesRelease(trackedSeries, release, eventData)
    }
  }

  /**
   * Emit socket event to update user's new releases
   *
   * @param {string} userId
   */
  emitNewReleasesUpdate(userId) {
    SocketAuthority.emitter('new_releases_updated', null, userId)
  }

  /**
   * Manually trigger a check for a specific tracked series
   *
   * @param {string} trackedSeriesId
   * @returns {Promise<import('../models/NewRelease')[]>}
   */
  async manualCheck(trackedSeriesId) {
    const trackedSeries = await Database.trackedSeriesModel.findByPk(trackedSeriesId, {
      include: [{ model: Database.seriesModel }]
    })

    if (!trackedSeries) {
      Logger.warn(`[NewReleaseManager] Tracked series not found: ${trackedSeriesId}`)
      return []
    }

    return this.checkSeriesForNewReleases(trackedSeries)
  }

  /**
   * Delay helper for rate limiting
   *
   * @param {number} ms
   * @returns {Promise<void>}
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

module.exports = new NewReleaseManager()
