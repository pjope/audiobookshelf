const Audible = require('../providers/Audible')
const GoogleBooks = require('../providers/GoogleBooks')
const Logger = require('../Logger')
const Database = require('../Database')
const { isValidASIN } = require('../utils/index')

/**
 * @typedef {Object} SeriesBookResult
 * @property {string} externalId - ASIN or Volume ID
 * @property {string} asin - Deprecated, use externalId
 * @property {string} title
 * @property {string} author
 * @property {string} narrator
 * @property {string} coverUrl
 * @property {string} releaseDate
 * @property {string} sequence
 * @property {string} provider
 */

/**
 * @typedef {Object} ProviderLink
 * @property {string} provider
 * @property {string} externalId
 */

class SeriesFinder {
  constructor() {
    this.audible = new Audible()
    this.googleBooks = new GoogleBooks()
    this.providers = ['audible', 'googlebooks']
  }

  /**
   * Detect the primary provider from library books metadata
   * @param {Array} libraryBooks - Books from the library
   * @returns {string} Provider name ('audible' or 'googlebooks')
   */
  detectProviderFromLibrary(libraryBooks) {
    for (const book of libraryBooks) {
      const metadata = book.media?.metadata || book
      if (metadata.asin && isValidASIN(metadata.asin.toUpperCase())) {
        return 'audible'
      }
    }
    for (const book of libraryBooks) {
      const metadata = book.media?.metadata || book
      if (metadata.isbn) {
        return 'googlebooks'
      }
    }
    return 'audible'
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
      externalId: book.asin,
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
   * Get all books in a series by Google Books series ID
   *
   * @param {string} seriesId - Google Books series ID
   * @returns {Promise<SeriesBookResult[]>}
   */
  async getSeriesBooksByGoogleId(seriesId) {
    if (!seriesId) {
      Logger.warn('[SeriesFinder] No Google Books series ID provided')
      return []
    }

    Logger.debug(`[SeriesFinder] Fetching series books for Google Books series ${seriesId}`)

    const books = await this.googleBooks.getSeriesBooks(seriesId)

    return books.map((book) => ({
      externalId: book.id || book.volumeId,
      asin: null,
      title: book.title,
      author: book.author,
      narrator: null,
      coverUrl: book.cover,
      releaseDate: book.publishedYear,
      sequence: book.series?.[0]?.sequence || null,
      provider: 'googlebooks'
    }))
  }

  /**
   * Find a book on other providers by title and author
   * Used for cross-provider discovery
   *
   * @param {SeriesBookResult} book
   * @returns {Promise<ProviderLink[]>}
   */
  async findOtherProviderLinks(book) {
    const links = []

    if (!book.title) return links

    if (book.provider !== 'audible') {
      try {
        const audibleResults = await this.audible.search(book.title, book.author, null, 'us')
        if (audibleResults.length > 0) {
          const match = audibleResults.find((r) => this.titleMatch(r.title, book.title))
          if (match?.asin) {
            links.push({ provider: 'audible', externalId: match.asin })
          }
        }
      } catch (error) {
        Logger.debug(`[SeriesFinder] Error searching Audible for "${book.title}": ${error.message}`)
      }
    }

    if (book.provider !== 'googlebooks') {
      try {
        const googleResults = await this.googleBooks.search(book.title, book.author)
        if (googleResults.length > 0) {
          const match = googleResults.find((r) => this.titleMatch(r.title, book.title))
          if (match?.id) {
            links.push({ provider: 'googlebooks', externalId: match.id })
          }
        }
      } catch (error) {
        Logger.debug(`[SeriesFinder] Error searching Google Books for "${book.title}": ${error.message}`)
      }
    }

    return links
  }

  /**
   * Check if two titles match (case-insensitive, ignores subtitle)
   * @param {string} title1
   * @param {string} title2
   * @returns {boolean}
   */
  titleMatch(title1, title2) {
    if (!title1 || !title2) return false
    const clean = (t) => t.toLowerCase().split(':')[0].trim()
    return clean(title1) === clean(title2)
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
   * Find Google Books series ID from a book's ISBN
   *
   * @param {string} isbn - ISBN of a book in the series
   * @returns {Promise<{seriesId: string, name: string, position: string}|null>}
   */
  async findSeriesIdFromIsbn(isbn) {
    if (!isbn) return null

    const seriesInfo = await this.googleBooks.findSeriesFromIsbn(isbn)
    if (seriesInfo) {
      Logger.debug(`[SeriesFinder] Found Google Books series ${seriesInfo.seriesId} from ISBN ${isbn}`)
    }
    return seriesInfo
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
   * Try to find series identifier from existing library books
   * Tries Audible first (via ASIN), then Google Books (via ISBN)
   *
   * @param {string} seriesId
   * @param {string} region
   * @returns {Promise<{provider: string, seriesExternalId: string}|null>}
   */
  async findSeriesIdentifierFromLibrary(seriesId, region = 'us') {
    const series = await Database.seriesModel.findByPk(seriesId)
    if (!series) return null

    const books = await series.getBooksExpandedWithLibraryItem()

    // Try Audible first (ASIN-based)
    for (const book of books) {
      if (book.asin && isValidASIN(book.asin.toUpperCase())) {
        const seriesInfo = await this.findSeriesAsinFromBook(book.asin, region)
        if (seriesInfo?.asin) {
          Logger.debug(`[SeriesFinder] Found Audible series ASIN ${seriesInfo.asin} from book ${book.asin}`)
          return { provider: 'audible', seriesExternalId: seriesInfo.asin }
        }
      }
    }

    // Try Google Books (ISBN-based)
    for (const book of books) {
      const isbn = book.isbn || book.media?.metadata?.isbn
      if (isbn) {
        const seriesInfo = await this.findSeriesIdFromIsbn(isbn)
        if (seriesInfo?.seriesId) {
          Logger.debug(`[SeriesFinder] Found Google Books series ${seriesInfo.seriesId} from ISBN ${isbn}`)
          return { provider: 'googlebooks', seriesExternalId: seriesInfo.seriesId }
        }
      }
    }

    Logger.debug(`[SeriesFinder] Could not find series identifier for series ${seriesId}`)
    return null
  }

  /**
   * Try to find series ASIN from existing library books
   * @deprecated Use findSeriesIdentifierFromLibrary instead
   *
   * @param {string} seriesId
   * @param {string} region
   * @returns {Promise<string|null>} Series ASIN or null
   */
  async findSeriesAsinFromLibrary(seriesId, region = 'us') {
    const result = await this.findSeriesIdentifierFromLibrary(seriesId, region)
    if (result?.provider === 'audible') {
      return result.seriesExternalId
    }
    return null
  }
}

module.exports = SeriesFinder
