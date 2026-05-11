const Audible = require('./Audible')
const GoogleBooks = require('./GoogleBooks')

const PROVIDER_IDS = Object.freeze({
  AUDIBLE: 'audible',
  GOOGLE_BOOKS: 'googlebooks'
})

const PROVIDER_CLASSES = Object.freeze({
  [PROVIDER_IDS.AUDIBLE]: Audible,
  [PROVIDER_IDS.GOOGLE_BOOKS]: GoogleBooks
})

module.exports = {
  PROVIDER_IDS,
  PROVIDER_CLASSES
}
