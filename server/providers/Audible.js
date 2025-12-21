const axios = require('axios').default
const Logger = require('../Logger')
const { isValidASIN } = require('../utils/index')

class Audible {
  #responseTimeout = 10000

  constructor() {
    this.regionMap = {
      us: '.com',
      ca: '.ca',
      uk: '.co.uk',
      au: '.com.au',
      fr: '.fr',
      de: '.de',
      jp: '.co.jp',
      it: '.it',
      in: '.in',
      es: '.es'
    }
  }

  /**
   * Audible will sometimes send sequences with "Book 1" or "2, Dramatized Adaptation"
   * @see https://github.com/advplyr/audiobookshelf/issues/2380
   * @see https://github.com/advplyr/audiobookshelf/issues/1339
   *
   * @param {string} seriesName
   * @param {string} sequence
   * @returns {string}
   */
  cleanSeriesSequence(seriesName, sequence) {
    if (!sequence) return ''
    // match any number with optional decimal (e.g, 1 or 1.5 or .5)
    let numberFound = sequence.match(/\.\d+|\d+(?:\.\d+)?/)
    let updatedSequence = numberFound ? numberFound[0] : sequence
    if (sequence !== updatedSequence) {
      Logger.debug(`[Audible] Series "${seriesName}" sequence was cleaned from "${sequence}" to "${updatedSequence}"`)
    }
    return updatedSequence
  }

  cleanResult(item) {
    const { title, subtitle, asin, authors, narrators, publisherName, summary, releaseDate, image, genres, seriesPrimary, seriesSecondary, language, runtimeLengthMin, formatType, isbn } = item

    const series = []
    if (seriesPrimary) {
      series.push({
        series: seriesPrimary.name,
        sequence: this.cleanSeriesSequence(seriesPrimary.name, seriesPrimary.position || '')
      })
    }
    if (seriesSecondary) {
      series.push({
        series: seriesSecondary.name,
        sequence: this.cleanSeriesSequence(seriesSecondary.name, seriesSecondary.position || '')
      })
    }

    const genresFiltered = genres ? genres.filter((g) => g.type == 'genre').map((g) => g.name) : []
    const tagsFiltered = genres ? genres.filter((g) => g.type == 'tag').map((g) => g.name) : []

    return {
      title,
      subtitle: subtitle || null,
      author: authors ? authors.map(({ name }) => name).join(', ') : null,
      narrator: narrators ? narrators.map(({ name }) => name).join(', ') : null,
      publisher: publisherName,
      publishedYear: releaseDate ? releaseDate.split('-')[0] : null,
      description: summary || null,
      cover: image,
      asin,
      isbn,
      genres: genresFiltered.length ? genresFiltered : null,
      tags: tagsFiltered.length ? tagsFiltered.join(', ') : null,
      series: series.length ? series : null,
      language: language ? language.charAt(0).toUpperCase() + language.slice(1) : null,
      duration: runtimeLengthMin && !isNaN(runtimeLengthMin) ? Number(runtimeLengthMin) : 0,
      region: item.region || null,
      rating: item.rating || null,
      abridged: formatType === 'abridged'
    }
  }

  /**
   *
   * @param {string} asin
   * @param {string} region
   * @param {number} [timeout] response timeout in ms
   * @returns {Promise<Object>}
   */
  asinSearch(asin, region, timeout = this.#responseTimeout) {
    if (!asin) return null
    if (!timeout || isNaN(timeout)) timeout = this.#responseTimeout

    asin = encodeURIComponent(asin.toUpperCase())
    var regionQuery = region ? `?region=${region}` : ''
    var url = `https://api.audnex.us/books/${asin}${regionQuery}`
    Logger.debug(`[Audible] ASIN url: ${url}`)
    return axios
      .get(url, {
        timeout
      })
      .then((res) => {
        if (!res?.data?.asin) return null
        return res.data
      })
      .catch((error) => {
        Logger.error('[Audible] ASIN search error', error.message)
        return null
      })
  }

  /**
   * Get books in the same series as the given ASIN
   * Uses the Audible similarity API
   *
   * @param {string} asin - ASIN of a book in the series
   * @param {string} region
   * @param {number} [timeout] response timeout in ms
   * @returns {Promise<Object[]>} Array of cleaned book objects
   */
  async getSeriesBooks(asin, region, timeout = this.#responseTimeout) {
    if (!asin || !isValidASIN(asin.toUpperCase())) {
      Logger.error('[Audible] getSeriesBooks: Invalid ASIN')
      return []
    }
    if (region && !this.regionMap[region]) {
      Logger.warn(`[Audible] getSeriesBooks: Invalid region ${region}, defaulting to us`)
      region = 'us'
    }
    if (!timeout || isNaN(timeout)) timeout = this.#responseTimeout

    asin = asin.toUpperCase()
    const tld = this.regionMap[region] || '.com'
    const url = `https://api.audible${tld}/1.0/catalog/products/${asin}/sims?similarity_type=InTheSameSeries&num_results=50`

    Logger.debug(`[Audible] Series books URL: ${url}`)

    try {
      const response = await axios.get(url, { timeout })
      if (!response?.data?.similar_products) {
        Logger.debug(`[Audible] No similar products found for ASIN ${asin}`)
        return []
      }

      const products = response.data.similar_products
      const booksWithDetails = await Promise.all(
        products.map((product) => this.asinSearch(product.asin, region, timeout))
      )

      const originalBook = await this.asinSearch(asin, region, timeout)
      if (originalBook) {
        booksWithDetails.unshift(originalBook)
      }

      return booksWithDetails.filter(Boolean).map((item) => this.cleanResult(item))
    } catch (error) {
      Logger.error(`[Audible] getSeriesBooks error for ASIN ${asin}:`, error.message)
      return []
    }
  }

