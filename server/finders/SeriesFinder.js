const Audible = require('../providers/Audible')
const Logger = require('../Logger')
const Database = require('../Database')
const { isValidASIN } = require('../utils/index')

/**
 * @typedef {Object} SeriesBookResult
 * @property {string} asin
 * @property {string} title
 * @property {string} author
 * @property {string} narrator
 * @property {string} coverUrl
 * @property {string} releaseDate
 * @property {string} sequence
 * @property {string} provider
 */

class SeriesFinder {
  constructor() {
    this.audible = new Audible()
    this.providers = ['audible']
  }

  /**
   * Get all books in a series by series ASIN
   *
   * @param {string} seriesAsin - ASIN of the series
   * @param {string} region - Audible region (us, uk, de, etc.)
   * @returns {Promise<SeriesBookResult[]>}
   */
  async getSeriesBooksByAsin(seriesAsin, region = 'us') {
    if (!seriesAsin || !isValidASIN(seriesAsin.toUpperCase())) {
      Logger.warn('[SeriesFinder] Invalid series ASIN provided')
      return []
    }

    Logger.debug(`[SeriesFinder] Fetching series books for series ASIN ${seriesAsin} in region ${region}`)

    const books = await this.audible.getBooksBySeriesAsin(seriesAsin, region)

    return books.map((book) => ({
      asin: book.asin,
      title: book.title,
      author: book.author,
      narrator: book.narrator,
      coverUrl: book.cover,
      releaseDate: book.publishedYear,
      sequence: book.series?.[0]?.sequence || null,
      provider: 'audible'
    }))
  }

  /**
   * Find series ASIN by looking up a book's ASIN
   *
   * @param {string} bookAsin - ASIN of a book in the series
   * @param {string} region
   * @returns {Promise<{asin: string, name: string, position: string}|null>}
   */
  async findSeriesAsinFromBook(bookAsin, region = 'us') {
    if (!bookAsin || !isValidASIN(bookAsin.toUpperCase())) {
      return null
    }

    const bookData = await this.audible.asinSearch(bookAsin, region)
    if (!bookData) return null

    const seriesInfo = this.audible.extractSeriesInfo(bookData)
    if (seriesInfo) {
      return seriesInfo
    }

    Logger.debug(`[SeriesFinder] Audnexus didn't return series info for ${bookAsin}, trying direct Audible API`)
    return await this.audible.getSeriesInfoFromAudible(bookAsin, region)
  }

  /**
   * Get new releases for a tracked series
   * Compares external books with library books
   *
   * @param {import('../models/TrackedSeries')} trackedSeries - TrackedSeries model instance
   * @returns {Promise<SeriesBookResult[]>} Books not in library
   */
  async getNewReleasesForSeries(trackedSeries) {
    if (!trackedSeries.seriesAsin) {
      Logger.debug(`[SeriesFinder] No series ASIN for tracked series ${trackedSeries.id}`)
      return []
    }

    const externalBooks = await this.getSeriesBooksByAsin(
      trackedSeries.seriesAsin,
      trackedSeries.region || 'us'
    )

    if (!externalBooks.length) {
      Logger.debug(`[SeriesFinder] No external books found for series ASIN ${trackedSeries.seriesAsin}`)
      return []
    }

    const series = trackedSeries.series || (await Database.seriesModel.findByPk(trackedSeries.seriesId))
    if (!series) {
      Logger.warn(`[SeriesFinder] Series not found for tracked series ${trackedSeries.id}`)
      return []
    }

    const libraryBooks = await series.getBooksExpandedWithLibraryItem()
    const libraryAsins = new Set(
      libraryBooks.map((book) => book.asin?.toUpperCase()).filter(Boolean)
    )

    const existingReleaseAsins = await Database.newReleaseModel.findAll({
      where: { trackedSeriesId: trackedSeries.id },
      attributes: ['asin']
    }).then((releases) => new Set(releases.map((r) => r.asin?.toUpperCase())))

    const newBooks = externalBooks.filter((book) => {
      if (!book.asin) return false
      const upperAsin = book.asin.toUpperCase()
      return !libraryAsins.has(upperAsin) && !existingReleaseAsins.has(upperAsin)
    })

    Logger.debug(`[SeriesFinder] Found ${newBooks.length} new books for series "${series.name}"`)
    return newBooks
  }

  /**
   * Try to find series ASIN from existing library books
   *
   * @param {string} seriesId
   * @param {string} region
   * @returns {Promise<string|null>} Series ASIN or null
   */
  async findSeriesAsinFromLibrary(seriesId, region = 'us') {
    const series = await Database.seriesModel.findByPk(seriesId)
    if (!series) return null

    const books = await series.getBooksExpandedWithLibraryItem()

    for (const book of books) {
      if (book.asin && isValidASIN(book.asin.toUpperCase())) {
        const seriesInfo = await this.findSeriesAsinFromBook(book.asin, region)
        if (seriesInfo?.asin) {
          Logger.debug(`[SeriesFinder] Found series ASIN ${seriesInfo.asin} from book ${book.asin}`)
          return seriesInfo.asin
        }
      }
    }

    Logger.debug(`[SeriesFinder] Could not find series ASIN for series ${seriesId}`)
    return null
  }
}

module.exports = SeriesFinder
