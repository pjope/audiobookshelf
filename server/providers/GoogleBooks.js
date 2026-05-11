const axios = require('axios')
const Logger = require('../Logger')

class GoogleBooks {
  static id = 'googlebooks'
  static label = 'Google Books'
  static color = '#4285F4'

  #responseTimeout = 10000
  #baseUrl = 'https://www.googleapis.com/books/v1'

  constructor() {}

  extractIsbn(industryIdentifiers) {
    if (!industryIdentifiers || !industryIdentifiers.length) return null

    var isbnObj = industryIdentifiers.find((i) => i.type === 'ISBN_13') || industryIdentifiers.find((i) => i.type === 'ISBN_10')
    if (isbnObj && isbnObj.identifier) return isbnObj.identifier
    return null
  }

  cleanResult(item) {
    var { id, volumeInfo } = item
    if (!volumeInfo) return null
    const { title, subtitle, authors, publisher, publisherDate, description, industryIdentifiers, categories, imageLinks } = volumeInfo

    let cover = null
    // Selects the largest cover assuming the largest is the last key in the object
    if (imageLinks && Object.keys(imageLinks).length) {
      cover = imageLinks[Object.keys(imageLinks).pop()]
      cover = cover?.replace(/^http:/, 'https:') || null
    }

    return {
      id,
      title,
      subtitle: subtitle || null,
      author: authors ? authors.join(', ') : null,
      publisher,
      publishedYear: publisherDate ? publisherDate.split('-')[0] : null,
      description,
      cover,
      genres: categories && Array.isArray(categories) ? [...categories] : null,
      isbn: this.extractIsbn(industryIdentifiers)
    }
  }

  /**
   * Search for a book by title and author
   * @param {string} title
   * @param {string} author
   * @param {number} [timeout] response timeout in ms
   * @returns {Promise<Object[]>}
   **/
  async search(title, author, timeout = this.#responseTimeout) {
    if (!timeout || isNaN(timeout)) timeout = this.#responseTimeout

    title = encodeURIComponent(title)
    let queryString = `q=intitle:${title}`
    if (author) {
      author = encodeURIComponent(author)
      queryString += `+inauthor:${author}`
    }
    const url = `https://www.googleapis.com/books/v1/volumes?${queryString}`
    Logger.debug(`[GoogleBooks] Search url: ${url}`)
    const items = await axios
      .get(url, {
        timeout
      })
      .then((res) => {
        if (!res || !res.data || !res.data.items) return []
        return res.data.items
      })
      .catch((error) => {
        Logger.error('[GoogleBooks] Volume search error', error.message)
        return []
      })
    return items.map((item) => this.cleanResult(item))
  }

  /**
   * Clean series sequence from Google Books format
   * @param {string} sequence - Raw sequence (e.g., "Book 1", "1", "1.5")
   * @returns {string}
   */
  cleanSeriesSequence(sequence) {
    if (!sequence) return ''
    const str = String(sequence)
    const numberFound = str.match(/\.\d+|\d+(?:\.\d+)?/)
    return numberFound ? numberFound[0] : str
  }

  /**
   * Get a single volume by ID
   * @param {string} volumeId
   * @param {number} [timeout]
   * @returns {Promise<Object|null>}
   */
  async volumeGet(volumeId, timeout = this.#responseTimeout) {
    if (!volumeId) return null
    if (!timeout || isNaN(timeout)) timeout = this.#responseTimeout

    const url = `${this.#baseUrl}/volumes/${encodeURIComponent(volumeId)}`
    Logger.debug(`[GoogleBooks] Volume get URL: ${url}`)

    try {
      const response = await axios.get(url, { timeout })
      return response?.data || null
    } catch (error) {
      Logger.error(`[GoogleBooks] volumeGet error for ${volumeId}:`, error.message)
      return null
    }
  }

  /**
   * Extract series info from a volume
   * @param {Object} volume - Volume data from volumeGet
   * @returns {Object|null} { seriesId, name, position } or null
   */
  extractSeriesInfo(volume) {
    if (!volume?.volumeInfo?.seriesInfo) return null

    const seriesInfo = volume.volumeInfo.seriesInfo
    if (!seriesInfo.volumeSeries?.length) return null

    const firstSeries = seriesInfo.volumeSeries[0]
    return {
      seriesId: firstSeries.seriesId,
      name: seriesInfo.shortSeriesBookTitle || volume.volumeInfo.title,
      position: this.cleanSeriesSequence(firstSeries.orderNumber || firstSeries.bookDisplayNumber)
    }
  }

  /**
   * Get all books in a series by series ID
   * @param {string} seriesId
   * @param {number} [timeout]
   * @returns {Promise<Object[]>} Array of cleaned book objects
   */
  async getSeriesBooks(seriesId, timeout = this.#responseTimeout) {
    if (!seriesId) {
      Logger.error('[GoogleBooks] getSeriesBooks: No series ID provided')
      return []
    }
    if (!timeout || isNaN(timeout)) timeout = this.#responseTimeout

    const url = `${this.#baseUrl}/series/membership/get?series_id=${encodeURIComponent(seriesId)}`
    Logger.debug(`[GoogleBooks] Series membership URL: ${url}`)

    try {
      const response = await axios.get(url, { timeout })
      if (!response?.data?.member?.length) {
        Logger.debug(`[GoogleBooks] No members found for series ${seriesId}`)
        return []
      }

      const members = response.data.member
      const booksWithDetails = await Promise.all(members.map((member) => this.volumeGet(member.volumeId, timeout)))

      return booksWithDetails.filter(Boolean).map((volume) => this.cleanResult(volume))
    } catch (error) {
      Logger.error(`[GoogleBooks] getSeriesBooks error for series ${seriesId}:`, error.message)
      return []
    }
  }

  /**
   * Search by ISBN
   * @param {string} isbn
   * @param {number} [timeout]
   * @returns {Promise<Object|null>}
   */
  async searchByIsbn(isbn, timeout = this.#responseTimeout) {
    if (!isbn) return null
    if (!timeout || isNaN(timeout)) timeout = this.#responseTimeout

    const cleanIsbn = isbn.replace(/[-\s]/g, '')
    const url = `${this.#baseUrl}/volumes?q=isbn:${cleanIsbn}`
    Logger.debug(`[GoogleBooks] ISBN search URL: ${url}`)

    try {
      const response = await axios.get(url, { timeout })
      if (!response?.data?.items?.length) {
        return null
      }

      return this.cleanResult(response.data.items[0])
    } catch (error) {
      Logger.error(`[GoogleBooks] ISBN search error for ${isbn}:`, error.message)
      return null
    }
  }

  /**
   * Find series ID from a book's ISBN
   * @param {string} isbn
   * @param {number} [timeout]
   * @returns {Promise<Object|null>} { seriesId, name, position } or null
   */
  async findSeriesFromIsbn(isbn, timeout = this.#responseTimeout) {
    const book = await this.searchByIsbn(isbn, timeout)
    if (!book?.id) return null

    const volume = await this.volumeGet(book.id, timeout)
    return this.extractSeriesInfo(volume)
  }
}

module.exports = GoogleBooks