  /**
   * Extract series ASIN from a book's metadata
   * Note: Audnexus returns series with ASIN in the seriesPrimary/seriesSecondary objects
   *
   * @param {Object} bookData - Book data from asinSearch
   * @returns {Object|null} { asin, name, position } or null
   */
  extractSeriesInfo(bookData) {
    if (!bookData) return null

    if (bookData.seriesPrimary?.asin) {
      return {
        asin: bookData.seriesPrimary.asin,
        name: bookData.seriesPrimary.name,
        position: this.cleanSeriesSequence(bookData.seriesPrimary.name, bookData.seriesPrimary.position)
      }
    }

    if (bookData.seriesSecondary?.asin) {
      return {
        asin: bookData.seriesSecondary.asin,
        name: bookData.seriesSecondary.name,
        position: this.cleanSeriesSequence(bookData.seriesSecondary.name, bookData.seriesSecondary.position)
      }
    }

    return null
  }

  /**
   * Fetch series information directly from Audible API
   * Used as fallback when Audnexus doesn't provide series data (e.g., German books)
   *
   * @param {string} asin - Book ASIN
   * @param {string} region
   * @param {number} [timeout] response timeout in ms
   * @returns {Promise<Object|null>} { asin, name, position } or null
   */
  async getSeriesInfoFromAudible(asin, region = 'us', timeout = this.#responseTimeout) {
    if (!asin || !isValidASIN(asin.toUpperCase())) {
      return null
    }
    if (!timeout || isNaN(timeout)) timeout = this.#responseTimeout

    const tld = this.regionMap[region] || '.com'
    const url = `https://api.audible${tld}/1.0/catalog/products/${asin.toUpperCase()}?response_groups=series,relationships`

    Logger.debug(`[Audible] Fetching series info from: ${url}`)

    try {
      const response = await axios.get(url, { timeout })
      const product = response?.data?.product

      if (product?.series?.[0]?.asin) {
        const series = product.series[0]
        return {
          asin: series.asin,
          name: series.title,
          position: this.cleanSeriesSequence(series.title, series.sequence)
        }
      }

      if (product?.relationships) {
        const seriesRelation = product.relationships.find((r) => r.relationship_type === 'series')
        if (seriesRelation?.asin) {
          return {
            asin: seriesRelation.asin,
            name: seriesRelation.title,
            position: this.cleanSeriesSequence(seriesRelation.title, seriesRelation.sequence)
          }
        }
      }

      return null
    } catch (error) {
      Logger.error(`[Audible] getSeriesInfoFromAudible error for ASIN ${asin}:`, error.message)
      return null
    }
  }

  /**
   *
   * @param {string} title
   * @param {string} author
   * @param {string} asin
   * @param {string} region
   * @param {number} [timeout] response timeout in ms
   * @returns {Promise<Object[]>}
   */
  async search(title, author, asin, region, timeout = this.#responseTimeout) {
    if (region && !this.regionMap[region]) {
      Logger.error(`[Audible] search: Invalid region ${region}`)
      region = ''
    }
    if (!timeout || isNaN(timeout)) timeout = this.#responseTimeout

    let items = []
    if (asin && isValidASIN(asin.toUpperCase())) {
      const item = await this.asinSearch(asin, region, timeout)
      if (item) items.push(item)
    }

    if (!items.length && isValidASIN(title.toUpperCase())) {
      const item = await this.asinSearch(title, region, timeout)
      if (item) items.push(item)
    }

    if (!items.length) {
      const queryObj = {
        num_results: '10',
        products_sort_by: 'Relevance',
        title: title
      }
      if (author) queryObj.author = author
      const queryString = new URLSearchParams(queryObj).toString()
      const tld = region ? this.regionMap[region] : '.com'
      const url = `https://api.audible${tld}/1.0/catalog/products?${queryString}`
      Logger.debug(`[Audible] Search url: ${url}`)
      items = await axios
        .get(url, {
          timeout
        })
        .then((res) => {
          if (!res?.data?.products) return null
          return Promise.all(res.data.products.map((result) => this.asinSearch(result.asin, region, timeout)))
        })
        .catch((error) => {
          Logger.error('[Audible] query search error', error.message)
          return []
        })
    }
    return items.filter(Boolean).map((item) => this.cleanResult(item)) || []
  }
}

module.exports = Audible
