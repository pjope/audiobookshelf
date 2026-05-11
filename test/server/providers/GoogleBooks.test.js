const GoogleBooks = require('../../../server/providers/GoogleBooks')
const { expect } = require('chai')

describe('GoogleBooks', () => {
  let googleBooks

  beforeEach(() => {
    googleBooks = new GoogleBooks()
  })

  describe('static properties', () => {
    it('should have correct id', () => {
      expect(GoogleBooks.id).to.equal('googlebooks')
    })

    it('should have correct label', () => {
      expect(GoogleBooks.label).to.equal('Google Books')
    })

    it('should have correct color', () => {
      expect(GoogleBooks.color).to.equal('#4285F4')
    })
  })

  describe('cleanSeriesSequence', () => {
    it('should return an empty string if sequence is falsy', () => {
      expect(googleBooks.cleanSeriesSequence(null)).to.equal('')
      expect(googleBooks.cleanSeriesSequence('')).to.equal('')
    })

    it('should return the sequence as is if it does not contain a number', () => {
      const result = googleBooks.cleanSeriesSequence('part a')
      expect(result).to.equal('part a')
    })

    it('should return the sequence as is if contains just a number', () => {
      const result = googleBooks.cleanSeriesSequence('2')
      expect(result).to.equal('2')
    })

    it('should return the sequence as is if contains a number with decimals', () => {
      const result = googleBooks.cleanSeriesSequence('2.3')
      expect(result).to.equal('2.3')
    })

    it('should extract and return the first number from the sequence', () => {
      const result = googleBooks.cleanSeriesSequence('Book 1')
      expect(result).to.equal('1')
    })

    it('should extract and return the number with decimals from the sequence', () => {
      const result = googleBooks.cleanSeriesSequence('Book 1.5')
      expect(result).to.equal('1.5')
    })

    it('should extract and return the number even if it has no leading zero', () => {
      const result = googleBooks.cleanSeriesSequence('Book .5')
      expect(result).to.equal('.5')
    })

    it('should handle numeric input', () => {
      const result = googleBooks.cleanSeriesSequence(3)
      expect(result).to.equal('3')
    })
  })

  describe('extractIsbn', () => {
    it('should return null if identifiers is empty or null', () => {
      expect(googleBooks.extractIsbn(null)).to.be.null
      expect(googleBooks.extractIsbn([])).to.be.null
    })

    it('should prefer ISBN_13 over ISBN_10', () => {
      const identifiers = [
        { type: 'ISBN_10', identifier: '1234567890' },
        { type: 'ISBN_13', identifier: '9781234567890' }
      ]
      expect(googleBooks.extractIsbn(identifiers)).to.equal('9781234567890')
    })

    it('should return ISBN_10 if ISBN_13 is not available', () => {
      const identifiers = [{ type: 'ISBN_10', identifier: '1234567890' }]
      expect(googleBooks.extractIsbn(identifiers)).to.equal('1234567890')
    })

    it('should return null if no ISBN is available', () => {
      const identifiers = [{ type: 'OTHER', identifier: 'ABC123' }]
      expect(googleBooks.extractIsbn(identifiers)).to.be.null
    })
  })

  describe('extractSeriesInfo', () => {
    it('should return null if volume has no seriesInfo', () => {
      expect(googleBooks.extractSeriesInfo(null)).to.be.null
      expect(googleBooks.extractSeriesInfo({})).to.be.null
      expect(googleBooks.extractSeriesInfo({ volumeInfo: {} })).to.be.null
    })

    it('should return null if seriesInfo has no volumeSeries', () => {
      const volume = {
        volumeInfo: {
          seriesInfo: {}
        }
      }
      expect(googleBooks.extractSeriesInfo(volume)).to.be.null
    })

    it('should extract series info correctly', () => {
      const volume = {
        volumeInfo: {
          title: 'Book Title',
          seriesInfo: {
            shortSeriesBookTitle: 'Series Name',
            volumeSeries: [
              { seriesId: 'series123', orderNumber: '1' }
            ]
          }
        }
      }
      const result = googleBooks.extractSeriesInfo(volume)
      expect(result).to.deep.equal({
        seriesId: 'series123',
        name: 'Series Name',
        position: '1'
      })
    })

    it('should use title as name if shortSeriesBookTitle is not available', () => {
      const volume = {
        volumeInfo: {
          title: 'Book Title',
          seriesInfo: {
            volumeSeries: [
              { seriesId: 'series123', bookDisplayNumber: '2' }
            ]
          }
        }
      }
      const result = googleBooks.extractSeriesInfo(volume)
      expect(result).to.deep.equal({
        seriesId: 'series123',
        name: 'Book Title',
        position: '2'
      })
    })
  })
})
