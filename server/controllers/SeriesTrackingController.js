const { Request, Response } = require('express')
const Logger = require('../Logger')
const Database = require('../Database')
const NewReleaseManager = require('../managers/NewReleaseManager')
const SeriesFinder = require('../finders/SeriesFinder')
const Audible = require('../providers/Audible')
const libraryItemsBookFilters = require('../utils/queries/libraryItemsBookFilters')

/**
 * @typedef RequestUserObject
 * @property {import('../models/User')} user
 *
 * @typedef {Request & RequestUserObject} RequestWithUser
 */

class SeriesTrackingController {
  constructor() {
    this.seriesFinder = new SeriesFinder()
  }

  /**
   * POST: /api/me/series/:id/follow
   * Follow/track a series
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async followSeries(req, res) {
    const seriesId = req.params.id
    const userId = req.user.id

    if (req.body.region && !Audible.regionTldMap[req.body.region]) {
      return res.status(400).json({ error: 'Invalid region' })
    }

    const series = await Database.seriesModel.findByPk(seriesId)
    if (!series) {
      Logger.warn(`[SeriesTrackingController] Series not found: ${seriesId}`)
      return res.status(404).json({ error: 'Series not found' })
    }

    const accessibleLibraryItems = await libraryItemsBookFilters.getLibraryItemsForSeries(series, req.user)
    if (!accessibleLibraryItems.length) {
      Logger.warn(`[SeriesTrackingController] User ${userId} has no access to series ${seriesId}`)
      return res.sendStatus(403)
    }

    const existing = await Database.trackedSeriesModel.getByUserAndSeries(userId, seriesId)
    if (existing) {
      return res.json(existing.toJSON())
    }

    let region = req.body.region || 'us'
    const libraryId = accessibleLibraryItems[0].libraryId
    if (libraryId) {
      const library = await Database.libraryModel.findByPk(libraryId)
      const detectedRegion = Audible.regionFromProviderId(library?.provider)
      if (detectedRegion) {
        region = detectedRegion
        Logger.debug(`[SeriesTrackingController] Using region "${region}" from library provider "${library.provider}"`)
      }
    }

    let seriesAsin = null
    for (const libraryItem of accessibleLibraryItems) {
      const bookAsin = libraryItem.media?.asin
      if (bookAsin) {
        const seriesInfo = await this.seriesFinder.findSeriesAsinFromBook(bookAsin, region)
        if (seriesInfo?.asin) {
          seriesAsin = seriesInfo.asin
          break
        }
      }
    }

    const trackedSeries = await Database.trackedSeriesModel.createTrackedSeries({
      userId,
      seriesId,
      seriesAsin,
      autoTracked: false,
      region
    })

    Logger.info(`[SeriesTrackingController] User ${userId} started following series "${series.name}"`)

    if (seriesAsin) {
      NewReleaseManager.manualCheck(trackedSeries.id).catch((err) => {
        Logger.error(`[SeriesTrackingController] Failed to check releases for series: ${err.message}`)
      })
    }

    res.json(trackedSeries.toJSON())
  }

  /**
   * DELETE: /api/me/series/:id/follow
   * Unfollow/stop tracking a series
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async unfollowSeries(req, res) {
    const seriesId = req.params.id
    const userId = req.user.id

    const removed = await Database.trackedSeriesModel.removeTracking(userId, seriesId)
    if (!removed) {
      return res.status(404).json({ error: 'Not tracking this series' })
    }

    Logger.info(`[SeriesTrackingController] User ${userId} stopped following series ${seriesId}`)

    res.json({ success: true })
  }

  /**
   * GET: /api/me/tracked-series
   * Get all series the user is tracking
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async getTrackedSeries(req, res) {
    const userId = req.user.id
    const includeNewReleases = req.query.include === 'newReleases'

    const trackedSeries = await Database.trackedSeriesModel.getTrackedSeriesForUser(userId, {
      includeNewReleases
    })

    res.json({
      trackedSeries: trackedSeries.map((ts) => ts.toJSON())
    })
  }

  /**
   * GET: /api/me/new-releases
   * Get all pending new releases for the user
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async getNewReleases(req, res) {
    const userId = req.user.id
    const limit = parseInt(req.query.limit) || 50

    const releases = await Database.newReleaseModel.getPendingForUser(userId, limit)

    res.json({
      releases: releases.map((r) => r.toJSON()),
      total: releases.length
    })
  }

  /**
   * POST: /api/me/new-releases/:id/dismiss
   * Dismiss a new release notification
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async dismissRelease(req, res) {
    const releaseId = req.params.id

    const release = await Database.newReleaseModel.findByPk(releaseId, {
      include: [
        {
          model: Database.trackedSeriesModel,
          where: { userId: req.user.id },
          required: true
        }
      ]
    })

    if (!release) {
      return res.status(404).json({ error: 'Release not found' })
    }

    await Database.newReleaseModel.dismissRelease(releaseId)

    Logger.debug(`[SeriesTrackingController] User ${req.user.id} dismissed release ${releaseId}`)

    res.json({ success: true })
  }

  /**
   * POST: /api/me/new-releases/dismiss-all
   * Dismiss all new releases for the user
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async dismissAllReleases(req, res) {
    const userId = req.user.id

    const dismissedCount = await Database.newReleaseModel.dismissAllForUser(userId)

    Logger.debug(`[SeriesTrackingController] User ${userId} dismissed ${dismissedCount} releases`)

    res.json({ success: true, dismissed: dismissedCount })
  }

  /**
   * GET: /api/series/:id/tracking
   * Get tracking status for a series
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async getSeriesTrackingStatus(req, res) {
    const seriesId = req.params.id
    const userId = req.user.id

    const series = await Database.seriesModel.findByPk(seriesId)
    if (!series) {
      return res.status(404).json({ error: 'Series not found' })
    }

    const accessibleLibraryItems = await libraryItemsBookFilters.getLibraryItemsForSeries(series, req.user)
    if (!accessibleLibraryItems.length) {
      return res.sendStatus(403)
    }

    const isTracking = await Database.trackedSeriesModel.isTracking(userId, seriesId)
    const trackedSeries = isTracking
      ? await Database.trackedSeriesModel.getByUserAndSeries(userId, seriesId)
      : null

    res.json({
      isTracking,
      trackedSeries: trackedSeries?.toJSON() || null
    })
  }

  /**
   * POST: /api/me/series/:id/check-releases
   * Manually trigger a release check for a tracked series
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async checkSeriesReleases(req, res) {
    const seriesId = req.params.id
    const userId = req.user.id

    const trackedSeries = await Database.trackedSeriesModel.getByUserAndSeries(userId, seriesId)
    if (!trackedSeries) {
      return res.status(404).json({ error: 'Not tracking this series' })
    }

    const series = await Database.seriesModel.findByPk(seriesId)
    if (series) {
      const accessibleLibraryItems = await libraryItemsBookFilters.getLibraryItemsForSeries(series, req.user)
      if (!accessibleLibraryItems.length) {
        return res.sendStatus(403)
      }
    }

    const newReleases = await NewReleaseManager.manualCheck(trackedSeries.id)

    res.json({
      newReleases: newReleases.map((r) => r.toJSON()),
      count: newReleases.length
    })
  }
}

module.exports = new SeriesTrackingController()
